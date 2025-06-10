import { EventEmitter } from 'events';
import type { ClaudeRunnerConfig, ClaudeRunnerEvents, ClaudeProcessInfo } from './types';
export declare interface ClaudeRunner {
    on<K extends keyof ClaudeRunnerEvents>(event: K, listener: ClaudeRunnerEvents[K]): this;
    emit<K extends keyof ClaudeRunnerEvents>(event: K, ...args: Parameters<ClaudeRunnerEvents[K]>): boolean;
}
/**
 * Manages spawning and communication with Claude CLI processes
 */
export declare class ClaudeRunner extends EventEmitter {
    private config;
    private process;
    private parser;
    private startedAt;
    constructor(config: ClaudeRunnerConfig);
    /**
     * Spawn a new Claude process
     */
    spawn(): ClaudeProcessInfo;
    /**
     * Send input to Claude
     */
    sendInput(input: string): Promise<void>;
    /**
     * Send initial prompt and close stdin
     */
    sendInitialPrompt(prompt: string): Promise<void>;
    /**
     * Kill the Claude process
     */
    kill(): void;
    /**
     * Check if process is running
     */
    isRunning(): boolean;
    /**
     * Build command line arguments
     */
    private buildArgs;
    /**
     * Set up parser event handlers
     */
    private setupParserEvents;
    /**
     * Set up process event handlers
     */
    private setupProcessEvents;
}
//# sourceMappingURL=ClaudeRunner.d.ts.map