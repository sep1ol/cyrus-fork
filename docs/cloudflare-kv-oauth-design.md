# Cloudflare KV OAuth Token Storage Design

## Overview

This document outlines the design for storing OAuth tokens in Cloudflare KV instead of the filesystem, enabling the proxy to run as a stateless Cloudflare Worker.

## KV Namespace Structure

### 1. OAuth Tokens
```
Namespace: OAUTH_TOKENS
Key Format: oauth:token:{workspaceId}
Value: {
  accessToken: string (encrypted),
  refreshToken?: string (encrypted),
  expiresAt: number,
  obtainedAt: number,
  scope: string[],
  tokenType: string,
  userId: string,
  userEmail?: string,
  workspaceName?: string
}
TTL: Set based on token expiration
```

### 2. OAuth State (for CSRF protection)
```
Namespace: OAUTH_STATE
Key Format: oauth:state:{state}
Value: {
  createdAt: number,
  redirectUri: string,
  metadata?: any
}
TTL: 600 seconds (10 minutes)
```

### 3. Edge Authentication Tokens
```
Namespace: EDGE_TOKENS
Key Format: edge:token:{hashedToken}
Value: {
  workspaceIds: string[],
  createdAt: number,
  lastUsed: number,
  name?: string,
  permissions: string[]
}
TTL: None (manual expiration)
```

### 4. Workspace Metadata
```
Namespace: WORKSPACE_METADATA
Key Format: workspace:meta:{workspaceId}
Value: {
  name: string,
  urlKey: string,
  organizationId: string,
  teams: Array<{id: string, name: string, key: string}>
}
TTL: 86400 seconds (24 hours)
```

## Implementation Details

### OAuth Token Storage

```typescript
interface OAuthTokenStorage {
  async saveToken(workspaceId: string, tokenData: LinearOAuthToken): Promise<void>
  async getToken(workspaceId: string): Promise<LinearOAuthToken | null>
  async deleteToken(workspaceId: string): Promise<void>
  async refreshToken(workspaceId: string): Promise<LinearOAuthToken>
}

export class KVOAuthTokenStorage implements OAuthTokenStorage {
  constructor(
    private kv: KVNamespace,
    private crypto: SubtleCrypto,
    private encryptionKey: string
  ) {}

  async saveToken(workspaceId: string, tokenData: LinearOAuthToken): Promise<void> {
    // Encrypt sensitive data
    const encrypted = await this.encryptTokenData(tokenData)
    
    // Calculate TTL based on expiration
    const ttl = tokenData.expiresAt 
      ? Math.floor((tokenData.expiresAt - Date.now()) / 1000)
      : undefined
    
    // Store in KV
    await this.kv.put(
      `oauth:token:${workspaceId}`,
      JSON.stringify(encrypted),
      { expirationTtl: ttl }
    )
  }

  async getToken(workspaceId: string): Promise<LinearOAuthToken | null> {
    const data = await this.kv.get(`oauth:token:${workspaceId}`)
    if (!data) return null
    
    const encrypted = JSON.parse(data)
    return await this.decryptTokenData(encrypted)
  }

  private async encryptTokenData(data: LinearOAuthToken): Promise<EncryptedToken> {
    // Implementation using Web Crypto API
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const key = await this.getEncryptionKey()
    
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(data.accessToken)
    )
    
    return {
      accessToken: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
      iv: btoa(String.fromCharCode(...iv)),
      refreshToken: data.refreshToken ? await this.encryptString(data.refreshToken) : undefined,
      expiresAt: data.expiresAt,
      obtainedAt: data.obtainedAt,
      scope: data.scope,
      tokenType: data.tokenType,
      userId: data.userId,
      userEmail: data.userEmail,
      workspaceName: data.workspaceName
    }
  }
}
```

### OAuth Flow Updates

```typescript
export class CloudflareOAuthService {
  constructor(
    private tokenStorage: KVOAuthTokenStorage,
    private stateStorage: KVNamespace,
    private config: OAuthConfig
  ) {}

  async handleAuthorize(request: Request): Promise<Response> {
    // Generate state for CSRF protection
    const state = crypto.randomUUID()
    
    // Store state in KV with TTL
    await this.stateStorage.put(
      `oauth:state:${state}`,
      JSON.stringify({
        createdAt: Date.now(),
        redirectUri: this.config.redirectUri
      }),
      { expirationTtl: 600 } // 10 minutes
    )
    
    // Build Linear OAuth URL
    const authUrl = new URL('https://linear.app/oauth/authorize')
    authUrl.searchParams.set('client_id', this.config.clientId)
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('state', state)
    authUrl.searchParams.set('scope', this.config.scopes.join(' '))
    
    return Response.redirect(authUrl.toString(), 302)
  }

  async handleCallback(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    
    if (!code || !state) {
      return new Response('Missing code or state', { status: 400 })
    }
    
    // Validate state
    const stateData = await this.stateStorage.get(`oauth:state:${state}`)
    if (!stateData) {
      return new Response('Invalid or expired state', { status: 400 })
    }
    
    // Delete state after use
    await this.stateStorage.delete(`oauth:state:${state}`)
    
    // Exchange code for token
    const tokenResponse = await this.exchangeCodeForToken(code)
    
    // Get workspace info from token
    const workspaceInfo = await this.getWorkspaceInfo(tokenResponse.access_token)
    
    // Store token in KV
    await this.tokenStorage.saveToken(workspaceInfo.id, {
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: Date.now() + (tokenResponse.expires_in * 1000),
      obtainedAt: Date.now(),
      scope: tokenResponse.scope.split(' '),
      tokenType: tokenResponse.token_type,
      userId: workspaceInfo.userId,
      userEmail: workspaceInfo.userEmail,
      workspaceName: workspaceInfo.name
    })
    
    // Redirect to success page with encrypted token for edge worker
    const edgeToken = await this.generateEdgeToken(workspaceInfo.id)
    return Response.redirect(
      `cyrus://setup?token=${edgeToken}&workspace=${workspaceInfo.name}`,
      302
    )
  }
}
```

### Edge Token Management

```typescript
export class EdgeTokenManager {
  constructor(
    private kv: KVNamespace,
    private crypto: SubtleCrypto
  ) {}

  async generateToken(workspaceIds: string[]): Promise<string> {
    // Generate secure random token
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32))
    const token = btoa(String.fromCharCode(...tokenBytes))
    
    // Hash token for storage
    const hashedToken = await this.hashToken(token)
    
    // Store token metadata
    await this.kv.put(
      `edge:token:${hashedToken}`,
      JSON.stringify({
        workspaceIds,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        permissions: ['read', 'write']
      })
    )
    
    return token
  }

  async validateToken(token: string): Promise<string[] | null> {
    const hashedToken = await this.hashToken(token)
    const data = await this.kv.get(`edge:token:${hashedToken}`)
    
    if (!data) return null
    
    const tokenData = JSON.parse(data)
    
    // Update last used
    await this.kv.put(
      `edge:token:${hashedToken}`,
      JSON.stringify({
        ...tokenData,
        lastUsed: Date.now()
      })
    )
    
    return tokenData.workspaceIds
  }

  private async hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder()
    const data = encoder.encode(token)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  }
}
```

## Migration Strategy

### Phase 1: Dual Storage (Current)
- Keep file-based storage for local development
- Add KV storage adapter interface
- Implement feature flag to switch between storage backends

### Phase 2: KV Primary (Next)
- Use KV as primary storage in production
- Fall back to file storage in development
- Add KV debugging tools

### Phase 3: KV Only (Final)
- Remove file-based storage code
- Use Miniflare for local KV emulation
- Full Cloudflare Workers deployment

## Security Considerations

1. **Token Encryption**
   - All OAuth tokens encrypted at rest using AES-GCM
   - Encryption key stored as Worker secret
   - Each token has unique IV

2. **Token Hashing**
   - Edge tokens hashed with SHA-256 before storage
   - Original token never stored
   - Prevents token leakage if KV is compromised

3. **TTL Management**
   - OAuth tokens expire based on Linear's expiration
   - State tokens expire after 10 minutes
   - Edge tokens require manual revocation

4. **CSRF Protection**
   - State parameter validated on callback
   - State deleted after single use
   - Time-limited validity

## Local Development

```toml
# wrangler.toml
[[kv_namespaces]]
binding = "OAUTH_TOKENS"
id = "oauth_tokens_dev"
preview_id = "oauth_tokens_preview"

[[kv_namespaces]]
binding = "OAUTH_STATE"
id = "oauth_state_dev"
preview_id = "oauth_state_preview"

[[kv_namespaces]]
binding = "EDGE_TOKENS"
id = "edge_tokens_dev"
preview_id = "edge_tokens_preview"

[vars]
ENCRYPTION_KEY = "dev_encryption_key_32_bytes_long"

# For local development with Miniflare
[miniflare]
kv_persist = true
```

## Benefits

1. **Stateless Workers**: No filesystem dependency
2. **Global Distribution**: KV data replicated globally
3. **Automatic Expiration**: TTL support for temporary data
4. **Cost Effective**: 100k reads/day free tier
5. **Secure**: Encryption at rest, hashing for sensitive data
6. **Scalable**: No connection limits like SQL databases

## Monitoring

```typescript
// Add metrics for KV operations
export class MetricsCollector {
  async recordKVOperation(operation: string, namespace: string, success: boolean, duration: number) {
    // Send to analytics
    await this.analytics.track({
      event: 'kv_operation',
      properties: {
        operation,
        namespace,
        success,
        duration,
        timestamp: Date.now()
      }
    })
  }
}
```

## Next Steps

1. Create KV namespaces in Cloudflare dashboard
2. Implement KVOAuthTokenStorage class
3. Update OAuthService to use KV storage
4. Add encryption/decryption utilities
5. Test with Miniflare locally
6. Deploy to Cloudflare Workers
7. Monitor KV usage and performance