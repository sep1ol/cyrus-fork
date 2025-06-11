import type { EdgeEvent } from '../types'

export class EventStreamDurableObject {
  private state: DurableObjectState
  private env: any
  private connections: Map<string, { response: Response, writer: WritableStreamDefaultWriter }> = new Map()
  private workspaceIds: string[] = []
  private heartbeatInterval?: number

  constructor(state: DurableObjectState, env: any) {
    this.state = state
    this.env = env
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    
    // Handle internal event sending
    if (url.pathname === '/send-event' && request.method === 'POST') {
      return this.handleSendEvent(request)
    }
    
    // Handle NDJSON streaming
    if (url.pathname === '/events/stream') {
      return this.handleEventStream(request)
    }
    
    return new Response('Not found', { status: 404 })
  }

  /**
   * Handle NDJSON event stream connection
   */
  private async handleEventStream(request: Request): Promise<Response> {
    // Extract workspace IDs from query params
    const url = new URL(request.url)
    const workspaceIdsParam = url.searchParams.get('workspaceIds')
    if (workspaceIdsParam) {
      this.workspaceIds = workspaceIdsParam.split(',')
    }
    
    // Create NDJSON stream
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    
    // Generate connection ID
    const connectionId = crypto.randomUUID()
    
    // Send initial connection event
    await this.sendEvent(writer, {
      type: 'connection',
      status: 'connected',
      timestamp: new Date().toISOString()
    })
    
    // Store connection
    const response = new Response(readable, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      }
    })
    
    this.connections.set(connectionId, { response, writer })
    
    // Set up heartbeat if not already running
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat()
      }, 30000) as any // 30 seconds
    }
    
    // Handle connection close
    request.signal.addEventListener('abort', () => {
      this.connections.delete(connectionId)
      writer.close().catch(() => {})
      
      // Clear heartbeat if no more connections
      if (this.connections.size === 0 && this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval)
        this.heartbeatInterval = undefined
      }
    })
    
    return response
  }

  /**
   * Handle sending event to all connections
   */
  private async handleSendEvent(request: Request): Promise<Response> {
    try {
      const event: EdgeEvent = await request.json()
      
      // Send to all active connections
      const promises: Promise<void>[] = []
      const deadConnections: string[] = []
      
      for (const [id, connection] of this.connections) {
        promises.push(
          this.sendEvent(connection.writer, event).catch(() => {
            deadConnections.push(id)
          })
        )
      }
      
      await Promise.all(promises)
      
      // Clean up dead connections
      for (const id of deadConnections) {
        this.connections.delete(id)
      }
      
      return new Response(JSON.stringify({ sent: this.connections.size }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      })
    } catch (error) {
      return new Response('Failed to send event', { status: 500 })
    }
  }

  /**
   * Send event to a writer
   */
  private async sendEvent(writer: WritableStreamDefaultWriter, event: Omit<EdgeEvent, 'id'>): Promise<void> {
    const fullEvent: EdgeEvent = {
      ...event,
      id: event.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }
    
    const line = JSON.stringify(fullEvent) + '\n'
    const encoder = new TextEncoder()
    await writer.write(encoder.encode(line))
  }

  /**
   * Send heartbeat to all connections
   */
  private async sendHeartbeat(): Promise<void> {
    const heartbeat: Omit<EdgeEvent, 'id'> = {
      type: 'heartbeat',
      timestamp: new Date().toISOString()
    }
    
    const deadConnections: string[] = []
    
    for (const [id, connection] of this.connections) {
      try {
        await this.sendEvent(connection.writer, heartbeat)
      } catch {
        deadConnections.push(id)
      }
    }
    
    // Clean up dead connections
    for (const id of deadConnections) {
      this.connections.delete(id)
    }
    
    // Clear heartbeat if no more connections
    if (this.connections.size === 0 && this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = undefined
    }
  }
}