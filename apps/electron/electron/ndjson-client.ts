import { EventEmitter } from 'events'
import readNDJSONStream from 'ndjson-readablestream'

export class NdjsonClient extends EventEmitter {
  private proxyUrl: string
  private edgeToken: string
  private connected: boolean = false
  private abortController: AbortController | null = null
  private reconnectTimeout: NodeJS.Timeout | null = null
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 10
  private baseReconnectDelay: number = 1000

  constructor(proxyUrl: string, edgeToken: string) {
    super()
    this.proxyUrl = proxyUrl
    this.edgeToken = edgeToken
  }

  async connect(): Promise<void> {
    // Prevent duplicate connections
    if (this.connected) {
      console.log('[NDJSON] Already connected, skipping')
      return
    }
    
    try {
      console.log(`[NDJSON] Connecting to ${this.proxyUrl}/events/stream`)
      this.abortController = new AbortController()
      
      const response = await fetch(`${this.proxyUrl}/events/stream`, {
        headers: {
          'Authorization': `Bearer ${this.edgeToken}`,
          'Accept': 'application/x-ndjson'
        },
        signal: this.abortController.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      console.log('[NDJSON] Connected successfully')
      this.connected = true
      this.reconnectAttempts = 0
      this.emit('connected')

      // Process the stream using ndjson-readablestream
      if (!response.body) {
        throw new Error('No response body')
      }
      
      // Process NDJSON stream
      this.processStream(response.body)
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // Connection was intentionally aborted
        return
      }
      
      console.error('Connection error:', error)
      this.connected = false
      this.emit('disconnected', error)
      
      // Attempt reconnection
      this.scheduleReconnect()
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    this.emit('disconnected')
  }

  private scheduleReconnect(): void {
    // Don't reconnect if we're already connected or intentionally disconnected
    if (this.connected || !this.abortController) {
      return
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[NDJSON] Max reconnection attempts reached')
      this.emit('error', new Error('Max reconnection attempts reached'))
      return
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000 // Max 30 seconds
    )

    this.reconnectAttempts++
    console.log(`[NDJSON] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimeout = setTimeout(() => {
      this.connect()
    }, delay)
  }

  isConnected(): boolean {
    return this.connected
  }

  private async processStream(stream: any): Promise<void> {
    try {
      for await (const event of readNDJSONStream(stream)) {
        if (!this.connected) {
          console.log('[NDJSON] Stream processing stopped - disconnected')
          break
        }
        
        console.log('[NDJSON] Received event:', event.type, event.id || '')
        this.emit('event', event)
      }
      
      console.log('[NDJSON] Stream ended')
      this.connected = false
      this.emit('disconnected')
      this.scheduleReconnect()
    } catch (error) {
      console.error('[NDJSON] Stream error:', error)
      this.connected = false
      this.emit('disconnected', error)
      this.scheduleReconnect()
    }
  }
}