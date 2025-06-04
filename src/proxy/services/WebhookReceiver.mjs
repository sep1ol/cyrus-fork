import crypto from 'crypto'

/**
 * Service for receiving and validating Linear webhooks
 * This is a simplified version that only handles webhook reception
 */
export class WebhookReceiver {
  /**
   * @param {string} webhookSecret - Secret for verifying webhook requests
   * @param {Function} onWebhookReceived - Callback when valid webhook is received
   */
  constructor(webhookSecret, onWebhookReceived) {
    this.webhookSecret = webhookSecret
    this.onWebhookReceived = onWebhookReceived
  }

  /**
   * Verify webhook signature from Linear
   * @param {Request} req - Express request object
   * @returns {boolean} - Whether signature is valid
   */
  verifySignature(req) {
    const signature = req.headers['linear-signature']
    
    if (!signature) {
      console.log('No linear-signature header found')
      return false
    }
    
    // Check for raw body in both buffer and string form
    if (!req.rawBodyBuffer && !req.rawBody) {
      console.error('No raw body available for signature verification')
      return false
    }
    
    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret)
      
      // Prefer buffer for binary consistency
      if (req.rawBodyBuffer) {
        hmac.update(req.rawBodyBuffer)
      } else {
        hmac.update(req.rawBody)
      }
      
      const computedSignature = hmac.digest('hex')
      const signatureMatches = (signature === computedSignature)
      
      if (!signatureMatches && process.env.DEBUG_WEBHOOKS === 'true') {
        console.log('❌ Signature mismatch')
      }
      
      return signatureMatches
    } catch (error) {
      console.error('Error verifying webhook signature:', error)
      return false
    }
  }

  /**
   * Register webhook routes on an Express app
   * @param {Express} app - Express application instance
   */
  registerRoutes(app) {
    // Webhook endpoint
    app.post('/webhook', async (req, res) => {
      // First, ensure the body is parsed correctly
      if (!req.body) {
        console.error('Request body is undefined')
        return res.status(400).send('Invalid JSON payload')
      }
      
      // Verify webhook signature
      if (!this.verifySignature(req)) {
        console.error('Invalid webhook signature')
        return res.status(401).send('Invalid signature')
      }
      
      // Only log webhook event details if debug mode is enabled
      if (process.env.DEBUG_WEBHOOKS === 'true') {
        const eventType = req.body.type || 'Unknown'
        const eventAction = req.body.action || 'Unknown'
        console.log('Received webhook event:', eventType, eventAction)
      }
      
      // Pass webhook to callback for processing
      if (this.onWebhookReceived) {
        try {
          await this.onWebhookReceived(req.body)
        } catch (error) {
          console.error('Error processing webhook:', error)
        }
      }
      
      // Respond immediately to acknowledge receipt
      res.status(200).send('Event received')
    })
    
    // Health check endpoint
    app.get('/health', (req, res) => {
      res.status(200).json({
        status: 'healthy',
        service: 'webhook-receiver'
      })
    })
  }
}