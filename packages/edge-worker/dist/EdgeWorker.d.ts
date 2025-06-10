import { EventEmitter } from 'events';
import type { EdgeWorkerConfig, EdgeWorkerEvents } from './types.js';
export declare interface EdgeWorker {
    on<K extends keyof EdgeWorkerEvents>(event: K, listener: EdgeWorkerEvents[K]): this;
    emit<K extends keyof EdgeWorkerEvents>(event: K, ...args: Parameters<EdgeWorkerEvents[K]>): boolean;
}
/**
 * Unified edge worker that orchestrates NDJSON streaming, Claude processing, and Linear integration
 */
export declare class EdgeWorker extends EventEmitter {
    private config;
    private repositories;
    private linearClients;
    private ndjsonClients;
    private sessionManager;
    private claudeRunners;
    private sessionToRepo;
    constructor(config: EdgeWorkerConfig);
    /**
     * Start the edge worker
     */
    start(): Promise<void>;
    /**
     * Stop the edge worker
     */
    stop(): Promise<void>;
    /**
     * Handle connection established
     */
    private handleConnect;
    /**
     * Handle disconnection
     */
    private handleDisconnect;
    /**
     * Handle errors
     */
    private handleError;
    /**
     * Handle webhook events from proxy
     */
    private handleWebhook;
    /**
     * Handle Agent API notifications
     */
    private handleAgentNotification;
    /**
     * Handle legacy webhook format
     */
    private handleLegacyWebhook;
    /**
     * Find the repository configuration for a webhook
     */
    private findRepositoryForWebhook;
    /**
     * Extract workspace ID from webhook data
     */
    private extractWorkspaceId;
    /**
     * Handle issue assignment
     */
    private handleIssueAssigned;
    /**
     * Handle new comment on issue
     */
    private handleNewComment;
    /**
     * Handle issue unassignment
     */
    private handleIssueUnassigned;
    /**
     * Handle Claude events
     */
    private handleClaudeEvent;
    /**
     * Handle Claude process exit
     */
    private handleClaudeExit;
    /**
     * Handle token limit by restarting session
     */
    private handleTokenLimit;
    /**
     * Build initial prompt for issue
     */
    private buildInitialPrompt;
    /**
     * Extract text content from Claude event
     */
    private extractTextContent;
    /**
     * Report status back to proxy
     */
    private reportStatus;
    /**
     * Get connection status
     */
    getConnectionStatus(): Map<string, boolean>;
    /**
     * Get active sessions
     */
    getActiveSessions(): string[];
    /**
     * Post a comment to Linear
     */
    private postComment;
}
//# sourceMappingURL=EdgeWorker.d.ts.map