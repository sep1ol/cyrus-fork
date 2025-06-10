# ClaudeSpawner Utility

The `ClaudeSpawner` is a reusable utility class that encapsulates the common patterns for spawning Claude CLI processes with JSON stream processing via `jq`. This utility is designed to work in both CLI and Electron contexts.

## Overview

The ClaudeSpawner handles:
- Process spawning with proper arguments
- JSON stream processing (NDJSON format)
- Event-based communication
- Token limit detection and handling
- Tool usage tracking
- Cost reporting
- Safe multi-line input handling via heredoc

## Installation

```javascript
import { ClaudeSpawner } from '@cyrus/edge-client/src/utils/ClaudeSpawner.mjs'
import { claudeConfig } from '@cyrus/edge-client/src/config/claude.mjs'
```

## Basic Usage

### Creating a Spawner Instance

```javascript
const spawner = new ClaudeSpawner({
  claudePath: '/path/to/claude',        // Path to Claude executable
  allowedTools: ['Read', 'Grep', 'LS'], // Array of allowed tool names
  workingDirectory: '/workspace',       // Working directory for Claude
  claudeConfig: claudeConfig           // Configuration object
})
```

### Starting a New Session

```javascript
// Start a new Claude session
const process = spawner.spawn({
  continueSession: false,
  input: 'Hello! Please analyze this codebase.',
  useHeredoc: false
})
```

### Continuing a Session

```javascript
// Continue with user input (uses --continue flag)
const process = spawner.spawn({
  continueSession: true,
  input: 'Now please explain the main function.',
  useHeredoc: true  // Recommended for multi-line input
})
```

## Event Handling

The ClaudeSpawner emits various events during the Claude process lifecycle:

### Message Events

```javascript
// Raw JSON response from Claude
spawner.on('json', (response) => {
  console.log('Received JSON:', response)
})

// Assistant text messages
spawner.on('assistant-message', ({ text, message }) => {
  console.log('Assistant:', text)
})

// Tool usage
spawner.on('tool-use', ({ name, content }) => {
  console.log('Tool called:', name)
})

// End of turn
spawner.on('end-turn', ({ lastText }) => {
  console.log('Turn ended with:', lastText)
})
```

### Error and Status Events

```javascript
// Token limit errors
spawner.on('token-limit-error', ({ response }) => {
  console.error('Token limit reached!')
  // Handle by starting a fresh session
})

// General errors
spawner.on('error', ({ type, error }) => {
  console.error(`Error (${type}):`, error)
})

// Stderr output
spawner.on('stderr', ({ error }) => {
  console.error('Claude stderr:', error)
})

// Process closed
spawner.on('close', ({ code }) => {
  console.log('Process exited with code:', code)
})
```

### Cost Tracking

```javascript
// Cost information
spawner.on('cost', ({ cost_usd, duration_ms }) => {
  console.log(`Cost: $${cost_usd.toFixed(2)}, Duration: ${duration_ms / 1000}s`)
})
```

## CLI Context Example

```javascript
import { ClaudeSpawner } from '../src/utils/ClaudeSpawner.mjs'
import { claudeConfig } from '../src/config/claude.mjs'

function createCLISpawner(claudePath, workingDir) {
  const spawner = new ClaudeSpawner({
    claudePath,
    allowedTools: claudeConfig.readOnlyTools,
    workingDirectory: workingDir,
    claudeConfig
  })

  // Direct console output
  spawner.on('assistant-message', ({ text }) => {
    console.log('Claude:', text)
  })

  spawner.on('error', ({ type, error }) => {
    console.error(`Error:`, error.message)
  })

  return spawner
}
```

## Electron Context Example

```javascript
function createElectronSpawner(claudePath, workingDir, ipcRenderer) {
  const spawner = new ClaudeSpawner({
    claudePath,
    allowedTools: claudeConfig.readOnlyTools,
    workingDirectory: workingDir,
    claudeConfig
  })

  // Forward events to renderer via IPC
  const events = [
    'json', 'assistant-message', 'tool-use', 'token-limit-error',
    'end-turn', 'cost', 'error', 'close'
  ]

  events.forEach(event => {
    spawner.on(event, (data) => {
      ipcRenderer.send(`claude:${event}`, data)
    })
  })

  return spawner
}
```

## Token Limit Handling

```javascript
const spawner = new ClaudeSpawner({ /* config */ })

spawner.on('token-limit-error', async () => {
  console.log('Token limit reached, starting fresh session...')
  
  // Kill current process
  spawner.kill()
  
  // Start fresh session without --continue
  spawner.spawn({
    continueSession: false,
    input: 'Please continue where you left off. The previous session hit the token limit.',
    useHeredoc: false
  })
})
```

## Advanced Features

### Heredoc Input Handling

For multi-line input or input with special characters, use heredoc:

```javascript
spawner.spawn({
  continueSession: true,
  input: `This is a multi-line
input with "quotes" and 'apostrophes'
and other special characters!`,
  useHeredoc: true
})
```

### Manual Input Sending

You can also send input manually after spawning:

```javascript
const process = spawner.spawn({ continueSession: false })
// Later...
spawner.sendInput('Additional input')
```

### Process Management

```javascript
// Check if process is running
if (spawner.process && !spawner.process.killed) {
  // Process is active
}

// Kill the process
spawner.kill()
```

## Requirements

- Node.js with ES modules support
- Claude CLI installed and accessible
- `jq` command-line tool installed (for JSON stream processing)
- Proper Claude configuration with tool permissions

## Architecture Notes

1. **Process Spawning**: Uses Node.js `child_process.spawn` with shell mode
2. **JSON Streaming**: Pipes Claude output through `jq -c .` for line-delimited JSON
3. **Event-Driven**: Extends EventEmitter for flexible event handling
4. **Buffer Management**: Handles partial JSON lines in the stream
5. **Error Detection**: Recognizes various token limit error formats

## Testing

See `test/ClaudeSpawner.test.mjs` for comprehensive unit tests.

Run integration examples:
```bash
node examples/claude-spawner-integration.mjs cli
node examples/claude-spawner-integration.mjs electron
node examples/claude-spawner-integration.mjs token-limit
```
