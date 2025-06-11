# Simplified OAuth-Edge Flow

## Overview

Since there's only ONE edge per workspace and the person authenticating Linear access is on the device where they'll run the edge client, we can dramatically simplify the flow by combining OAuth completion with edge setup.

## Core Insight

The OAuth callback moment is the perfect time to establish the edge connection because:
1. User just proved they have Linear workspace access
2. They're on the device that will run the edge client
3. We can use a custom URL scheme to pass credentials securely

## Simplified Architecture

```
┌─────────────────┐
│   Linear.app    │
│                 │
│ OAuth Provider  │
└────────┬────────┘
         │ OAuth Flow
         ▼
┌─────────────────┐
│  Cyrus Proxy    │     cyrus://setup?token=xxx
│                 ├─────────────────────────────►
│ • OAuth Client  │                              │
│ • Token Store   │                              │
└─────────────────┘                              │
                                                 ▼
                                    ┌─────────────────────┐
                                    │  Edge Client        │
                                    │  (Same Device)      │
                                    │                     │
                                    │ • Receives token    │
                                    │ • Stores locally    │
                                    │ • Connects to proxy │
                                    └─────────────────────┘
```

## Implementation Flow

### 1. Setup Initiation

```javascript
// User runs on their local machine
$ cyrus setup

// Edge client starts local server to receive callback
Starting setup server on http://localhost:9876
Opening browser to start Linear authorization...

// Opens browser
open https://cyrus-proxy.example.com/setup/start?callback_port=9876
```

### 2. OAuth Flow with Device Token

```javascript
// Proxy generates a device token for this setup session
GET /setup/start?callback_port=9876

// Generate unique device token
const deviceToken = crypto.randomBytes(32).toString('hex')
const setupSession = {
  deviceToken,
  callbackPort: 9876,
  createdAt: Date.now(),
  expiresAt: Date.now() + (15 * 60 * 1000) // 15 minutes
}
await cache.set(`setup:${deviceToken}`, setupSession)

// Redirect to Linear OAuth with device token in state
302 → https://linear.app/oauth/authorize?
  client_id=cyrus_client_id&
  redirect_uri=https://cyrus-proxy.example.com/oauth/callback&
  state=${deviceToken}&
  scope=read,write,issues:create,comments:create&
  actor=application
```

### 3. OAuth Callback with Edge Token Generation

```javascript
// Linear redirects back
GET /oauth/callback?code=xxx&state=deviceToken123

// Proxy handles callback
async function handleOAuthCallback(code, state) {
  // Exchange code for Linear tokens
  const linearTokens = await exchangeCodeForTokens(code)
  
  // Store workspace credentials
  const workspace = await registerWorkspace(linearTokens)
  
  // Generate edge token for this workspace
  const edgeToken = jwt.sign({
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    createdAt: Date.now()
  }, EDGE_SECRET)
  
  // Get setup session
  const setupSession = await cache.get(`setup:${state}`)
  
  if (setupSession) {
    // Redirect to local edge client
    return redirect(`http://localhost:${setupSession.callbackPort}/callback?token=${edgeToken}`)
  } else {
    // Fallback: Show token to copy manually
    return showManualSetupPage(edgeToken)
  }
}
```

### 4. Edge Client Receives Token

```javascript
// Edge client's local server receives token
GET http://localhost:9876/callback?token=xxx

// Edge client handles callback
async function handleSetupCallback(token) {
  // Validate token
  const payload = jwt.verify(token, PROXY_PUBLIC_KEY)
  
  // Store edge configuration
  await saveConfig({
    proxyUrl: 'https://cyrus-proxy.example.com',
    edgeToken: token,
    workspaceId: payload.workspaceId,
    workspaceName: payload.workspaceName
  })
  
  // Show success
  console.log(`✅ Successfully connected to ${payload.workspaceName}`)
  console.log('You can now close this browser window')
  
  // Start edge client
  await startEdgeClient()
}
```

## Alternative: Custom URL Scheme

Instead of localhost callback, use a custom URL scheme:

```javascript
// Register cyrus:// protocol handler
// OAuth callback redirects to:
cyrus://setup?token=xxx

// Edge client handles the deep link
app.on('open-url', (event, url) => {
  if (url.startsWith('cyrus://setup')) {
    const token = new URL(url).searchParams.get('token')
    handleSetupCallback(token)
  }
})
```

## Security Considerations

### 1. Token Security
- Edge tokens are signed JWTs
- Short-lived setup sessions (15 minutes)
- One-time use device tokens
- Tokens never shown in browser history

### 2. CSRF Protection
- Device token in OAuth state parameter
- Validates setup session exists and isn't expired
- Local callback port is random

### 3. Workspace Isolation
- One edge token per workspace
- Edge can only access its own workspace
- Proxy validates workspace access on every request

## Benefits of This Approach

1. **Zero Configuration**: No manual key copying
2. **Secure**: Token passes directly to local client
3. **Simple**: One OAuth flow sets up everything
4. **User-Friendly**: Just click "Connect Linear" and done

## Edge Client Commands

```bash
# Initial setup
$ cyrus setup
→ Opens browser for OAuth flow
→ Receives token automatically
→ Starts edge client

# Check status
$ cyrus status
Connected to: Acme Corp (workspace_123)
Proxy: https://cyrus-proxy.example.com
Status: Connected ✅

# Disconnect
$ cyrus disconnect
→ Removes local configuration
→ Optionally revokes token on proxy

# Reconnect
$ cyrus connect
→ Uses existing token if valid
→ Otherwise prompts for new setup
```

## Implementation Steps

1. **Modify OAuth callback** to generate edge tokens
2. **Add local setup server** to edge client
3. **Implement token exchange** flow
4. **Add status/disconnect** commands
5. **Handle edge reconnection** with stored tokens

## Configuration Storage

```javascript
// Edge client stores configuration at:
// ~/.cyrus/config.json
{
  "proxyUrl": "https://cyrus-proxy.example.com",
  "edgeToken": "eyJ...",
  "workspaceId": "workspace_123",
  "workspaceName": "Acme Corp",
  "connectedAt": "2024-01-15T10:00:00Z"
}
```

This approach eliminates the complexity of separate edge authentication while maintaining security through the OAuth flow and signed tokens.