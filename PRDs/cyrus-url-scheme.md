# Cyrus URL Scheme Implementation Plan

## Overview

Replace the insecure `/setup/start` endpoint with a secure `cyrus://` URL scheme that passes encrypted tokens directly to the Electron app.

## Current Flow (INSECURE)

1. User visits `/setup/start`
2. Gets redirected to `/oauth/authorize`
3. Completes OAuth at Linear
4. Returns to proxy which shows token in plaintext
5. User manually copies configuration

## Proposed Flow (SECURE)

1. User clicks "Connect Linear" in Electron app
2. App opens browser to `/oauth/authorize` (skip `/setup/start` entirely)
3. User completes OAuth at Linear
4. Proxy redirects to `cyrus://setup?payload=SIGNED_PAYLOAD`
5. Electron app handles URL scheme
6. App verifies signature and timestamp, then stores configuration
7. App connects to proxy automatically

## Implementation Steps

### 1. Proxy Changes

```javascript
// In OAuthService.js - After OAuth callback success
const params = new URLSearchParams({
  proxyUrl: CONFIG.PROXY_URL,
  edgeToken: generateEdgeToken(),
  linearToken: oauthToken,
  workspaceId: workspace.id,
  timestamp: Date.now()
})

const cyrusUrl = `cyrus://setup?${params.toString()}`

// Redirect to cyrus:// URL
res.redirect(cyrusUrl)
```

### 2. Security Strategy (No Encryption)

**Chosen Approach: Direct Token Passing**
- Pass tokens directly in cyrus:// URL parameters
- Only visible on user's local machine
- Include timestamp to prevent old URLs from working
- Simple and transparent

**Security Considerations:**
- Token is already on user's machine (they just authorized it)
- cyrus:// URLs are handled locally, not sent over network
- Timestamp prevents sharing/replay after 5 minutes
- Main goal is UX improvement over copy/paste

### 3. Electron App Changes

```javascript
// In main process
app.setAsDefaultProtocolClient('cyrus')

app.on('open-url', (event, url) => {
  event.preventDefault()
  
  const parsed = new URL(url)
  if (parsed.hostname === 'setup') {
    const token = parsed.searchParams.get('token')
    handleSetupToken(token)
  }
})

async function handleSetupUrl(url) {
  try {
    const params = new URL(url).searchParams
    
    // Extract parameters
    const config = {
      proxyUrl: params.get('proxyUrl'),
      edgeToken: params.get('edgeToken'),
      linearToken: params.get('linearToken'),
      workspaceId: params.get('workspaceId'),
      timestamp: parseInt(params.get('timestamp'))
    }
    
    // Validate timestamp (prevent replay)
    if (Date.now() - config.timestamp > 5 * 60 * 1000) {
      throw new Error('Setup link expired')
    }
    
    // Store configuration
    await store.set('config', {
      proxyUrl: payload.proxyUrl,
      edgeToken: payload.edgeToken,
      linearToken: payload.linearToken,
      workspaceId: payload.workspaceId
    })
    
    // Start edge worker
    await startEdgeWorker()
    
    // Show success in UI
    mainWindow.webContents.send('setup-complete')
  } catch (error) {
    mainWindow.webContents.send('setup-error', error.message)
  }
}
```

### 4. Fallback Mechanism

For cases where URL scheme doesn't work:

1. Show a "Having trouble?" link on OAuth success page
2. Link to manual setup with encrypted config blob
3. User can paste blob into Electron app

### 5. Security Considerations

1. **Encryption Key Distribution**
   - Build key into Electron app
   - Rotate with app updates
   - Consider per-deployment keys

2. **Token Expiration**
   - Setup tokens expire after 5 minutes
   - Prevents URL sharing/replay

3. **Platform Handling**
   - Windows: Registry entry for URL scheme
   - macOS: Info.plist configuration
   - Linux: Desktop file registration

## Testing Plan

1. Test URL scheme registration on all platforms
2. Verify encryption/decryption works correctly
3. Test expiration handling
4. Test fallback flow
5. Ensure no tokens in logs/console

## Migration Path

1. Keep `/setup/start` during transition
2. Add warning about insecurity
3. Implement cyrus:// flow
4. Test thoroughly
5. Remove `/setup/start` endpoint

## Alternative Considered

**QR Code Flow**: Show QR code with encrypted payload
- Pro: No URL scheme needed
- Con: Requires camera/QR scanner in app
- Decision: URL scheme is simpler for desktop app