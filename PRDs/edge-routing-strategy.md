# Edge Routing Strategy

## Overview

This document outlines how the central proxy routes webhook events to the appropriate edge workers. Since multiple users/organizations may be running edge workers, we need a clear strategy for event routing.

## Routing Requirements

1. **User-Specific Routing**: Events for issues assigned to a specific Linear user should route to their edge worker
2. **Organization Isolation**: Events from one organization should never route to another organization's edge
3. **Multi-Edge Support**: Support multiple edge workers per user/organization
4. **Failover**: Handle edge worker unavailability gracefully
5. **Security**: Prevent unauthorized access to events

## Routing Architecture

### Edge Registration

When an edge worker connects, it must identify itself:

```javascript
// Edge → Proxy connection request
GET /events/stream
Headers: {
  'Authorization': 'Bearer edge_key_xxx',
  'X-Edge-User-Id': 'user_123',  // Linear user ID
  'X-Edge-Name': 'connor-macbook' // Friendly name
}
```

### Routing Key Strategy

**Option 1: User-Based Routing** (Recommended)
```javascript
// Route based on Linear user ID
routingKey = event.assignee.id // "user_123"
```

**Option 2: Organization-Based Routing**
```javascript
// Route based on Linear organization
routingKey = event.organization.id // "org_456"
```

**Option 3: Hybrid Routing**
```javascript
// Route based on user + organization
routingKey = `${event.organization.id}:${event.assignee.id}`
```

## Implementation Design

### Edge Registry

```javascript
class EdgeRegistry {
  constructor() {
    // Map of routingKey -> Set of edge connections
    this.edges = new Map()
    
    // Map of edgeId -> metadata
    this.metadata = new Map()
  }
  
  registerEdge(edgeId, connection, metadata) {
    const { userId, organizationId, name } = metadata
    const routingKey = userId // or organizationId based on strategy
    
    // Store connection
    if (!this.edges.has(routingKey)) {
      this.edges.set(routingKey, new Set())
    }
    this.edges.get(routingKey).add(connection)
    
    // Store metadata
    this.metadata.set(edgeId, {
      userId,
      organizationId,
      name,
      connectedAt: new Date(),
      lastSeen: new Date()
    })
  }
  
  getEdgesForEvent(event) {
    // Determine routing key from event
    const routingKey = this.extractRoutingKey(event)
    return this.edges.get(routingKey) || new Set()
  }
  
  extractRoutingKey(event) {
    // Extract based on webhook type
    switch (event.type) {
      case 'issueAssignedToYou':
        return event.data.assignee.id
      case 'issueCommentMention':
        return event.data.mentionedUser.id
      case 'issueCommentReply':
        return event.data.originalCommentAuthor.id
      default:
        return null
    }
  }
}
```

### Event Router

```javascript
class EventRouter {
  constructor(registry, streamer) {
    this.registry = registry
    this.streamer = streamer
  }
  
  async routeEvent(webhookEvent) {
    // Transform webhook to internal event
    const event = this.transformWebhook(webhookEvent)
    
    // Find target edges
    const edges = this.registry.getEdgesForEvent(event)
    
    if (edges.size === 0) {
      console.warn(`No edges found for event ${event.id}`)
      await this.handleUnroutableEvent(event)
      return
    }
    
    // Send to all matching edges
    for (const edge of edges) {
      try {
        await this.streamer.sendToEdge(edge, event)
      } catch (error) {
        console.error(`Failed to send to edge: ${error}`)
        await this.handleFailedDelivery(edge, event)
      }
    }
  }
  
  async handleUnroutableEvent(event) {
    // Options:
    // 1. Queue for later delivery
    // 2. Send notification to Linear
    // 3. Log and skip
  }
}
```

## Authentication & Authorization

### Edge API Keys

Each edge worker gets a unique API key that encodes:
- User ID
- Organization ID  
- Permissions/scopes

```javascript
// API key structure (JWT)
{
  "sub": "edge_123",
  "userId": "user_123",
  "orgId": "org_456",
  "scopes": ["read:issues", "write:comments"],
  "iat": 1234567890
}
```

### Validation Flow

```javascript
class EdgeAuthenticator {
  async validateEdgeConnection(headers) {
    const token = headers['authorization']?.replace('Bearer ', '')
    
    try {
      const payload = jwt.verify(token, process.env.EDGE_SECRET)
      
      // Verify user still has access
      const user = await linearClient.user(payload.userId)
      if (!user.active) {
        throw new Error('User no longer active')
      }
      
      return {
        edgeId: payload.sub,
        userId: payload.userId,
        orgId: payload.orgId,
        scopes: payload.scopes
      }
    } catch (error) {
      throw new AuthError('Invalid edge credentials')
    }
  }
}
```

## Event Filtering

Not all events should go to all edges:

```javascript
class EventFilter {
  shouldRouteToEdge(event, edgeMetadata) {
    // Check organization match
    if (event.organizationId !== edgeMetadata.orgId) {
      return false
    }
    
    // Check user match for user-specific events
    if (event.assigneeId && event.assigneeId !== edgeMetadata.userId) {
      return false
    }
    
    // Check scopes
    if (!this.hasRequiredScopes(event, edgeMetadata.scopes)) {
      return false
    }
    
    return true
  }
}
```

## Multi-Edge Scenarios

### Load Balancing
When multiple edges are connected for the same user:

```javascript
// Option 1: Broadcast to all edges (redundancy)
edges.forEach(edge => edge.send(event))

// Option 2: Round-robin (load distribution)
const edge = edges[this.counter++ % edges.length]
edge.send(event)

// Option 3: Sticky sessions (consistent routing)
const edge = this.selectEdgeByHash(event.issueId, edges)
edge.send(event)
```

### Edge Selection Strategy

```javascript
class EdgeSelector {
  selectEdge(edges, event) {
    // Sort by health/performance metrics
    const healthyEdges = Array.from(edges)
      .filter(e => e.isHealthy())
      .sort((a, b) => a.responseTime - b.responseTime)
    
    if (healthyEdges.length === 0) {
      throw new Error('No healthy edges available')
    }
    
    // For issue-specific events, use consistent hashing
    if (event.issueId) {
      const hash = this.hashCode(event.issueId)
      return healthyEdges[hash % healthyEdges.length]
    }
    
    // Otherwise, pick the fastest edge
    return healthyEdges[0]
  }
}
```

## Configuration

### Proxy Configuration
```env
# Routing strategy
ROUTING_STRATEGY=user # user|org|hybrid

# Multi-edge behavior  
MULTI_EDGE_MODE=broadcast # broadcast|roundrobin|sticky

# Failover
EDGE_TIMEOUT_MS=5000
RETRY_FAILED_EVENTS=true
```

### Edge Configuration
```env
# Identity
LINEAR_USER_ID=user_123
LINEAR_ORG_ID=org_456
EDGE_NAME=connor-macbook

# Connection
PROXY_URL=https://cyrus-proxy.example.com
EDGE_API_KEY=edge_key_xxx
```

## Security Considerations

1. **Event Isolation**: Events must only route to authorized edges
2. **Token Rotation**: Support key rotation without downtime
3. **Audit Logging**: Log all routing decisions
4. **Rate Limiting**: Prevent edge workers from overwhelming the system

## Monitoring

Track these metrics:
- Events routed per edge
- Failed deliveries
- Edge connection duration
- Event routing latency
- Unroutable events

## Future Enhancements

1. **Dynamic Routing Rules**: Allow custom routing logic
2. **Event Prioritization**: Route high-priority events first
3. **Geographic Routing**: Route to nearest edge
4. **Team-Based Routing**: Route based on Linear teams