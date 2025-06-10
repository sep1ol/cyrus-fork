import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import { StdoutParser } from '@cyrus/claude-parser';
/**
 * Manages spawning and communication with Claude CLI processes
 */
export class ClaudeRunner extends EventEmitter {
    config;
    process = null;
    parser = null;
    startedAt = null;
    constructor(config) {
        super();
        this.config = config;
        // Forward config callbacks to events
        if (config.onEvent)
            this.on('event', config.onEvent);
        if (config.onError)
            this.on('error', config.onError);
        if (config.onExit)
            this.on('exit', config.onExit);
    }
    /**
     * Spawn a new Claude process
     */
    spawn() {
        if (this.process) {
            throw new Error('Claude process already running');
        }
        // Build command arguments
        const args = this.buildArgs();
        const command = `${this.config.claudePath} ${args.join(' ')} | jq -c .`;
        // Spawn the process
        this.process = spawn('sh', ['-c', command], {
            cwd: this.config.workingDirectory,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false // We're already using sh -c
        });
        this.startedAt = new Date();
        // Set up stdout parser
        this.parser = new StdoutParser();
        this.setupParserEvents();
        // Handle process events
        this.setupProcessEvents();
        // Pipe stdout through parser
        if (this.process.stdout) {
            this.process.stdout.on('data', (chunk) => {
                this.parser?.processData(chunk);
            });
        }
        return {
            process: this.process,
            pid: this.process.pid,
            startedAt: this.startedAt
        };
    }
    /**
     * Send input to Claude
     */
    async sendInput(input) {
        if (!this.process || !this.process.stdin) {
            throw new Error('No active Claude process');
        }
        return new Promise((resolve, reject) => {
            // Use heredoc for safe multi-line input
            const heredocDelimiter = 'CLAUDE_INPUT_EOF';
            const heredocInput = `${input}\n${heredocDelimiter}\n`;
            this.process.stdin.write(heredocInput, (err) => {
                if (err) {
                    reject(err);
                }
                else {
                    resolve();
                }
            });
        });
    }
    /**
     * Send initial prompt and close stdin
     */
    async sendInitialPrompt(prompt) {
        await this.sendInput(prompt);
        this.process?.stdin?.end();
    }
    /**
     * Kill the Claude process
     */
    kill() {
        if (this.process) {
            this.process.kill('SIGTERM');
            this.process = null;
            this.parser = null;
        }
    }
    /**
     * Check if process is running
     */
    isRunning() {
        return this.process !== null && !this.process.killed;
    }
    /**
     * Build command line arguments
     */
    buildArgs() {
        const args = [
            '--print',
            '--verbose',
            '--output-format',
            'stream-json'
        ];
        // Add continue flag if specified
        if (this.config.continueSession) {
            args.push('--continue');
        }
        // Add allowed tools
        if (this.config.allowedTools && this.config.allowedTools.length > 0) {
            args.push('--allowedTools');
            args.push(...this.config.allowedTools);
        }
        return args;
    }
    /**
     * Set up parser event handlers
     */
    setupParserEvents() {
        if (!this.parser)
            return;
        // Forward all events
        this.parser.on('message', (event) => {
            this.emit('event', event);
        });
        this.parser.on('assistant', (event) => {
            this.emit('assistant', event);
        });
        this.parser.on('tool-use', (toolName, input) => {
            this.emit('tool-use', toolName, input);
        });
        this.parser.on('text', (text) => {
            this.emit('text', text);
        });
        this.parser.on('end-turn', (lastText) => {
            this.emit('end-turn', lastText);
        });
        this.parser.on('result', (event) => {
            this.emit('result', event);
        });
        this.parser.on('error', (error) => {
            if (error instanceof Error) {
                this.emit('error', error);
            }
            else {
                // Convert ErrorEvent/ToolErrorEvent to Error
                const message = 'message' in error ? error.message :
                    'error' in error ? error.error :
                        'Unknown error';
                this.emit('error', new Error(message));
            }
        });
        this.parser.on('token-limit', () => {
            this.emit('token-limit');
        });
    }
    /**
     * Set up process event handlers
     */
    setupProcessEvents() {
        if (!this.process)
            return;
        this.process.on('error', (error) => {
            this.emit('error', new Error(`Claude process error: ${error.message}`));
        });
        this.process.on('exit', (code) => {
            // Process any remaining data
            if (this.parser) {
                this.parser.processEnd();
            }
            this.emit('exit', code);
            this.process = null;
            this.parser = null;
        });
        // Capture stderr
        if (this.process.stderr) {
            let stderrBuffer = '';
            this.process.stderr.on('data', (chunk) => {
                stderrBuffer += chunk.toString();
                // Emit complete lines
                const lines = stderrBuffer.split('\n');
                stderrBuffer = lines.pop() || '';
                for (const line of lines) {
                    if (line.trim()) {
                        this.emit('error', new Error(`Claude stderr: ${line}`));
                    }
                }
            });
        }
    }
}
//# sourceMappingURL=ClaudeRunner.js.map