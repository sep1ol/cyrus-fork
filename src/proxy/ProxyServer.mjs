import { HttpServer } from '../utils/HttpServer.mjs'
import { OAuthHelper } from '../utils/OAuthHelper.mjs'
import { FileSystem } from '../utils/FileSystem.mjs'
import { OAuthService } from './services/OAuthService.mjs'
import { WebhookReceiver } from './services/WebhookReceiver.mjs'
import { EventStreamer } from './services/EventStreamer.mjs'

/**
 * Main proxy server that handles OAuth, webhooks, and event streaming
 */
export class ProxyServer {
  constructor(config) {
    this.config = config
    this.httpServer = new HttpServer()
    this.server = null
    
    // Initialize services
    this.fileSystem = new FileSystem()
    this.oauthHelper = new OAuthHelper({
      clientId: config.LINEAR_CLIENT_ID,
      clientSecret: config.LINEAR_CLIENT_SECRET,
      redirectUri: config.OAUTH_REDIRECT_URI,
      tokenStoragePath: config.WORKSPACE_BASE_DIR || './oauth'
    }, this.fileSystem)
    
    this.oauthService = new OAuthService(
      this.oauthHelper,
      this.onAuthSuccess.bind(this)
    )
    
    this.eventStreamer = new EventStreamer()
    
    this.webhookReceiver = new WebhookReceiver(
      config.LINEAR_WEBHOOK_SECRET,
      this.handleWebhook.bind(this)
    )
  }

  /**
   * Handle successful OAuth authentication
   * @param {object} tokenInfo - OAuth token information
   */
  async onAuthSuccess(tokenInfo) {
    console.log('OAuth authentication successful')
    // TODO: Store workspace information if needed
  }

  /**
   * Handle incoming webhook from Linear
   * @param {object} webhook - Webhook payload
   */
  async handleWebhook(webhook) {
    console.log(`Received webhook: ${webhook.type}/${webhook.action || webhook.notification?.type}`)
    
    // Transform webhook to event
    const event = this.eventStreamer.transformWebhookToEvent(webhook)
    
    // Broadcast to all connected edges
    const edgeCount = this.eventStreamer.broadcast(event)
    console.log(`Webhook forwarded to ${edgeCount} edge worker(s)`)
  }

  /**
   * Start the proxy server
   * @param {number} port - Port to listen on
   */
  async start(port = 3000) {
    const app = this.httpServer.createServer()
    
    // Apply JSON parsing middleware
    const middlewares = this.httpServer.jsonParser()
    middlewares.forEach(middleware => app.use(middleware))
    
    // Register service routes
    this.oauthService.registerRoutes(app)
    this.webhookReceiver.registerRoutes(app)
    this.eventStreamer.registerRoutes(app)
    
    // Add admin endpoint to see connected edges
    app.get('/admin/edges', async (req, res) => {
      const edges = this.eventStreamer.getConnectedEdges()
      res.json({
        count: edges.length,
        edges: edges
      })
    })
    
    // Start server
    try {
      this.server = await this.httpServer.listen(app, port)
      console.log(`Cyrus proxy server listening on port ${port}`)
      console.log(`Dashboard: http://localhost:${port}`)
      return this.server
    } catch (error) {
      console.error('Failed to start proxy server:', error)
      throw error
    }
  }

  /**
   * Stop the proxy server
   */
  async stop() {
    try {
      if (this.server) {
        await this.httpServer.close(this.server)
        console.log('Proxy server stopped')
        this.server = null
      }
    } catch (error) {
      console.error('Error stopping proxy server:', error)
    }
  }
}