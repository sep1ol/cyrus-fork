/**
 * Interface for webhook operations
 */
export class WebhookService {
  /**
   * Start the webhook server
   * @param {number} port - The port to listen on
   * @returns {Promise<object>} - The server instance
   */
  async startServer(port) {
    throw new Error('Not implemented');
  }
  
  /**
   * Verify the webhook signature
   * @param {object} req - The express request object
   * @returns {boolean} - Whether the signature is valid
   */
  verifySignature(req) {
    throw new Error('Not implemented');
  }
  
  /**
   * Process a webhook event (legacy method)
   * @param {string} type - The event type
   * @param {string} action - The event action
   * @param {object} data - The event data
   * @returns {Promise<void>}
   */
  async processEvent(type, action, data) {
    throw new Error('Not implemented');
  }
  
  /**
   * Process an agent notification webhook event
   * @param {string} action - The notification type
   * @param {object} data - The notification data
   * @returns {Promise<void>}
   */
  async processAgentNotification(action, data) {
    throw new Error('Not implemented');
  }
}