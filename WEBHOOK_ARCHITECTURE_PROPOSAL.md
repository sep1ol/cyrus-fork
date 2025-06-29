# Webhook Architecture Proposal: SSE to Webhook Migration

**Issue**: [CEA-128](https://linear.app/ceedaragents/issue/CEA-128/switch-from-a-client-request-and-server-sent-events-streaming-solution)

## Executive Summary

This proposal outlines the migration from the current Server-Sent Events (SSE) based architecture to a webhook-driven solution for the ndjson-client + proxy-worker communication system. The change eliminates persistent connections, simplifies the architecture, and improves scalability.

## Current Architecture Analysis

### Current SSE-Based Flow
```
Linear → Proxy Worker → NDJSON/SSE Stream → Edge Workers (Electron Apps)
```

**Key Components:**
- `EventStreamer` - Handles webhook reception and broadcasting
- `EventStreamDurableObject` - Maintains persistent NDJSON connections
- `NdjsonClient` - Consumes NDJSON streams with reconnection logic
- Cloudflare KV - Tracks edge worker connections

### Current Problems
1. **Resource Intensive**: Persistent connections consume resources on both proxy and edge workers
2. **Connection Limits**: SSE limited to 100 concurrent connections per IP address
3. **Complex Reconnection**: Exponential backoff logic required for connection drops
4. **State Management**: Durable Objects needed to maintain connection state
5. **Network Reliability**: Connection drops require full reconnection cycle

## Proposed Webhook Architecture

### New Webhook-Driven Flow
```
Linear → Proxy Worker → Direct HTTP Webhooks → Edge Workers
```

**Architecture Benefits:**
- ✅ No persistent connections needed
- ✅ Simple HTTP request/response model  
- ✅ No connection limits
- ✅ Built-in retry mechanisms
- ✅ Stateless architecture
- ✅ Better resource utilization
- ✅ **Modular Design**: ndjson-client remains as a package with transport abstraction
- ✅ **Backward Compatibility**: Same EventEmitter API for existing consumers

## Modular Architecture Approach

This proposal maintains the existing `ndjson-client` package while adding webhook transport capability. This approach provides several benefits:

### Transport Abstraction
- **Same API**: Consumers use the same EventEmitter interface regardless of transport
- **Configuration-driven**: Switch between SSE and webhook modes via config
- **Graceful Migration**: Can deploy webhook support without breaking existing SSE users

### Package Structure
```
packages/ndjson-client/
├── src/
│   ├── NdjsonClient.ts       # Main client with transport abstraction
│   ├── transports/
│   │   ├── SSETransport.ts   # Existing SSE implementation
│   │   └── WebhookTransport.ts # New webhook implementation
│   ├── types.ts              # Existing types + transport config
│   └── index.ts              # Export unified client
```

### Benefits of Modular Approach
- **Reusability**: Other applications can use ndjson-client with webhook transport
- **Testing**: Easier to unit test transport implementations separately
- **Maintenance**: Clean separation of concerns between transports
- **Future-proof**: Easy to add additional transports (WebSocket, gRPC, etc.)

## Detailed Design

### 1. Edge Worker Registration System

Replace persistent connections with webhook endpoint registration:

```typescript
// New endpoint: POST /edge/register
interface EdgeWorkerRegistration {
  webhookUrl: string;        // Where to send webhooks
  linearToken: string;       // For workspace access validation
  name: string;             // Human-readable identifier
  capabilities: string[];   // What webhook types to receive
}
```

**Storage**: Use Cloudflare KV with TTL for webhook registrations
**Security**: Validate Linear tokens and workspace access during registration

### 2. Webhook Delivery Service

Replace `EventStreamer.broadcastToWorkspace()` with direct webhook calls:

```typescript
class WebhookSender {
  async sendWebhookToEdgeWorkers(event: EdgeEvent, workspaceId: string): Promise<void> {
    const edgeWorkers = await this.getRegisteredEdgeWorkers(workspaceId);
    
    for (const worker of edgeWorkers) {
      await this.deliverWebhookWithRetry(worker.webhookUrl, event, worker.secret);
    }
  }
  
  private async deliverWebhookWithRetry(url: string, event: EdgeEvent, secret: string): Promise<void> {
    // Implement exponential backoff retry logic
    // HMAC-SHA256 signature for security
  }
}
```

### 3. Enhanced NdjsonClient with Webhook Transport

Extend `NdjsonClient` to support webhook transport while maintaining the same EventEmitter API:

```typescript
// Extended configuration for webhook mode
interface NdjsonClientConfig {
  proxyUrl: string
  token: string
  transport: 'sse' | 'webhook'  // New: transport mode selection
  webhookPort?: number          // New: for webhook mode
  webhookPath?: string          // New: webhook endpoint path
  // ... existing config options
}

// Enhanced NdjsonClient supports both transports
class NdjsonClient extends EventEmitter {
  private transport: 'sse' | 'webhook'
  private webhookServer?: http.Server
  
  async connect(): Promise<void> {
    if (this.transport === 'webhook') {
      await this.startWebhookServer()
    } else {
      await this.connectSSE()  // existing SSE logic
    }
  }
  
  private async startWebhookServer(): Promise<void> {
    // Create HTTP server for webhook reception
    // Register webhook URL with proxy-worker
    // Maintain same EventEmitter interface
  }
}
```

## Implementation Plan

### Phase 1: Core Infrastructure (Week 1-2)
- [ ] Add webhook registration endpoints to proxy-worker
- [ ] Implement `WebhookSender` class
- [ ] Add KV storage for webhook registrations
- [ ] Implement HMAC-SHA256 signature system

### Phase 2: Edge Worker Updates (Week 2-3)  
- [ ] Extend `NdjsonClient` with webhook transport support
- [ ] Add webhook server capability to ndjson-client package
- [ ] Update Electron apps to use webhook transport mode
- [ ] Add automatic webhook endpoint registration

### Phase 3: Testing & Migration (Week 3-4)
- [ ] Integration testing with webhook flow
- [ ] Performance testing vs current SSE system
- [ ] Gradual migration from SSE to webhook transport
- [ ] Remove SSE-related code after migration:
  - `EventStreamDurableObject`
  - SSE transport logic in `NdjsonClient`
  - NDJSON streaming infrastructure
  - Connection management code

## File Changes Required

### Proxy Worker
- **Modified**: `src/services/EventStreamer.ts` - Replace broadcasting with webhook calls
- **New**: `src/services/WebhookSender.ts` - Handle webhook delivery
- **New**: `src/services/EdgeWorkerRegistry.ts` - Manage webhook registrations
- **Removed**: `src/services/EventStreamDurableObject.ts`

### Edge Worker (Electron)
- **Modified**: `electron/main.ts` - Configure ndjson-client for webhook transport
- **Enhanced**: `electron/ndjson-client.ts` - Uses enhanced ndjson-client with webhook support

### Package Changes
- **Enhanced**: `packages/ndjson-client/` - Add webhook transport support while maintaining existing SSE capability
- **Maintained**: Same EventEmitter API for backward compatibility
- **Added**: Transport abstraction layer for SSE and webhook modes

## Security Considerations

1. **Webhook Authentication**: HMAC-SHA256 signatures for all webhook deliveries
2. **HTTPS Only**: All webhook URLs must use HTTPS
3. **Rate Limiting**: Prevent abuse of registration endpoints
4. **Token Validation**: Verify Linear tokens during registration
5. **Firewall Considerations**: Edge workers must accept inbound HTTP requests

## Monitoring & Observability

1. **Delivery Metrics**: Track webhook delivery success/failure rates
2. **Latency Monitoring**: Compare delivery times vs current SSE
3. **Health Checks**: Regular validation of registered webhook endpoints
4. **Error Alerting**: Failed delivery notifications

## Rollout Strategy

**Direct Replacement** (No dual-mode operation):
1. Deploy new proxy-worker with webhook system
2. Update all edge workers to use webhook receivers
3. Remove SSE code in single deployment

**Coordination Required**:
- All edge workers must be updated simultaneously
- Temporary service interruption during deployment
- Rollback plan if webhook delivery fails

## Questions for Clarification

1. **Development Environment**: How should local development handle webhook URLs? (ngrok, local tunneling?)
2. **Edge Worker Discovery**: Manual registration vs automatic discovery?
3. **Failure Handling**: What happens when all edge workers for a workspace are unreachable?
4. **Event Ordering**: Is strict ordering required or is eventual consistency acceptable?

## Success Criteria

- [ ] All Linear webhook events delivered via webhooks instead of SSE
- [ ] Webhook delivery latency ≤ current SSE delivery latency
- [ ] Webhook delivery success rate ≥ 99%
- [ ] No persistent connections maintained
- [ ] Simplified codebase with SSE code removed
- [ ] Support for same number of concurrent edge workers

## Risk Mitigation

1. **Network Connectivity**: Edge workers behind NAT/firewalls may need port forwarding
2. **Webhook Reliability**: Implement robust retry logic with dead letter queues
3. **Registration Failures**: Fallback mechanism if edge worker registration fails
4. **Security**: Comprehensive signature validation to prevent spoofing

---

**Next Steps**: Awaiting approval to proceed with implementation of Phase 1.