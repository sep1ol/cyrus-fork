/**
 * Service for streaming events to edge workers using NDJSON
 */
export class EventStreamer {
  constructor() {
    // Map of edgeId -> { response, metadata }
    this.connections = new Map()
    this.eventCounter = 0
  }

  /**
   * Register streaming routes on an Express app
   * @param {Express} app - Express application instance
   */
  registerRoutes(app) {
    // NDJSON streaming endpoint
    app.get('/events/stream', async (req, res) => {
      // Extract edge authentication
      const authHeader = req.headers['authorization']
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' })
      }

      const edgeToken = authHeader.substring(7)
      
      // TODO: Validate edge token and extract metadata
      // For now, use token as edgeId
      const edgeId = edgeToken
      
      console.log(`Edge worker ${edgeId} connected for streaming`)

      // Set up NDJSON streaming response
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable Nginx buffering
        'Transfer-Encoding': 'chunked'
      })
      
      // Prevent Express from ending the response
      res.flushHeaders()

      // Store connection
      this.connections.set(edgeId, {
        response: res,
        connectedAt: new Date(),
        lastSeen: new Date()
      })

      // Send initial connection event after a small delay to ensure response is ready
      setImmediate(() => {
        this.sendToEdge(edgeId, {
          type: 'connection',
          status: 'connected',
          timestamp: new Date().toISOString()
        })
      })

      // Set up heartbeat
      const heartbeatInterval = setInterval(() => {
        if (this.connections.has(edgeId)) {
          this.sendToEdge(edgeId, {
            type: 'heartbeat',
            timestamp: new Date().toISOString()
          })
        } else {
          clearInterval(heartbeatInterval)
        }
      }, 30000) // 30 second heartbeat

      // Handle connection close
      const cleanup = () => {
        if (this.connections.has(edgeId)) {
          console.log(`Edge worker ${edgeId} disconnected`)
          this.connections.delete(edgeId)
          clearInterval(heartbeatInterval)
        }
      }
      
      // Only clean up when the response actually finishes
      res.on('finish', cleanup)
      res.on('close', cleanup)
      
      // Handle errors
      req.on('error', (err) => {
        console.error('Request error:', err)
        cleanup()
      })
      res.on('error', (err) => {
        console.error('Response error:', err)
        cleanup()
      })
    })

    // Status endpoint for edge workers
    app.post('/events/status', async (req, res) => {
      const { eventId, status, error } = req.body
      
      // Extract edge authentication
      const authHeader = req.headers['authorization']
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' })
      }

      const edgeToken = authHeader.substring(7)
      const edgeId = edgeToken // TODO: Extract from validated token

      console.log(`Edge ${edgeId} reported status for event ${eventId}: ${status}`)
      
      // TODO: Handle status update (update Linear, etc.)
      
      res.status(200).json({ received: true })
    })
  }

  /**
   * Send event to a specific edge worker
   * @param {string} edgeId - Edge worker ID
   * @param {object} event - Event to send
   * @returns {boolean} - Whether send was successful
   */
  sendToEdge(edgeId, event) {
    const connection = this.connections.get(edgeId)
    if (!connection) {
      return false
    }

    try {
      const line = JSON.stringify(event) + '\n'
      connection.response.write(line)
      connection.lastSeen = new Date()
      return true
    } catch (error) {
      console.error(`Failed to send event to edge ${edgeId}:`, error)
      console.error('Error details:', error.message, error.stack)
      this.connections.delete(edgeId)
      return false
    }
  }

  /**
   * Broadcast event to all connected edges
   * @param {object} event - Event to broadcast
   * @returns {number} - Number of edges that received the event
   */
  broadcast(event) {
    let successCount = 0
    
    for (const [edgeId, connection] of this.connections) {
      if (this.sendToEdge(edgeId, event)) {
        successCount++
      }
    }
    
    return successCount
  }

  /**
   * Transform webhook to streaming event
   * @param {object} webhook - Linear webhook payload
   * @returns {object} - Event for edge workers
   */
  transformWebhookToEvent(webhook) {
    this.eventCounter++
    
    return {
      id: `evt_${this.eventCounter}`,
      type: 'webhook',
      timestamp: new Date().toISOString(),
      data: webhook
    }
  }

  /**
   * Get connected edge workers
   * @returns {Array} - List of connected edge metadata
   */
  getConnectedEdges() {
    const edges = []
    
    for (const [edgeId, connection] of this.connections) {
      edges.push({
        id: edgeId,
        connectedAt: connection.connectedAt,
        lastSeen: connection.lastSeen
      })
    }
    
    return edges
  }
}