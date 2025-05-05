#!/usr/bin/env node
import { App } from './src/app.mjs';

// Create the application
const app = new App();
let isShuttingDown = false;

// Graceful shutdown handler
async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  await app.shutdown();
  process.exit(0);
}

// Handle shutdown signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown();
});

// Start the application
app.start().catch(error => {
  console.error('Application failed to start:', error);
  process.exit(1);
});