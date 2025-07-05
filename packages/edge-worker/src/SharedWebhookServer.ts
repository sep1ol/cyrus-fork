import { createServer, type IncomingMessage, type ServerResponse } from 'http'

/**
 * Shared webhook server that can handle multiple Linear tokens
 * Each token has its own webhook secret for signature verification
 */
export class SharedWebhookServer {
  private server: ReturnType<typeof createServer> | null = null
  private webhookHandlers = new Map<string, {
    secret: string
    handler: (body: string, signature: string, timestamp?: string) => boolean
  }>()
  private port: number
  private isListening = false

  constructor(port: number = 3456) {
    this.port = port
  }

  /**
   * Start the shared webhook server
   */
  async start(): Promise<void> {
    if (this.isListening) {
      return // Already listening
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleWebhookRequest(req, res)
      })

      this.server.listen(this.port, 'localhost', () => {
        this.isListening = true
        console.log(`🔗 Shared webhook server listening on http://localhost:${this.port}`)
        resolve()
      })

      this.server.on('error', (error) => {
        this.isListening = false
        reject(error)
      })
    })
  }

  /**
   * Stop the shared webhook server
   */
  async stop(): Promise<void> {
    if (this.server && this.isListening) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.isListening = false
          console.log('🔗 Shared webhook server stopped')
          resolve()
        })
      })
    }
  }

  /**
   * Register a webhook handler for a specific token
   */
  registerWebhookHandler(
    token: string, 
    secret: string, 
    handler: (body: string, signature: string, timestamp?: string) => boolean
  ): void {
    this.webhookHandlers.set(token, { secret, handler })
    console.log(`🔗 Registered webhook handler for token ending in ...${token.slice(-4)}`)
  }

  /**
   * Unregister a webhook handler
   */
  unregisterWebhookHandler(token: string): void {
    this.webhookHandlers.delete(token)
    console.log(`🔗 Unregistered webhook handler for token ending in ...${token.slice(-4)}`)
  }

  /**
   * Get the webhook URL for registration with proxy
   */
  getWebhookUrl(): string {
    return `http://localhost:${this.port}/webhook`
  }

  /**
   * Handle incoming webhook requests
   */
  private async handleWebhookRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'text/plain' })
        res.end('Method Not Allowed')
        return
      }

      if (req.url !== '/webhook') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Not Found')
        return
      }

      // Read request body
      let body = ''
      req.on('data', chunk => {
        body += chunk.toString()
      })

      req.on('end', () => {
        try {
          const signature = req.headers['x-webhook-signature'] as string
          const timestamp = req.headers['x-webhook-timestamp'] as string

          if (!signature) {
            res.writeHead(400, { 'Content-Type': 'text/plain' })
            res.end('Missing signature')
            return
          }

          // Try each registered handler until one verifies the signature
          for (const [token, { handler }] of this.webhookHandlers) {
            try {
              if (handler(body, signature, timestamp)) {
                // Handler verified signature and processed webhook
                res.writeHead(200, { 'Content-Type': 'text/plain' })
                res.end('OK')
                console.log(`🔗 Webhook delivered to token ending in ...${token.slice(-4)}`)
                return
              }
            } catch (error) {
              console.error(`🔗 Error in webhook handler for token ...${token.slice(-4)}:`, error)
            }
          }

          // No handler could verify the signature
          console.error('🔗 Webhook signature verification failed for all registered handlers')
          res.writeHead(401, { 'Content-Type': 'text/plain' })
          res.end('Unauthorized')
        } catch (error) {
          console.error('🔗 Error processing webhook:', error)
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('Bad Request')
        }
      })

      req.on('error', (error) => {
        console.error('🔗 Request error:', error)
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal Server Error')
      })
    } catch (error) {
      console.error('🔗 Webhook request error:', error)
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('Internal Server Error')
    }
  }
}