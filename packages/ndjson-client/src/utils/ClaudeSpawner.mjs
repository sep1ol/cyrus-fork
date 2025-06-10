import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import path from 'path'

/**
 * ClaudeSpawner - A reusable utility for spawning Claude processes with jq
 * 
 * This class encapsulates the common patterns for spawning Claude CLI processes
 * that both the CLI and Electron applications need.
 */
export class ClaudeSpawner extends EventEmitter {
  /**
   * @param {Object} config - Configuration object
   * @param {string} config.claudePath - Path to Claude executable
   * @param {string[]} config.allowedTools - Array of allowed tool names
   * @param {string} config.workingDirectory - Working directory for Claude process
   * @param {Object} config.claudeConfig - Claude configuration object with getDefaultArgs/getContinueArgs methods
   */
  constructor(config) {
    super()
    this.claudePath = config.claudePath
    this.allowedTools = config.allowedTools || []
    this.workingDirectory = config.workingDirectory
    this.claudeConfig = config.claudeConfig
    this.lineBuffer = ''
    this.process = null
  }

  /**
   * Spawn a new Claude process
   * @param {Object} options - Spawn options
   * @param {boolean} options.continueSession - Whether to use --continue flag
   * @param {string} options.input - Input to send to Claude (optional)
   * @param {boolean} options.useHeredoc - Whether to use heredoc for input (for multi-line safety)
   * @returns {ChildProcess} The spawned process
   */
  spawn(options = {}) {
    const { continueSession = false, input = '', useHeredoc = false } = options

    // Get the appropriate Claude arguments
    const claudeArgs = continueSession 
      ? this.claudeConfig.getContinueArgs(this.allowedTools, this.workingDirectory)
      : this.claudeConfig.getDefaultArgs(this.allowedTools, this.workingDirectory)

    const claudeCmd = `${this.claudePath} ${claudeArgs.join(' ')}`

    // Build the full command
    let fullCommand
    if (useHeredoc && input) {
      // Use heredoc for safe multi-line input
      fullCommand = `${claudeCmd} << 'CLAUDE_INPUT_EOF' | jq -c .
${input}
CLAUDE_INPUT_EOF`
    } else {
      // Standard piped command
      fullCommand = `${claudeCmd} | jq -c .`
    }

    // Spawn the process
    this.process = spawn(fullCommand, {
      cwd: this.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    })

    // Set up event handlers
    this._setupProcessHandlers()

    // Send input if provided and not using heredoc
    if (input && !useHeredoc) {
      this.sendInput(input)
    }

    return this.process
  }

  /**
   * Send input to the Claude process
   * @param {string} input - The input to send
   */
  sendInput(input) {
    if (!this.process || this.process.killed) {
      throw new Error('Claude process is not running')
    }

    try {
      this.process.stdin.write(input)
      this.process.stdin.end()
      this.emit('input-sent', { input, length: input.length })
    } catch (error) {
      this.emit('error', { type: 'stdin-error', error })
      throw error
    }
  }

  /**
   * Kill the Claude process
   */
  kill() {
    if (this.process && !this.process.killed) {
      this.process.kill()
      this.emit('process-killed')
    }
  }

  /**
   * Set up process event handlers
   * @private
   */
  _setupProcessHandlers() {
    // Handle stdout (JSON stream)
    this.process.stdout.on('data', (data) => {
      this._handleStdoutData(data)
    })

    // Handle end of stdout stream
    this.process.stdout.on('end', () => {
      this._handleStdoutEnd()
    })

    // Handle stderr
    this.process.stderr.on('data', (data) => {
      const error = data.toString()
      this.emit('stderr', { error })
      
      // Check for token limit error
      if (error.toLowerCase().includes('prompt is too long')) {
        this.emit('token-limit-error', { error })
      }
    })

    // Handle process errors
    this.process.on('error', (err) => {
      this.emit('error', { type: 'spawn-error', error: err })
    })

    // Handle process exit
    this.process.on('close', (code) => {
      this.emit('close', { code })
    })
  }

  /**
   * Handle stdout data (JSON stream processing)
   * @private
   */
  _handleStdoutData(data) {
    this.lineBuffer += data.toString()
    const lines = this.lineBuffer.split('\n')

    // Process all complete lines except the last
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim()
      if (!line) continue

      try {
        const jsonResponse = JSON.parse(line)
        this._processJsonResponse(jsonResponse)
      } catch (err) {
        this.emit('parse-error', { error: err, line })
      }
    }

    // Keep the last line in the buffer
    this.lineBuffer = lines[lines.length - 1]
  }

  /**
   * Handle end of stdout stream
   * @private
   */
  _handleStdoutEnd() {
    const line = this.lineBuffer.trim()
    
    if (line) {
      // The final line might contain multiple JSON objects
      const parts = line.split(/\r?\n/)
      
      for (const part of parts) {
        if (!part.trim()) continue
        
        try {
          const jsonResponse = JSON.parse(part)
          this._processJsonResponse(jsonResponse)
        } catch (err) {
          this.emit('parse-error', { error: err, line: part })
        }
      }
    }
    
    this.emit('stream-end')
  }

  /**
   * Process a parsed JSON response
   * @private
   */
  _processJsonResponse(jsonResponse) {
    // Emit the raw JSON response
    this.emit('json', jsonResponse)

    // Handle assistant messages
    if (jsonResponse.type === 'assistant' && jsonResponse.message) {
      const message = jsonResponse.message
      let textContent = ''
      
      // Extract text content
      if (message.content && Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === 'text') {
            textContent += content.text
          } else if (content.type === 'tool_use') {
            this.emit('tool-use', { name: content.name, content })
          }
        }
      } else if (typeof message.content === 'string') {
        textContent = message.content
      }

      if (textContent.trim()) {
        this.emit('assistant-message', { text: textContent, message })
      }

      // Check for end_turn
      if (message.stop_reason === 'end_turn') {
        this.emit('end-turn', { lastText: textContent })
      }
    }

    // Check for token limit error
    if (this._isTokenLimitError(jsonResponse)) {
      this.emit('token-limit-error', { response: jsonResponse })
    }

    // Handle result type (cost information)
    if (jsonResponse.type === 'result' && jsonResponse.subtype === 'success' && jsonResponse.cost_usd) {
      this.emit('cost', {
        cost_usd: jsonResponse.cost_usd,
        duration_ms: jsonResponse.duration_ms
      })
    }
  }

  /**
   * Check if a JSON response indicates a token limit error
   * @private
   */
  _isTokenLimitError(jsonResponse) {
    return (
      // Direct error type
      (jsonResponse.type === 'error' && 
       jsonResponse.message && 
       (jsonResponse.message === 'Prompt is too long' || 
        jsonResponse.message.toLowerCase().includes('prompt is too long'))) ||
      // Error object
      (jsonResponse.error && 
       typeof jsonResponse.error.message === 'string' && 
       (jsonResponse.error.message === 'Prompt is too long' ||
        jsonResponse.error.message.toLowerCase().includes('prompt is too long'))) ||
      // Assistant message with error
      (jsonResponse.type === 'assistant' && 
       jsonResponse.message && 
       jsonResponse.message.content &&
       typeof jsonResponse.message.content === 'string' &&
       (jsonResponse.message.content === 'Prompt is too long' ||
        jsonResponse.message.content.toLowerCase().includes('prompt is too long'))) ||
      // Tool error
      (jsonResponse.type === 'tool_error' &&
       jsonResponse.error &&
       (jsonResponse.error === 'Prompt is too long' ||
        jsonResponse.error.toLowerCase().includes('prompt is too long'))) ||
      // Result type with error
      (jsonResponse.type === 'result' &&
       (jsonResponse.result === 'Prompt is too long' || jsonResponse.is_error === true))
    )
  }
}
