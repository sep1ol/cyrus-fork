import { createInterface } from 'readline'
import EventEmitter from 'events'

/**
 * Edge client that connects to the proxy and processes NDJSON events
 */
export class EdgeClient extends EventEmitter {
  constructor(config) {
    super()
    this.proxyUrl = config.proxyUrl
    this.edgeToken = config.edgeToken
    this.connected = false
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 10
    this.reconnectDelay = 1000 // Start with 1 second
    this.abortController = null
  }

  /**
   * Connect to the proxy and start receiving events
   */
  async connect() {
    try {
      console.log(`Connecting to proxy at ${this.proxyUrl}...`)
      
      // Create abort controller for clean disconnection
      this.abortController = new AbortController()
      
      const response = await fetch(`${this.proxyUrl}/events/stream`, {
        headers: {
          'Authorization': `Bearer ${this.edgeToken}`,
          'Accept': 'application/x-ndjson'
        },
        signal: this.abortController.signal
      })

      if (!response.ok) {
        throw new Error(`Failed to connect: ${response.status} ${response.statusText}`)
      }

      console.log('Connected to proxy, receiving events...')
      this.connected = true
      this.reconnectAttempts = 0
      this.emit('connected')

      // Process NDJSON stream
      await this.processStream(response.body)
      
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Connection aborted')
        return
      }
      
      console.error('Connection error:', error.message)
      this.connected = false
      this.emit('error', error)
      
      // Attempt reconnection
      await this.reconnect()
    }
  }

  /**
   * Process the NDJSON stream
   * @param {ReadableStream} stream - The response body stream
   */
  async processStream(stream) {
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          console.log('Stream ended')
          break
        }

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true })
        
        // Process complete lines
        const lines = buffer.split('\n')
        buffer = lines.pop() // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line)
              await this.handleEvent(event)
            } catch (parseError) {
              console.error('Failed to parse event:', parseError)
              console.error('Line:', line)
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
      this.connected = false
      this.emit('disconnected')
    }
  }

  /**
   * Handle a single event from the stream
   * @param {object} event - The parsed event object
   */
  async handleEvent(event) {
    // Log event type
    if (event.type !== 'heartbeat') {
      console.log(`Received event: ${event.type}`)
    }

    switch (event.type) {
      case 'connection':
        console.log('Connection confirmed by proxy')
        break
        
      case 'heartbeat':
        // Silent heartbeat handling
        this.emit('heartbeat', event)
        break
        
      case 'webhook':
        // Forward webhook events for processing
        this.emit('webhook', event.data)
        break
        
      default:
        console.log('Unknown event type:', event.type)
        this.emit('unknown', event)
    }
  }

  /**
   * Send status update to proxy
   * @param {string} eventId - The event ID
   * @param {string} status - Status (processing, completed, failed)
   * @param {string} error - Optional error message
   */
  async sendStatus(eventId, status, error = null) {
    try {
      const response = await fetch(`${this.proxyUrl}/events/status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.edgeToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          eventId,
          status,
          error
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to send status: ${response.status}`)
      }
    } catch (error) {
      console.error('Failed to send status update:', error)
    }
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  async reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached')
      this.emit('max_reconnect_attempts')
      return
    }

    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(`Reconnecting in ${delay / 1000} seconds... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
    
    await new Promise(resolve => setTimeout(resolve, delay))
    
    if (!this.connected) {
      await this.connect()
    }
  }

  /**
   * Disconnect from the proxy
   */
  disconnect() {
    console.log('Disconnecting from proxy...')
    
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    
    this.connected = false
    this.emit('disconnected')
  }

  /**
   * Check if connected
   * @returns {boolean}
   */
  isConnected() {
    return this.connected
  }
}