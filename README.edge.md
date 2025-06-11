# Cyrus Edge-Proxy Architecture

Cyrus now uses a separated edge-proxy architecture where:
- **Proxy**: Handles OAuth, receives webhooks, and streams events (runs in cloud)
- **Edge**: Processes issues with Claude, manages workspaces (runs on your machine)

## Quick Start

### 1. Deploy the Proxy (Cloud)

```bash
# Clone the repository
git clone https://github.com/ceedaragents/cyrus.git
cd cyrus

# Set up proxy environment
cp .env.proxy.example .env.proxy
# Edit .env.proxy with your Linear app credentials

# Start the proxy
npm run proxy
```

The proxy handles:
- Linear OAuth flow
- Webhook reception
- Event streaming to edge workers

### 2. Set Up Edge Worker (Local)

```bash
# On your local machine
git clone https://github.com/ceedaragents/cyrus.git
cd cyrus

# Visit your proxy to get edge configuration
# Go to: https://your-proxy.com/setup/start

# Create edge configuration
cp .env.edge.example .env.edge
# Add the configuration from the setup page

# Start the edge worker
npm run edge
```

The edge worker:
- Connects to your proxy via NDJSON streaming
- Processes Linear issues with Claude Code
- Manages local Git worktrees

## Architecture Benefits

1. **Security**: OAuth tokens stay in the proxy
2. **Scalability**: Multiple developers can run edge workers
3. **Flexibility**: Edge workers can be behind firewalls
4. **Simplicity**: No webhooks or OAuth on developer machines

## Configuration

### Proxy Configuration (.env.proxy)

```env
# Linear OAuth app credentials
LINEAR_CLIENT_ID=your_client_id
LINEAR_CLIENT_SECRET=your_client_secret
LINEAR_WEBHOOK_SECRET=your_webhook_secret

# Server settings
PROXY_PORT=3000
```

### Edge Configuration (.env.edge)

```env
# Proxy connection
PROXY_URL=https://your-proxy.com
EDGE_TOKEN=edge_token_from_setup

# Linear OAuth token (from proxy setup)
LINEAR_OAUTH_TOKEN=oauth_token_from_setup

# Local settings
WORKSPACE_BASE_DIR=./workspaces
CLAUDE_PATH=/usr/local/bin/claude
```

## Development

```bash
# Run proxy in development
npm run dev:proxy

# Run edge in development
npm run dev:edge

# Run tests
npm test
```

## Deployment

### Proxy Deployment

The proxy can be deployed to any Node.js hosting:
- Heroku
- Railway
- Fly.io
- AWS/GCP/Azure
- Cloudflare Workers (future)

### Edge Requirements

- Node.js 18+
- Claude Code CLI installed
- Git (for worktree management)
- Access to your codebase

## Troubleshooting

### Edge won't connect
- Check PROXY_URL is accessible
- Verify EDGE_TOKEN is correct
- Check proxy logs for connection attempts

### OAuth issues
- Ensure OAuth redirect URI matches proxy URL
- Check Linear app has correct scopes
- Try resetting OAuth via proxy dashboard

### No events received
- Verify Linear webhook is configured
- Check webhook secret matches
- Enable DEBUG_WEBHOOKS=true in proxy