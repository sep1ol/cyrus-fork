# Cyrus Edge-Proxy Architecture: Master Documentation

**⚠️ IMPORTANT: This is the master documentation for the edge-proxy architecture. Read this document completely before proceeding with any development.**

## Current Status (June 2025)

The edge-proxy architecture has been successfully implemented and tested. The system separates OAuth/webhook handling (proxy) from Claude processing (edge workers), allowing developers to run edge workers on their local machines while a centralized proxy handles Linear authentication.

### What's Working
- ✅ OAuth flow through proxy server
- ✅ NDJSON streaming from proxy to edge workers
- ✅ Webhook reception and forwarding
- ✅ Real Linear credentials tested and functional
- ✅ Edge client with automatic reconnection
- ✅ OAuth token distribution (TEMPORARY via `.env.edge` - will be replaced by Electron)

### What's Not Yet Implemented
- ❌ Secure token distribution via `cyrus://` URL scheme
- ❌ Electron GUI for edge workers
- ❌ Cloudflare Workers deployment
- ❌ Production-ready error handling
- ❌ Multi-workspace routing

## Required Reading

Before proceeding, you MUST read these documents in order:

1. **[Architecture Overview](./PRDs/edge-proxy-architecture.md)** - Understand the system design
2. **[OAuth Flow Design](./PRDs/simplified-oauth-edge-flow.md)** - Understand authentication flow
3. **[Implementation Notes](./PRDs/implementation-notes.md)** - Learn from implementation decisions and gotchas
4. **[Native Client Design](./PRDs/native-edge-client.md)** - Understand the planned Electron app
5. **[Message Schema Spec](./PRDs/claude-message-schema-ui-spec.md)** - Understand Claude's message format for the UI

## Architecture Summary

```
┌─────────────────┐
│   Linear.app    │
│                 │
└────────┬────────┘
         │ Webhooks + OAuth
         ▼
┌─────────────────┐
│  Proxy Server   │ (Cloud - Currently localhost:3456)
│                 │
│ • OAuth flow    │
│ • Webhook recv  │
│ • NDJSON stream │
└────────┬────────┘
         │ NDJSON over HTTP
         ▼
┌─────────────────┐
│  Edge Worker    │ (Developer's machine)
│                 │
│ • Claude exec   │
│ • Git worktrees │
└─────────────────┘
```

## Current Implementation Details

### Proxy Server (`src/proxy/`)
- **ProxyServer.mjs** - Main server coordinating all services
- **OAuthService.mjs** - Handles Linear OAuth flow
- **WebhookReceiver.mjs** - Receives and validates Linear webhooks
- **EventStreamer.mjs** - Streams events to edge workers via NDJSON

### Edge Worker (`src/edge/`)
- **EdgeClient.mjs** - NDJSON client with reconnection logic
- **EventProcessor.mjs** - Processes webhooks using existing LinearIssueService
- **EdgeWorker.mjs** - Coordinates client and processing
- **app.mjs** - Edge application entry point

### Key Learnings from Implementation

1. **OAuth State Issue**: The proxy needs filesystem access for OAuth state storage (will be replaced with KV in Cloudflare)
2. **Port Conflicts**: Default port 3000 often conflicts; we use 3456
3. **Token Security**: Current `/setup/start` endpoint exposes OAuth tokens to anyone - MUST be fixed
4. **NDJSON Works Well**: Streaming connection is stable with proper reconnection

## Critical: Current Token Distribution is TEMPORARY

**Current State (FOR TESTING ONLY)**:
- `/setup/start` endpoint shows OAuth token to anyone who visits
- Tokens are manually copied to `.env.edge` file
- This entire approach will be REPLACED by Electron app
- DO NOT spend time securing the environment variable approach
- DO NOT try to "fix" `/setup/start` by hiding tokens - replace it entirely with cyrus:// URL scheme

**Final Solution (Electron)**:
1. User clicks "Connect Linear" in Electron app (or visits `/oauth/authorize` directly)
2. After OAuth callback, proxy redirects to `cyrus://setup?proxyUrl=...&linearToken=...&timestamp=...`
3. Electron app registers `cyrus://` protocol handler
4. Tokens passed as URL parameters (no encryption needed)
5. Electron app stores tokens securely (never in .env files)
6. No manual configuration needed by users

## Roadmap for Next Developer

### Phase 1: Secure Token Distribution (PRIORITY)
1. Read **[Cyrus URL Scheme Design](./PRDs/cyrus-url-scheme.md)** for implementation details
2. Implement token encryption in proxy
3. Modify OAuth callback to redirect to `cyrus://` URL scheme
4. Create test Electron app that handles `cyrus://` protocol
5. Remove insecure `/setup/start` token display

### Phase 2: Electron App Development
1. Review [Native Client Design](./PRDs/native-edge-client.md)
2. Create Electron app structure
3. Implement `cyrus://` protocol handler
4. Build UI based on [Message Schema Spec](./PRDs/claude-message-schema-ui-spec.md)
5. Integrate existing EdgeWorker class
6. Replace ALL environment variable usage with secure Electron storage
7. Remove edge.mjs CLI entirely (replaced by Electron app)

### Phase 3: Cloudflare Deployment
1. Review [Cloudflare Deployment Notes](./PRDs/cloudflare-deployment.md)
2. Replace FileSystem with KV for OAuth storage
3. Convert Express routes to Cloudflare Workers format
4. Handle NDJSON streaming in Workers (may need Durable Objects)

### Phase 4: Production Hardening
1. Add proper error handling and retry logic
2. Implement webhook signature verification
3. Add monitoring and observability
4. Handle edge worker authentication rotation
5. Support multiple workspaces per proxy

## Development Setup

### Running the Current System

1. **Start Proxy**:
   ```bash
   cp .env.proxy.example .env.proxy
   # Edit with real Linear credentials
   npm run proxy
   ```

2. **Start Edge** (in another terminal):
   ```bash
   cp .env.edge.example .env.edge
   # Add OAuth token from proxy setup
   npm run edge
   ```

3. **Test OAuth Flow**:
   - Visit http://localhost:3456/setup/start
   - Authorize with Linear
   - Copy configuration (TEMPORARY - will be replaced with cyrus:// flow)

### Environment Variables

**Proxy** (`.env.proxy`):
- `LINEAR_CLIENT_ID` - Linear OAuth app ID
- `LINEAR_CLIENT_SECRET` - Linear OAuth app secret
- `LINEAR_WEBHOOK_SECRET` - Webhook signature secret
- `OAUTH_REDIRECT_URI` - Must match Linear app settings
- `PROXY_PORT` - Local port (default: 3456)

**Edge** (`.env.edge`) - **TEMPORARY - Will be replaced by Electron app**:
- `PROXY_URL` - Proxy server URL
- `EDGE_TOKEN` - Edge authentication token  
- `LINEAR_OAUTH_TOKEN` - Linear OAuth token (TEMPORARY - insecure)
- `CLAUDE_PATH` - Path to Claude CLI

⚠️ **Note**: The entire `.env.edge` approach is temporary for testing. The Electron app will handle all configuration securely without environment variables.

## Testing Checklist

- [ ] OAuth flow completes successfully
- [ ] Edge worker connects to proxy
- [ ] Webhooks forward to edge worker
- [ ] Edge worker processes webhooks
- [ ] Reconnection works after network interruption
- [ ] Multiple edge workers can connect (future)

## Important Code Paths

1. **OAuth Flow**: 
   - Start: `OAuthService.registerRoutes()` → `/oauth/authorize`
   - Callback: `/oauth/callback` → `OAuthHelper.handleCallback()`
   - Token Storage: `OAuthHelper._saveTokenInfo()`

2. **Webhook Flow**:
   - Receipt: `WebhookReceiver.registerRoutes()` → `/webhook`
   - Transform: `EventStreamer.transformWebhookToEvent()`
   - Stream: `EventStreamer.sendToEdge()`
   - Process: `EventProcessor.processWebhook()`

3. **Edge Connection**:
   - Connect: `EdgeClient.connect()`
   - Stream: `EdgeClient.processStream()`
   - Reconnect: `EdgeClient.reconnect()`

## Next Developer Action Items

1. **Read all linked PRD documents** (30 minutes)
2. **Run the system locally** to understand current state (15 minutes)
3. **Review security issue** with token distribution (10 minutes)
4. **Choose your focus**:
   - If security-focused: Implement cyrus:// URL scheme
   - If UI-focused: Start Electron app
   - If infrastructure-focused: Begin Cloudflare migration

## Questions to Consider

1. How should edge workers authenticate after token rotation?
2. Should we support multiple Linear workspaces per proxy?
3. How do we handle proxy downtime for edge workers?
4. What metrics should we track for monitoring?

## Contact

For questions about this architecture:
- Review commit history for decision rationale
- Check PR discussions for implementation details
- Original design by: [Previous Developer Context]

---

**Remember**: The current `/setup/start` endpoint is INSECURE. This must be your first priority if deploying beyond local development.