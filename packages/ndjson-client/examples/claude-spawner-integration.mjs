/**
 * Integration example showing how to use ClaudeSpawner in different contexts
 * This demonstrates the reusable spawning logic for both CLI and Electron apps
 */

import { ClaudeSpawner } from '../src/utils/ClaudeSpawner.mjs'
import { claudeConfig } from '../src/config/claude.mjs'
import { EventEmitter } from 'events'

/**
 * Mock IPC renderer for Electron simulation
 */
class MockIPCRenderer extends EventEmitter {
  send(channel, data) {
    console.log(`[IPC] ${channel}:`, data)
    this.emit(channel, data)
  }
}

/**
 * Example 1: CLI Context - Direct console output
 */
function runCLIExample() {
  console.log('\n=== CLI Context Example ===')
  
  const spawner = new ClaudeSpawner({
    claudePath: 'claude', // Assumes claude is in PATH
    allowedTools: claudeConfig.readOnlyTools,
    workingDirectory: process.cwd(),
    claudeConfig
  })

  // Set up event handlers for CLI
  spawner.on('assistant-message', ({ text }) => {
    console.log('\n[Assistant]:', text)
  })

  spawner.on('tool-use', ({ name }) => {
    console.log('[Tool Used]:', name)
  })

  spawner.on('error', ({ type, error }) => {
    console.error(`[Error - ${type}]:`, error.message)
  })

  spawner.on('close', ({ code }) => {
    console.log(`\n[Process exited with code ${code}]`)
  })

  // Start a session
  console.log('Starting Claude session...')
  spawner.spawn({
    continueSession: false,
    input: 'Please list the files in the current directory and tell me what you see.',
    useHeredoc: false
  })

  // Simulate continuing after 3 seconds
  setTimeout(() => {
    console.log('\n[User]: Now count how many JavaScript files there are.')
    spawner.spawn({
      continueSession: true,
      input: 'Now count how many JavaScript files there are.',
      useHeredoc: true
    })
  }, 3000)

  // Clean up after 10 seconds
  setTimeout(() => {
    spawner.kill()
    console.log('\nCLI example complete.')
  }, 10000)
}

/**
 * Example 2: Electron Context - IPC communication
 */
function runElectronExample() {
  console.log('\n=== Electron Context Example ===')
  
  const ipcRenderer = new MockIPCRenderer()
  
  const spawner = new ClaudeSpawner({
    claudePath: 'claude',
    allowedTools: claudeConfig.readOnlyTools,
    workingDirectory: process.cwd(),
    claudeConfig
  })

  // Forward all events to IPC
  const events = [
    'json', 'assistant-message', 'tool-use', 'token-limit-error',
    'end-turn', 'cost', 'error', 'close', 'stderr'
  ]

  events.forEach(event => {
    spawner.on(event, (data) => {
      ipcRenderer.send(`claude:${event}`, data)
    })
  })

  // Listen for IPC events (simulating renderer process)
  ipcRenderer.on('claude:assistant-message', ({ text }) => {
    console.log('\n[Renderer received]:', text.substring(0, 50) + '...')
  })

  ipcRenderer.on('claude:close', ({ code }) => {
    console.log(`\n[Renderer] Process closed with code ${code}`)
  })

  // Start session
  console.log('Starting Claude session via Electron IPC...')
  spawner.spawn({
    continueSession: false,
    input: 'Hello! Please introduce yourself briefly.',
    useHeredoc: false
  })

  // Clean up after 5 seconds
  setTimeout(() => {
    spawner.kill()
    console.log('\nElectron example complete.')
  }, 5000)
}

/**
 * Example 3: Token Limit Handling
 */
function runTokenLimitExample() {
  console.log('\n=== Token Limit Handling Example ===')
  
  const spawner = new ClaudeSpawner({
    claudePath: 'claude',
    allowedTools: claudeConfig.readOnlyTools,
    workingDirectory: process.cwd(),
    claudeConfig
  })

  let sessionCount = 0

  spawner.on('token-limit-error', () => {
    console.log('\n[Token Limit Reached] Starting fresh session...')
    
    // Kill current process
    spawner.kill()
    
    // Start fresh session
    sessionCount++
    spawner.spawn({
      continueSession: false,
      input: `[Session ${sessionCount}] Please continue where you left off. The previous session hit the token limit.`,
      useHeredoc: false
    })
  })

  spawner.on('assistant-message', ({ text }) => {
    console.log(`\n[Session ${sessionCount}]:`, text.substring(0, 100) + '...')
  })

  // Start initial session
  console.log('Starting session that might hit token limit...')
  spawner.spawn({
    continueSession: false,
    input: 'Please analyze a very large codebase...', // This would be a real large prompt
    useHeredoc: false
  })

  // Clean up after 8 seconds
  setTimeout(() => {
    spawner.kill()
    console.log('\nToken limit example complete.')
  }, 8000)
}

/**
 * Run examples based on command line argument
 */
const example = process.argv[2]

switch (example) {
  case 'cli':
    runCLIExample()
    break
  case 'electron':
    runElectronExample()
    break
  case 'token-limit':
    runTokenLimitExample()
    break
  default:
    console.log('Usage: node claude-spawner-integration.mjs [cli|electron|token-limit]')
    console.log('\nExamples:')
    console.log('  cli         - Run CLI context example')
    console.log('  electron    - Run Electron IPC example')
    console.log('  token-limit - Run token limit handling example')
}
