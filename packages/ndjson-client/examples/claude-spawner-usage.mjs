import { ClaudeSpawner } from '../src/utils/ClaudeSpawner.mjs'
import { claudeConfig } from '../src/config/claude.mjs'

/**
 * Example: Using ClaudeSpawner in CLI context
 */
export function createCLISpawner(claudePath, allowedTools, workingDirectory) {
  const spawner = new ClaudeSpawner({
    claudePath,
    allowedTools,
    workingDirectory,
    claudeConfig
  })

  // Set up event listeners
  spawner.on('json', (response) => {
    console.log('Received JSON:', response)
  })

  spawner.on('assistant-message', ({ text }) => {
    console.log('Assistant:', text)
  })

  spawner.on('tool-use', ({ name }) => {
    console.log('Tool called:', name)
  })

  spawner.on('token-limit-error', () => {
    console.error('Token limit reached!')
    // Handle token limit (e.g., start fresh session)
  })

  spawner.on('cost', ({ cost_usd, duration_ms }) => {
    console.log(`Cost: $${cost_usd.toFixed(2)}, Duration: ${duration_ms / 1000}s`)
  })

  spawner.on('error', ({ type, error }) => {
    console.error(`Error (${type}):`, error)
  })

  return spawner
}

/**
 * Example: Using ClaudeSpawner in Electron context
 */
export function createElectronSpawner(claudePath, allowedTools, workingDirectory, ipcRenderer) {
  const spawner = new ClaudeSpawner({
    claudePath,
    allowedTools,
    workingDirectory,
    claudeConfig
  })

  // Forward events to renderer process via IPC
  spawner.on('json', (response) => {
    ipcRenderer.send('claude:json', response)
  })

  spawner.on('assistant-message', ({ text, message }) => {
    ipcRenderer.send('claude:assistant-message', { text, message })
  })

  spawner.on('tool-use', (data) => {
    ipcRenderer.send('claude:tool-use', data)
  })

  spawner.on('token-limit-error', (data) => {
    ipcRenderer.send('claude:token-limit-error', data)
  })

  spawner.on('end-turn', (data) => {
    ipcRenderer.send('claude:end-turn', data)
  })

  spawner.on('cost', (data) => {
    ipcRenderer.send('claude:cost', data)
  })

  spawner.on('error', (data) => {
    ipcRenderer.send('claude:error', data)
  })

  spawner.on('close', (data) => {
    ipcRenderer.send('claude:close', data)
  })

  return spawner
}

/**
 * Example usage scenarios
 */

// 1. Start a new session
function startNewSession(spawner, initialPrompt) {
  const process = spawner.spawn({
    continueSession: false,
    input: initialPrompt,
    useHeredoc: false
  })
  
  return process
}

// 2. Continue a session with user input
function continueSession(spawner, userInput) {
  // Kill existing process if running
  spawner.kill()
  
  // Start new process with --continue flag and heredoc for safety
  const process = spawner.spawn({
    continueSession: true,
    input: userInput,
    useHeredoc: true
  })
  
  return process
}

// 3. Start fresh after token limit
function startFreshAfterTokenLimit(spawner, resumePrompt) {
  // Kill existing process
  spawner.kill()
  
  // Start fresh without --continue
  const process = spawner.spawn({
    continueSession: false,
    input: resumePrompt,
    useHeredoc: false
  })
  
  return process
}

// 4. Example with full lifecycle
export async function runClaudeSession(claudePath, workingDirectory) {
  // Create spawner with read-only tools
  const spawner = createCLISpawner(
    claudePath,
    ['read', 'list', 'search'],
    workingDirectory
  )

  // Track responses
  const responses = []
  spawner.on('assistant-message', ({ text }) => {
    responses.push(text)
  })

  // Handle token limit by starting fresh
  spawner.on('token-limit-error', () => {
    console.log('Token limit hit, starting fresh...')
    startFreshAfterTokenLimit(spawner, 'Please continue where you left off.')
  })

  // Start initial session
  const initialPrompt = 'Hello! Please analyze the current directory structure.'
  startNewSession(spawner, initialPrompt)

  // Simulate user continuation after 5 seconds
  setTimeout(() => {
    continueSession(spawner, 'Now please count the number of JavaScript files.')
  }, 5000)

  // Clean up after 30 seconds
  setTimeout(() => {
    spawner.kill()
    console.log('Session complete. Total responses:', responses.length)
  }, 30000)
}
