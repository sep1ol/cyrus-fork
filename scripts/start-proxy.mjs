#!/usr/bin/env node

import dotenv from 'dotenv'
import { ProxyServer } from '../src/proxy/ProxyServer.mjs'

// Load environment variables
dotenv.config({ path: '.env.secret-agents' })

// Validate required environment variables
const requiredVars = [
  'LINEAR_CLIENT_ID',
  'LINEAR_CLIENT_SECRET', 
  'LINEAR_WEBHOOK_SECRET'
]

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`)
    process.exit(1)
  }
}

// Create proxy configuration
const config = {
  LINEAR_CLIENT_ID: process.env.LINEAR_CLIENT_ID,
  LINEAR_CLIENT_SECRET: process.env.LINEAR_CLIENT_SECRET,
  LINEAR_WEBHOOK_SECRET: process.env.LINEAR_WEBHOOK_SECRET,
  OAUTH_REDIRECT_URI: process.env.OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/callback',
  WORKSPACE_BASE_DIR: process.env.WORKSPACE_BASE_DIR || './oauth'
}

// Create and start proxy server
const proxy = new ProxyServer(config)
const port = process.env.PROXY_PORT || 3000

proxy.start(port).catch(error => {
  console.error('Failed to start proxy:', error)
  process.exit(1)
})

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down proxy server...')
  await proxy.stop()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('\nShutting down proxy server...')
  await proxy.stop()
  process.exit(0)
})