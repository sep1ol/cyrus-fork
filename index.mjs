#!/usr/bin/env node
import { App } from './src/app.mjs';
import { parseArgs } from 'node:util';

// Parse command line arguments
const options = {
  'env-file': {
    type: 'string',
    short: 'e',
    default: '.env.secret-agents',
    description: 'Path to the environment file'
  },
  help: {
    type: 'boolean',
    short: 'h',
    description: 'Show help'
  }
};

let values;
try {
  const parsed = parseArgs({ options, allowPositionals: false });
  values = parsed.values;
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

// Show help if requested
if (values.help) {
  console.log(`
Usage: linear-claude-agent [options]

Options:
  -e, --env-file <path>    Path to the environment file (default: .env.secret-agents)
  -h, --help               Show help
`);
  process.exit(0);
}

// Create the application with the env file path
const app = new App(values['env-file']);
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