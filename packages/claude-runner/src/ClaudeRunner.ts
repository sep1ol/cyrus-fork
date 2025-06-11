import { EventEmitter } from 'events'
import { spawn, type ChildProcess } from 'child_process'
import { mkdirSync } from 'fs'
import { StdoutParser, type ClaudeEvent, type ErrorEvent, type ToolErrorEvent } from '@cyrus/claude-parser'
import type { ClaudeRunnerConfig, ClaudeRunnerEvents, ClaudeProcessInfo } from './types.js'

export declare interface ClaudeRunner {
  on<K extends keyof ClaudeRunnerEvents>(event: K, listener: ClaudeRunnerEvents[K]): this
  emit<K extends keyof ClaudeRunnerEvents>(event: K, ...args: Parameters<ClaudeRunnerEvents[K]>): boolean
}

/**
 * Manages spawning and communication with Claude CLI processes
 */
export class ClaudeRunner extends EventEmitter {
  private config: ClaudeRunnerConfig
  private process: ChildProcess | null = null
  private parser: StdoutParser | null = null
  private startedAt: Date | null = null

  constructor(config: ClaudeRunnerConfig) {
    super()
    this.config = config

    // Forward config callbacks to events
    if (config.onEvent) this.on('message', config.onEvent)
    if (config.onError) this.on('error', config.onError)
    if (config.onExit) this.on('exit', config.onExit)
  }

  /**
   * Spawn a new Claude process
   */
  spawn(): ClaudeProcessInfo {
    if (this.process) {
      throw new Error('Claude process already running')
    }

    // Build command arguments
    const args = this.buildArgs()
    const command = `${this.config.claudePath} ${args.join(' ')} | jq -c .`
    
    // Debug logging
    console.error('[ClaudeRunner] Spawning command:', command)
    console.error('[ClaudeRunner] Working directory:', this.config.workingDirectory)
    console.error('[ClaudeRunner] Claude path:', this.config.claudePath)

    // Ensure working directory exists
    if (this.config.workingDirectory) {
      try {
        mkdirSync(this.config.workingDirectory, { recursive: true })
        console.error('[ClaudeRunner] Created working directory')
      } catch (err) {
        console.error('[ClaudeRunner] Failed to create working directory:', err)
      }
    }

    // Spawn the process
    this.process = spawn('sh', ['-c', command], {
      cwd: this.config.workingDirectory,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false // We're already using sh -c
    })

    this.startedAt = new Date()

    // Set up stdout parser
    this.parser = new StdoutParser()
    this.setupParserEvents()

    // Handle process events
    this.setupProcessEvents()

    // Pipe stdout through parser
    if (this.process.stdout) {
      this.process.stdout.on('data', (chunk) => {
        this.parser?.processData(chunk)
      })
    }

    return {
      process: this.process,
      pid: this.process.pid,
      startedAt: this.startedAt
    }
  }

  /**
   * Send input to Claude
   */
  async sendInput(input: string): Promise<void> {
    if (!this.process || !this.process.stdin) {
      throw new Error('No active Claude process')
    }

    return new Promise((resolve, reject) => {
      // Use heredoc for safe multi-line input
      const heredocDelimiter = 'CLAUDE_INPUT_EOF'
      const heredocInput = `${input}\n${heredocDelimiter}\n`

      this.process!.stdin!.write(heredocInput, (err) => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Send initial prompt and close stdin
   */
  async sendInitialPrompt(prompt: string): Promise<void> {
    await this.sendInput(prompt)
    this.process?.stdin?.end()
  }

  /**
   * Kill the Claude process
   */
  kill(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
      this.parser = null
    }
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.process !== null && !this.process.killed
  }

  /**
   * Build command line arguments
   */
  private buildArgs(): string[] {
    const args = [
      '--print',
      '--verbose',
      '--output-format',
      'stream-json'
    ]

    // Add continue flag if specified
    if (this.config.continueSession) {
      args.push('--continue')
    }

    // Add allowed tools
    if (this.config.allowedTools && this.config.allowedTools.length > 0) {
      args.push('--allowedTools')
      args.push(...this.config.allowedTools)
    }

    // Add allowed directories
    if (this.config.allowedDirectories && this.config.allowedDirectories.length > 0) {
      args.push('--add-dir')
      args.push(...this.config.allowedDirectories)
    }

    return args
  }

  /**
   * Set up parser event handlers
   */
  private setupParserEvents(): void {
    if (!this.parser) return

    // Forward all events
    this.parser.on('message', (event: ClaudeEvent) => {
      this.emit('message', event)
    })

    this.parser.on('assistant', (event: ClaudeEvent) => {
      this.emit('assistant', event)
    })

    this.parser.on('tool-use', (toolName: string, input: any) => {
      this.emit('tool-use', toolName, input)
    })

    this.parser.on('text', (text: string) => {
      this.emit('text', text)
    })

    this.parser.on('end-turn', (lastText: string) => {
      this.emit('end-turn', lastText)
    })

    this.parser.on('result', (event: ClaudeEvent) => {
      this.emit('result', event)
    })

    this.parser.on('error', (error: Error | ErrorEvent | ToolErrorEvent) => {
      if (error instanceof Error) {
        this.emit('error', error)
      } else {
        // Convert ErrorEvent/ToolErrorEvent to Error
        const message = 'message' in error ? error.message : 
                       'error' in error ? error.error : 
                       'Unknown error'
        this.emit('error', new Error(message))
      }
    })

    this.parser.on('token-limit', () => {
      this.emit('token-limit')
    })
  }

  /**
   * Set up process event handlers
   */
  private setupProcessEvents(): void {
    if (!this.process) return

    this.process.on('error', (error) => {
      this.emit('error', new Error(`Claude process error: ${error.message}`))
    })

    this.process.on('exit', (code) => {
      // Process any remaining data
      if (this.parser) {
        this.parser.processEnd()
      }

      this.emit('exit', code)
      this.process = null
      this.parser = null
    })

    // Capture stderr
    if (this.process.stderr) {
      let stderrBuffer = ''
      this.process.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString()
        // Emit complete lines
        const lines = stderrBuffer.split('\n')
        stderrBuffer = lines.pop() || ''
        
        for (const line of lines) {
          if (line.trim()) {
            this.emit('error', new Error(`Claude stderr: ${line}`))
          }
        }
      })
    }
  }
}