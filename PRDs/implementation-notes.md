# Edge-Proxy Implementation Notes

This document captures important learnings and decisions made during the implementation of the edge-proxy architecture.

## Architectural Decisions

### 1. OAuth Token Distribution
**Problem**: How to securely provide OAuth tokens from proxy to edge workers
**Current Solution**: `/setup/start` endpoint shows tokens (INSECURE)
**Planned Solution**: Use `cyrus://` URL scheme to pass encrypted tokens directly to Electron app
**Why**: Prevents tokens from being visible in browser/network logs

### 2. NDJSON vs WebSocket
**Decision**: Use NDJSON streaming over HTTP
**Why**: 
- Simpler than WebSocket
- Human-readable for debugging
- Works well with Cloudflare Workers
- Built-in HTTP features (auth headers, etc.)

### 3. Single Workspace Per Proxy (for MVP)
**Decision**: One Linear workspace per proxy instance
**Why**: 
- Simplifies routing (no need to determine which edge gets which webhook)
- Matches current single-user model
- Can expand later if needed

### 4. Edge Workers Need Linear API Access
**Initial Thought**: Proxy handles all Linear API calls
**Reality**: Edge workers need direct Linear API access to post comments, update issues
**Solution**: OAuth token is shared with edge workers
**Current Implementation**: Token in `.env.edge` file (TEMPORARY - for testing only)
**Final Implementation**: Electron app will securely store and use tokens
**Why**: Avoids complex proxy-through patterns for every API call

### 5. Environment Variables are Temporary
**Important**: The current `.env.edge` approach is purely for testing
**Do NOT**: Spend time securing environment variable handling
**Do NOT**: Build complex token rotation for .env files
**Final Solution**: Electron app handles all edge configuration securely
**Why**: Environment variables are insecure for production OAuth tokens

## Implementation Gotchas

### 1. FileSystem Dependency
**Issue**: OAuthHelper expects FileSystem for token storage
**Impact**: Proxy needs filesystem access (not ideal for Cloudflare)
**Fix**: Will need to abstract storage interface for KV support

### 2. OAuthHelper Constructor
**Issue**: Constructor changed from individual params to config object
**Old**: `new OAuthHelper(clientId, clientSecret, redirectUri, workspaceDir, fileSystem)`
**New**: `new OAuthHelper({clientId, clientSecret, redirectUri, tokenStoragePath}, fileSystem)`
**Impact**: Broke initial proxy implementation

### 3. Port Conflicts
**Issue**: Port 3000 commonly used by other dev servers
**Solution**: Default to 3456 for proxy
**Lesson**: Make ports easily configurable

### 4. Webhook Event Structure
**Issue**: Linear has two webhook formats (legacy and Agent API)
**Solution**: EventProcessor handles both formats
**Note**: Agent API format is preferred for new features

## Security Considerations

### 1. Public Proxy Endpoints
**Design**: Proxy is publicly accessible (for webhooks)
**Risk**: Information disclosure about authentication status
**Mitigation**: Removed status indicators from public pages

### 2. OAuth State Storage
**Current**: Stored in filesystem (temporary)
**Risk**: State parameter collision in multi-user scenario
**Future**: Use KV with TTL for state storage

### 3. Edge Authentication
**Current**: Simple bearer tokens
**Future**: Consider JWT with expiration and rotation

## Testing Insights

### 1. Integration Testing
**Success**: NDJSON streaming works reliably
**Success**: Reconnection logic handles network interruptions
**Challenge**: Testing OAuth flow requires real Linear app

### 2. Local Development
**Tip**: Use ngrok for OAuth redirect testing
**Tip**: Run proxy and edge in separate terminals
**Tip**: Enable debug logs for troubleshooting

## Next Steps Priority

1. **Security First**: Implement cyrus:// URL scheme for token distribution
2. **User Experience**: Build Electron app with live issue monitoring
3. **Scalability**: Migrate to Cloudflare Workers
4. **Reliability**: Add comprehensive error handling

## Cloudflare Migration Notes

### Required Changes
1. Replace Express with Workers router
2. Replace FileSystem with KV for token storage
3. Handle NDJSON streaming (may need Durable Objects)
4. Update OAuth redirect handling for Workers environment

### KV Schema Planning
```
oauth:token:{workspaceId} -> {accessToken, refreshToken, expiresAt}
oauth:state:{state} -> {timestamp, TTL: 15min}
edge:tokens:{edgeId} -> {workspaceId, created, lastSeen}
```

## Electron App Considerations

### Protocol Handler Registration
- Must register `cyrus://` handler on app install
- Handle both Windows and macOS registration
- Provide fallback for manual token entry

### State Management
- Use main process for edge worker management
- Renderer process for UI only
- IPC for communication between processes

### Auto-Update Strategy
- Use electron-updater for seamless updates
- Sign releases for macOS notarization
- Consider staged rollout for major changes