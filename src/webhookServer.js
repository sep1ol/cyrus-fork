const express = require('express');
const crypto = require('crypto');
const { handleCommentEvent, handleIssueUpdateEvent, handleIssueCreateEvent } = require('./linearAgent');

/**
 * Verify Linear webhook signature
 */
function verifyWebhookSignature(req) {
  const signature = req.headers['linear-signature'];
  if (!signature) {
    return false;
  }

  const hmac = crypto.createHmac('sha256', process.env.LINEAR_WEBHOOK_SECRET);
  hmac.update(JSON.stringify(req.body));
  const computedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

/**
 * Start the webhook server
 * @returns {Promise<http.Server>} The HTTP server instance
 */
async function startWebhookServer(port) {
  const app = express();
  app.use(express.json());

  // Webhook endpoint
  app.post('/webhook', (req, res) => {
    console.log('Received webhook event:', req.body.type, req.body.action);

    // Verify webhook signature
    if (!verifyWebhookSignature(req)) {
      console.error('Invalid webhook signature');
      return res.status(401).send('Invalid signature');
    }

    // Process the webhook event
    const { type, action, data } = req.body;

    // Handle comment creation events
    if (type === 'Comment' && action === 'create') {
      handleCommentEvent({
        issueId: data.issueId,
        body: data.body,
        user: data.user
      });
    }

    // Handle issue update events (for assignee changes, etc.)
    if (type === 'Issue' && action === 'update') {
      handleIssueUpdateEvent(data);
    }

    // Handle issue creation events
    if (type === 'Issue' && action === 'create') {
      handleIssueCreateEvent(data);
    }

    res.status(200).send('Event received');
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.status(200).send('Webhook server is running');
  });

  // Start the server
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Webhook server listening on port ${port}`);
      resolve(server);
    });

    server.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  startWebhookServer
};