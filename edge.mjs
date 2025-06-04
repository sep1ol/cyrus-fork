#!/usr/bin/env node

import dotenv from 'dotenv'
import { EdgeApp } from './src/edge/app.mjs'
import { createEdgeContainer } from './src/edge/container.mjs'

// Load environment variables
dotenv.config({ path: '.env.edge' })

// Create and start the edge application
const container = createEdgeContainer()
const app = new EdgeApp(container)

// Handle graceful shutdown
process.on('SIGINT', async () => {
  await app.shutdown()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await app.shutdown()
  process.exit(0)
})

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  process.exit(1)
})

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error)
  process.exit(1)
})

// Start the application
app.start().catch(error => {
  console.error('Failed to start edge worker:', error)
  process.exit(1)
})