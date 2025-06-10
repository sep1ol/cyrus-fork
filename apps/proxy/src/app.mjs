#!/usr/bin/env node

import dotenv from 'dotenv'
import { ProxyServer } from './ProxyServer.mjs'

// Load environment variables
dotenv.config({ path: '.env.proxy' })
dotenv.config({ path: '.env.cyrus' }) // Fallback

// Validate required environment variables
const requiredVars = [
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET',
  'LINEAR_WEBHOOK_SECRET'
]

const missingVars = requiredVars.filter(varName => !process.env[varName])
if (missingVars.length > 0) {
  console.error('❌ Missing required environment variables:')
  missingVars.forEach(varName => {
    console.error(`   - ${varName}`)
  })
  console.error('\nPlease create .env.proxy file with your Linear OAuth app credentials:')
  console.error(`
LINEAR_CLIENT_ID=your_oauth_app_client_id
LINEAR_CLIENT_SECRET=your_oauth_app_client_secret
LINEAR_WEBHOOK_SECRET=your_webhook_secret
PROXY_PORT=3456
OAUTH_REDIRECT_URI=http://localhost:3456/oauth/callback
`)
  process.exit(1)
}

// Create proxy configuration
const config = {
  LINEAR_CLIENT_ID: process.env.LINEAR_CLIENT_ID,
  LINEAR_CLIENT_SECRET: process.env.LINEAR_CLIENT_SECRET,
  LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET,
  OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3456/oauth/callback',
  WORKSPACE_BASE_DIR: process.env.WORKSPACE_BASE_DIR || './oauth-tokens'
}

// Create and start proxy server
const proxy = new ProxyServer(config)
const port = process.env.PROXY_PORT || 3456

console.log('🚀 Starting Cyrus Edge Proxy Server...')
console.log('─'.repeat(50))

proxy.start(port).then(() => {
  console.log(`
📡 Proxy server ready!

Endpoints:
- Dashboard:      http://localhost:${port}
- OAuth:          http://localhost:${port}/oauth/authorize
- Webhook:        http://localhost:${port}/webhook
- Event Stream:   http://localhost:${port}/events/stream

Edge workers can connect to:
http://localhost:${port}
`)

  // For production, you'll want to expose this via ngrok or deploy to cloud
  if (process.env.NODE_ENV !== 'production') {
    console.log(`
💡 For Linear webhooks, expose this server publicly using ngrok:
   ngrok http ${port}
   
Then update your Linear webhook URL to:
   https://your-ngrok-url.ngrok.io/webhook
`)
  }
}).catch(error => {
  console.error('Failed to start proxy:', error)
  process.exit(1)
})

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n\nShutting down proxy server...')
  await proxy.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\n\nShutting down proxy server...')
  await proxy.stop()
  process.exit(0)
})