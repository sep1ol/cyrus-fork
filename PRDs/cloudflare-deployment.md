# Cloudflare Deployment Architecture

## Overview

Deploy the Cyrus proxy on Cloudflare Workers with KV for OAuth token storage.

## Technology Stack

- **Cloudflare Workers**: Serverless proxy application
- **Cloudflare KV**: OAuth token and workspace data storage
- **Durable Objects** (optional): Manage edge connections and streaming

## KV Storage Schema

### OAuth Tokens
```javascript
// Key: oauth:workspace:{workspaceId}
// Value:
{
  "accessToken": "encrypted_token",
  "refreshToken": "encrypted_refresh_token",
  "expiresAt": 1234567890,
  "workspaceId": "workspace_123",
  "workspaceName": "Acme Corp"
}
```

### Edge Tokens
```javascript
// Key: edge:token:{tokenHash}
// Value:
{
  "workspaceId": "workspace_123",
  "createdAt": 1234567890,
  "lastSeen": 1234567890
}
```

### Setup Sessions
```javascript
// Key: setup:{deviceToken}
// Value:
{
  "callbackPort": 9876,
  "createdAt": 1234567890,
  "expiresAt": 1234567890
}
// TTL: 15 minutes
```

## Cloudflare-Specific Considerations

1. **Workers Limitations**:
   - 10ms CPU time (50ms on paid plan)
   - No long-running connections
   - Use Durable Objects for WebSocket/SSE

2. **KV Characteristics**:
   - Eventually consistent (few seconds)
   - 60 seconds TTL for deletes
   - Perfect for OAuth tokens (infrequent writes)

3. **Streaming Events**:
   - Use Durable Objects for persistent connections
   - Or use Cloudflare Pub/Sub (when available)
   - Or polling-based approach with KV

## Implementation Notes

- Use Wrangler CLI for deployment
- KV namespaces for different environments
- Cloudflare Secrets for sensitive config
- Workers Sites for dashboard UI