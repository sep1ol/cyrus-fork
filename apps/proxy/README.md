# Cyrus Edge Proxy Server

The edge proxy server handles Linear webhooks, OAuth authentication, and event streaming to edge workers.

## Architecture

```
[Linear] --webhooks--> [Proxy Server] <--NDJSON--> [Edge Workers]
                           |
                           └── OAuth flow
```

## Setup

1. **Create a Linear OAuth App**:
   - Go to https://linear.app/settings/api/applications/new
   - Set redirect URL to `http://localhost:3456/oauth/callback`
   - Note your Client ID and Client Secret

2. **Configure environment**:
   ```bash
   cp .env.proxy.example .env.proxy
   # Edit .env.proxy with your Linear credentials
   ```

3. **Install dependencies**:
   ```bash
   pnpm install
   ```

## Running the Proxy

```bash
# Start the proxy server
pnpm start

# Development mode with auto-reload
pnpm dev
```

The proxy will start on port 3456 by default.

## Exposing for Webhooks

For local development, you need to expose the proxy publicly for Linear webhooks:

```bash
# Using ngrok
ngrok http 3456

# Update your Linear webhook URL to:
# https://your-ngrok-url.ngrok.io/webhooks/linear
```

## Endpoints

- `GET /` - Dashboard
- `GET /oauth/authorize` - Start OAuth flow
- `GET /oauth/callback` - OAuth callback
- `POST /webhooks/linear` - Linear webhook receiver
- `GET /events/stream` - NDJSON event stream for edge workers

## OAuth Flow

1. Edge worker directs user to `/oauth/authorize?callback=http://localhost:3457/callback`
2. User authorizes with Linear
3. Proxy receives OAuth callback
4. Proxy redirects to edge worker's callback with token

## Event Stream

Edge workers connect to the event stream endpoint with their Linear OAuth token:

```bash
curl -H "Authorization: Bearer YOUR_LINEAR_TOKEN" \
     -H "Accept: application/x-ndjson" \
     http://localhost:3456/events/stream
```

Events are streamed as NDJSON:
```json
{"type":"webhook","id":"123","data":{...}}
{"type":"heartbeat","timestamp":"2024-01-01T00:00:00Z"}
```

## Production Deployment

The proxy is designed to be deployed to:
- Cloudflare Workers
- AWS Lambda
- Any Node.js hosting

For production:
1. Set `OAUTH_REDIRECT_URI` to your production URL
2. Update Linear OAuth app settings
3. Use environment variables for secrets
4. Enable HTTPS