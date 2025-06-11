# Edge-Proxy Architecture PRD

## Overview

This document outlines the architecture for separating the OAuth service and HTTP service in Cyrus, enabling a centralized proxy that forwards webhook events to edge workers running on users' local machines.

## Goals

1. **Centralized OAuth Management**: OAuth tokens and authentication flow remain on a central server
2. **Edge Processing**: Claude Code execution happens on users' local machines
3. **Simple Streaming**: Use NDJSON (newline-delimited JSON) for event streaming
4. **Server-Side Responses**: The central proxy handles all responses to Linear, eliminating the need for edge-to-proxy response channels

## Architecture

### System Components

```
┌─────────────────────┐
│   Linear.app        │
│                     │
│ • Sends webhooks    │
│ • OAuth provider    │
│ • Receives API calls│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Central Proxy      │
│  (Cloud-hosted)     │
│                     │
│ • OAuth Service     │
│ • Webhook Handler   │
│ • Event Streamer    │
│ • Linear API Client │
│ • Response Handler  │
└──────────┬──────────┘
           │
           │ NDJSON Stream over HTTP
           │ (Server-Sent Events)
           ▼
┌─────────────────────┐
│  Edge Worker        │
│  (User's Machine)   │
│                     │
│ • NDJSON Reader     │
│ • Event Processor   │
│ • Claude Sessions   │
│ • Status Reporter   │
└─────────────────────┘
```

### Data Flow

1. **Webhook Receipt**:
   - Linear sends webhook to central proxy
   - Proxy validates webhook signature
   - Proxy enriches event with necessary context

2. **Event Streaming**:
   - Proxy streams event as NDJSON to connected edge workers
   - Each event is a single line of JSON followed by newline
   - Events include all necessary data for processing

3. **Edge Processing**:
   - Edge worker reads NDJSON stream
   - Processes event locally with Claude Code
   - Reports processing status back to proxy

4. **Response Handling**:
   - Edge sends minimal status update to proxy
   - Proxy constructs and sends full response to Linear
   - Proxy handles all Linear API interactions

## Technical Implementation

### NDJSON Event Format

```json
{"id":"evt_123","type":"webhook","timestamp":"2024-01-15T10:00:00Z","data":{"webhookType":"issueAssignedToYou","issue":{"id":"LIN-123","title":"Fix bug","description":"..."}}}
{"id":"evt_124","type":"webhook","timestamp":"2024-01-15T10:01:00Z","data":{"webhookType":"issueCommentMention","comment":{"id":"comment_456","body":"@agent please help"}}}
{"id":"evt_125","type":"heartbeat","timestamp":"2024-01-15T10:02:00Z"}
```

### Edge Client Implementation

```javascript
// Using native fetch with ReadableStream
async function connectToProxy(proxyUrl, apiKey) {
  const response = await fetch(`${proxyUrl}/events/stream`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/x-ndjson'
    }
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.trim()) {
        const event = JSON.parse(line)
        await processEvent(event)
      }
    }
  }
}

// Alternative using ndjson-readablestream package
import ndjson from 'ndjson-readablestream'

async function connectWithNdjson(proxyUrl, apiKey) {
  const response = await fetch(`${proxyUrl}/events/stream`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/x-ndjson'
    }
  })

  const reader = ndjson(response.body)
  
  for await (const event of reader) {
    await processEvent(event)
  }
}
```

### Status Reporting

Edge workers report minimal status updates:

```javascript
// Edge → Proxy status update
POST /events/status
{
  "eventId": "evt_123",
  "status": "processing" | "completed" | "failed",
  "error": "optional error message"
}
```

The proxy then handles all Linear API interactions based on these status updates.

### Central Proxy Endpoints

```
GET  /                      # Dashboard
GET  /oauth/authorize       # Start OAuth flow
GET  /oauth/callback        # OAuth callback
GET  /oauth/status          # Check auth status
POST /webhook               # Linear webhook receiver
GET  /events/stream         # NDJSON event stream
POST /events/status         # Receive status from edge
```

### Edge Worker Endpoints

```
GET  /health               # Health check
GET  /status               # Current processing status
POST /admin/reconnect      # Force reconnection to proxy
```

## Security Considerations

1. **API Key Authentication**: Edge workers authenticate with API keys
2. **No Token Exposure**: OAuth tokens never leave the central proxy
3. **Webhook Verification**: All webhooks verified before processing
4. **TLS Required**: All communication must use HTTPS
5. **Rate Limiting**: Protect against abuse

## Benefits

1. **Simplified Architecture**: No complex bidirectional communication
2. **Centralized Control**: All Linear API interactions from one place
3. **Easy Debugging**: NDJSON streams are human-readable
4. **Resilient**: Built-in reconnection and error handling
5. **Scalable**: Multiple edge workers per user/organization

## Configuration

### Central Proxy Configuration
```env
# OAuth
LINEAR_CLIENT_ID=xxx
LINEAR_CLIENT_SECRET=xxx
LINEAR_WEBHOOK_SECRET=xxx

# Server
PORT=3000
DATABASE_URL=postgres://...

# Security
EDGE_API_KEYS=key1,key2,key3
```

### Edge Worker Configuration
```env
# Proxy Connection
PROXY_URL=https://cyrus-proxy.example.com
EDGE_API_KEY=xxx

# Local Processing
CLAUDE_PATH=/usr/local/bin/claude
WORKSPACE_BASE_DIR=./workspaces
```

## Implementation Phases

### Phase 1: Core Infrastructure
- Extract OAuth service from webhook handler
- Implement NDJSON streaming endpoint
- Basic edge client with ReadableStream

### Phase 2: Event Processing
- Complete webhook-to-NDJSON transformation
- Edge event processor implementation
- Status reporting system

### Phase 3: Production Readiness
- Error handling and retry logic
- Monitoring and observability
- Documentation and deployment guides

## Open Questions

1. Should we support WebSocket as an alternative to SSE?
2. How should we handle edge worker authentication rotation?
3. What metrics should we track for monitoring?
4. Should events be persisted for replay capabilities?