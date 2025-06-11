# OAuth and Edge Authentication Flow

## Overview

This document outlines how Linear workspaces connect to Cyrus through OAuth, and how edge workers authenticate with the central proxy.

## Authentication Architecture

### Two-Layer Authentication Model

1. **Linear OAuth**: Workspace admins authorize Cyrus to access Linear
2. **Edge Authentication**: Individual users connect their edge workers to Cyrus

```
┌─────────────────┐
│   Linear.app    │
│                 │
│ OAuth Provider  │
└────────┬────────┘
         │ OAuth Flow
         ▼
┌─────────────────┐
│  Cyrus Proxy    │
│                 │
│ • OAuth Client  │
│ • Token Store   │
│ • Edge Registry │
└────────┬────────┘
         │ Edge API Keys
         ▼
┌─────────────────┐
│  Edge Workers   │
│                 │
│ • User Machines │
└─────────────────┘
```

## OAuth Flow for Linear Workspaces

### 1. Initial Setup Flow

```javascript
// User visits cyrus-proxy.example.com
GET /

// Proxy shows setup page
"Welcome to Cyrus!"
"1. Connect your Linear workspace"
"2. Install edge worker on your machine"
"3. Start automating with Claude"

[Connect Linear Workspace] // Button
```

### 2. OAuth Authorization

```javascript
// User clicks "Connect Linear Workspace"
GET /oauth/authorize

// Proxy redirects to Linear
302 → https://linear.app/oauth/authorize?
  client_id=cyrus_client_id&
  redirect_uri=https://cyrus-proxy.example.com/oauth/callback&
  response_type=code&
  scope=read,write,issues:create,comments:create&
  state=random_state_123&
  actor=application // Important: Application-level auth
```

### 3. OAuth Callback

```javascript
// Linear redirects back with code
GET /oauth/callback?code=xxx&state=random_state_123

// Proxy exchanges code for tokens
POST https://api.linear.app/oauth/token
{
  "client_id": "cyrus_client_id",
  "client_secret": "cyrus_client_secret",
  "code": "xxx",
  "grant_type": "authorization_code"
}

// Response contains workspace-level tokens
{
  "access_token": "lin_api_xxx",
  "refresh_token": "lin_refresh_xxx",
  "scope": "read,write,issues:create,comments:create",
  "token_type": "Bearer",
  "expires_in": 8640000,
  // Workspace information
  "workspace": {
    "id": "workspace_123",
    "name": "Acme Corp",
    "urlKey": "acme"
  }
}
```

### 4. Workspace Registration

```javascript
// Proxy stores workspace credentials
class WorkspaceRegistry {
  async registerWorkspace(oauthResponse) {
    const workspace = {
      id: oauthResponse.workspace.id,
      name: oauthResponse.workspace.name,
      urlKey: oauthResponse.workspace.urlKey,
      accessToken: await encrypt(oauthResponse.access_token),
      refreshToken: await encrypt(oauthResponse.refresh_token),
      expiresAt: Date.now() + (oauthResponse.expires_in * 1000),
      createdAt: Date.now()
    }
    
    await db.workspaces.upsert(workspace)
    
    // Create webhook subscription
    await this.setupWebhooks(workspace)
    
    return workspace
  }
}
```

## Edge Authentication Flow

### 1. Edge Key Generation

After workspace is connected, admins can generate edge keys:

```javascript
// Admin visits dashboard
GET /dashboard/workspace/workspace_123

// Shows workspace info and edge management
"Workspace: Acme Corp"
"Connected Users:"
- user@acme.com [Revoke]
- bot@acme.com [Revoke]

[Generate Edge Key] // Button
```

### 2. Edge Key Creation Flow

```javascript
// Admin clicks "Generate Edge Key"
POST /api/edges/generate
{
  "workspaceId": "workspace_123",
  "userName": "New Edge Worker",
  "permissions": ["read:issues", "write:comments"]
}

// Proxy creates edge credentials
{
  "edgeId": "edge_456",
  "apiKey": "cyr_edge_AbCdEfGhIjKlMnOpQrStUvWxYz",
  "workspaceId": "workspace_123",
  "setupCommand": "cyrus-edge connect https://cyrus-proxy.example.com --key cyr_edge_AbCdEfGhIjKlMnOpQrStUvWxYz"
}
```

### 3. Edge Key Structure

```javascript
// Edge keys are JWTs with embedded permissions
const edgePayload = {
  // Identity
  sub: "edge_456",
  iss: "cyrus-proxy.example.com",
  
  // Workspace binding
  workspaceId: "workspace_123",
  
  // Permissions
  scopes: ["read:issues", "write:comments"],
  
  // Metadata
  name: "Connor's MacBook",
  createdBy: "admin_user_id",
  
  // Expiration (optional)
  exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60)
}

const edgeKey = jwt.sign(edgePayload, EDGE_SECRET)
```

### 4. Edge Connection

```javascript
// Edge worker connects with key
GET /events/stream
Headers: {
  'Authorization': 'Bearer cyr_edge_AbCdEfGhIjKlMnOpQrStUvWxYz'
}

// Proxy validates and extracts info
const auth = await validateEdgeKey(headers.authorization)
// auth = { edgeId, workspaceId, scopes, ... }

// Subscribe edge to workspace events
edgeRegistry.subscribe(auth.edgeId, auth.workspaceId)
```

## User Association Flow

### Option 1: Self-Service User Mapping

```javascript
// After edge connects, it needs to map to Linear user
GET /api/edges/setup

// Returns setup instructions
{
  "status": "pending_user_mapping",
  "instructions": "Visit https://cyrus-proxy.example.com/edges/edge_456/claim",
  "claimToken": "claim_xxx"
}

// User visits claim URL and authenticates with Linear
GET /edges/edge_456/claim?token=claim_xxx
→ Linear OAuth flow (user-level)
→ Maps edge to specific Linear user ID
```

### Option 2: Admin-Assigned User Mapping

```javascript
// Admin assigns edge to user via dashboard
POST /api/edges/edge_456/assign
{
  "linearUserId": "user_789",
  "linearUserEmail": "connor@acme.com"
}
```

### Option 3: Automatic User Detection

```javascript
// Edge provides Linear user email during connection
GET /events/stream
Headers: {
  'Authorization': 'Bearer cyr_edge_xxx',
  'X-Linear-User-Email': 'connor@acme.com'
}

// Proxy looks up user in workspace
const user = await linearClient.users({ 
  filter: { email: { eq: 'connor@acme.com' } } 
})
```

## Complete Authentication Flow

```mermaid
sequenceDiagram
    participant Admin
    participant Proxy
    participant Linear
    participant Edge
    
    Admin->>Proxy: Connect workspace
    Proxy->>Linear: OAuth authorize
    Linear->>Proxy: OAuth callback
    Proxy->>Proxy: Store workspace tokens
    
    Admin->>Proxy: Generate edge key
    Proxy->>Admin: Edge key + setup command
    
    Admin->>Edge: Provide edge key
    Edge->>Proxy: Connect with key
    Proxy->>Proxy: Validate key
    
    Edge->>Proxy: Claim user identity
    Proxy->>Linear: Verify user
    Proxy->>Edge: Start event stream
```

## Security Considerations

### 1. Token Security
- Workspace OAuth tokens encrypted at rest
- Edge keys are signed JWTs
- Support key rotation without downtime
- Audit log for all auth events

### 2. Permission Model
```javascript
// Workspace-level permissions (OAuth)
- read/write issues
- read/write comments  
- manage webhooks

// Edge-level permissions (subset)
- read assigned issues
- write comments on assigned issues
- no admin operations
```

### 3. Revocation Support
```javascript
// Revoke edge access
DELETE /api/edges/edge_456

// Revoke workspace access
DELETE /api/workspaces/workspace_123
→ Also revokes all edges for that workspace
```

## Multi-Workspace Support

```javascript
// Edge can connect to multiple workspaces
const edgeKey = {
  sub: "edge_456",
  workspaces: [
    { id: "workspace_123", scopes: ["read", "write"] },
    { id: "workspace_789", scopes: ["read"] }
  ]
}
```

## Implementation Recommendations

1. **Start Simple**: Single workspace per proxy instance
2. **Use Existing OAuth**: Leverage current OAuthHelper code
3. **JWT for Edges**: Simple, stateless edge authentication
4. **Gradual Enhancement**: Add user mapping after basic flow works

## Configuration

### Proxy Configuration
```env
# OAuth (workspace-level)
LINEAR_CLIENT_ID=xxx
LINEAR_CLIENT_SECRET=xxx
OAUTH_REDIRECT_URI=https://cyrus-proxy.example.com/oauth/callback

# Edge authentication
EDGE_SECRET=random_secret_for_jwt_signing
EDGE_TOKEN_EXPIRY=365d

# Database for workspace/edge storage
DATABASE_URL=postgres://...
```

### Edge Configuration  
```env
# Simple - just the key
CYRUS_EDGE_KEY=cyr_edge_AbCdEfGhIjKlMnOpQrStUvWxYz
CYRUS_PROXY_URL=https://cyrus-proxy.example.com

# Optional user binding
LINEAR_USER_EMAIL=connor@acme.com
```