import { EdgeClient } from './EdgeClient.mjs'
import { EventProcessor } from './EventProcessor.mjs'

/**
 * Main edge worker that connects to proxy and processes events
 */
export class EdgeWorker {
  constructor(config, issueService) {
    this.config = config
    this.issueService = issueService
    
    // Initialize edge client
    this.edgeClient = new EdgeClient({
      proxyUrl: config.proxyUrl,
      edgeToken: config.edgeToken
    })
    
    // Initialize event processor
    this.eventProcessor = new EventProcessor(issueService)
    
    // Set up event handlers
    this.setupEventHandlers()
  }

  /**
   * Set up event handlers for the edge client
   */
  setupEventHandlers() {
    // Connection events
    this.edgeClient.on('connected', () => {
      console.log('✅ Edge worker connected to proxy')
    })
    
    this.edgeClient.on('disconnected', () => {
      console.log('❌ Edge worker disconnected from proxy')
    })
    
    this.edgeClient.on('error', (error) => {
      console.error('Edge client error:', error)
    })
    
    // Webhook events
    this.edgeClient.on('webhook', async (webhook) => {
      try {
        console.log(`Processing webhook event: ${webhook.type}/${webhook.action || webhook.notification?.type}`)
        
        // Process the webhook
        await this.eventProcessor.processWebhook(webhook)
        
        // Report success if event had an ID
        if (webhook.eventId) {
          await this.edgeClient.sendStatus(webhook.eventId, 'completed')
        }
      } catch (error) {
        console.error('Failed to process webhook:', error)
        
        // Report failure if event had an ID
        if (webhook.eventId) {
          await this.edgeClient.sendStatus(webhook.eventId, 'failed', error.message)
        }
      }
    })
    
    // Heartbeat events (optional logging)
    if (process.env.DEBUG_EDGE === 'true') {
      this.edgeClient.on('heartbeat', (event) => {
        console.log('❤️ Heartbeat received:', event.timestamp)
      })
    }
  }

  /**
   * Start the edge worker
   */
  async start() {
    console.log('Starting edge worker...')
    console.log(`Proxy URL: ${this.config.proxyUrl}`)
    
    // Connect to proxy
    await this.edgeClient.connect()
  }

  /**
   * Stop the edge worker
   */
  async stop() {
    console.log('Stopping edge worker...')
    
    // Disconnect from proxy
    this.edgeClient.disconnect()
  }

  /**
   * Check if edge worker is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.edgeClient.isConnected()
  }
}