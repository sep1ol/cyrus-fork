/**
 * Service for streaming events to edge workers using NDJSON
 */
export class EventStreamer {
  constructor() {
    // Map of edgeId -> { response, metadata }
    this.connections = new Map()
    this.eventCounter = 0
    // Map of workspaceId -> Set of edgeIds
    this.workspaceToEdges = new Map()
  }

  /**
   * Validate Linear token and get workspace access
   * @param {string} token - Linear OAuth token
   * @returns {Promise<string[]>} - Array of workspace IDs
   */
  async validateTokenAndGetWorkspaces(token) {
    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: `
            query {
              viewer {
                id
                name
                organization {
                  id
                  name
                  urlKey
                  teams {
                    nodes {
                      id
                      key
                      name
                    }
                  }
                }
              }
            }
          `
        })
      })
      
      if (!response.ok) {
        console.error('Failed to validate token:', response.status)
        return []
      }
      
      const data = await response.json()
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors)
        return []
      }
      
      // Extract workspace IDs (organization ID and all team IDs)
      const workspaceIds = []
      const workspaceInfo = []
      
      if (data.data?.viewer?.organization) {
        const org = data.data.viewer.organization
        workspaceIds.push(org.id)
        workspaceInfo.push({ id: org.id, name: org.name, type: 'organization' })
        
        // Add all team IDs
        if (org.teams?.nodes) {
          for (const team of org.teams.nodes) {
            workspaceIds.push(team.id)
            workspaceInfo.push({ id: team.id, name: team.name, key: team.key, type: 'team' })
          }
        }
      }
      
      // Store workspace info for logging
      this.workspaceInfo = this.workspaceInfo || new Map()
      for (const info of workspaceInfo) {
        this.workspaceInfo.set(info.id, info)
      }
      
      return workspaceIds
    } catch (error) {
      console.error('Error validating token:', error)
      return []
    }
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
      
      // Validate token and get workspace access
      const workspaceIds = await this.validateTokenAndGetWorkspaces(edgeToken)
      
      if (workspaceIds.length === 0) {
        return res.status(401).json({ error: 'Invalid token or no workspace access' })
      }
      
      // Use token as edgeId (it's unique per edge connection)
      const edgeId = edgeToken
      
      // Obscure token for logging (show first 10 chars only)
      const obscuredId = edgeToken.substring(0, 10) + '...' + edgeToken.substring(edgeToken.length - 4)
      console.log(`Edge worker ${obscuredId} connected for streaming with access to ${workspaceIds.length} workspace(s)`)
      
      // Log workspace details if debug mode or multiple workspaces
      if (process.env.DEBUG_EDGE === 'true' || workspaceIds.length > 1) {
        console.log('Workspace access:')
        for (const id of workspaceIds) {
          const info = this.workspaceInfo?.get(id)
          if (info) {
            console.log(`  - ${info.name} (${info.type}${info.key ? ` - ${info.key}` : ''}) [${id}]`)
          } else {
            console.log(`  - ${id}`)
          }
        }
      }

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

      // Store connection with workspace information
      this.connections.set(edgeId, {
        response: res,
        connectedAt: new Date(),
        lastSeen: new Date(),
        workspaceIds: workspaceIds
      })
      
      // Update workspace to edge mappings
      for (const workspaceId of workspaceIds) {
        if (!this.workspaceToEdges.has(workspaceId)) {
          this.workspaceToEdges.set(workspaceId, new Set())
        }
        this.workspaceToEdges.get(workspaceId).add(edgeId)
      }

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
          console.log(`Edge worker ${obscuredId} disconnected`)
          
          // Remove from workspace mappings
          const connection = this.connections.get(edgeId)
          if (connection?.workspaceIds) {
            for (const workspaceId of connection.workspaceIds) {
              const edges = this.workspaceToEdges.get(workspaceId)
              if (edges) {
                edges.delete(edgeId)
                if (edges.size === 0) {
                  this.workspaceToEdges.delete(workspaceId)
                }
              }
            }
          }
          
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
      
      // Obscure token for logging
      const obscuredId = edgeToken.substring(0, 10) + '...' + edgeToken.substring(edgeToken.length - 4)
      console.log(`Edge ${obscuredId} reported status for event ${eventId}: ${status}`)
      
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
   * Broadcast event to edges based on workspace
   * @param {object} event - Event to broadcast
   * @param {string} workspaceId - Organization/workspace ID from webhook
   * @returns {number} - Number of edges that received the event
   */
  broadcastToWorkspace(event, workspaceId) {
    let successCount = 0
    
    if (!workspaceId) {
      console.log('No workspace ID found in webhook, cannot route')
      return 0
    }
    
    const edgeIds = this.workspaceToEdges.get(workspaceId)
    if (!edgeIds || edgeIds.size === 0) {
      console.log(`No edges connected for workspace ${workspaceId}`)
      return 0
    }
    
    for (const edgeId of edgeIds) {
      if (this.sendToEdge(edgeId, event)) {
        successCount++
      }
    }
    
    return successCount
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