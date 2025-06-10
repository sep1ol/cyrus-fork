import { EventEmitter } from 'events';
import { LinearClient } from '@linear/sdk';
import { NdjsonClient } from '@cyrus/ndjson-client';
import { ClaudeRunner, getAllTools } from '@cyrus/claude-runner';
import { SessionManager, Session } from '@cyrus/core';
import { readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
/**
 * Unified edge worker that orchestrates NDJSON streaming, Claude processing, and Linear integration
 */
export class EdgeWorker extends EventEmitter {
    config;
    repositories = new Map();
    linearClients = new Map();
    ndjsonClients = new Map();
    sessionManager;
    claudeRunners = new Map();
    sessionToRepo = new Map(); // Maps session ID to repository ID
    constructor(config) {
        super();
        this.config = config;
        this.sessionManager = new SessionManager();
        // Initialize repositories
        for (const repo of config.repositories) {
            if (repo.isActive !== false) {
                this.repositories.set(repo.id, repo);
                // Create Linear client for this repository's workspace
                this.linearClients.set(repo.id, new LinearClient({
                    accessToken: repo.linearToken
                }));
            }
        }
        // Group repositories by token to minimize NDJSON connections
        const tokenToRepos = new Map();
        for (const repo of this.repositories.values()) {
            const repos = tokenToRepos.get(repo.linearToken) || [];
            repos.push(repo);
            tokenToRepos.set(repo.linearToken, repos);
        }
        // Create one NDJSON client per unique token
        for (const [token, repos] of tokenToRepos) {
            const ndjsonClient = new NdjsonClient({
                proxyUrl: config.proxyUrl,
                token: token,
                onConnect: () => this.handleConnect(token),
                onDisconnect: (reason) => this.handleDisconnect(token, reason),
                onError: (error) => this.handleError(error)
            });
            // Set up webhook handler
            ndjsonClient.on('webhook', (data) => this.handleWebhook(data, repos));
            // Optional heartbeat logging
            if (process.env.DEBUG_EDGE === 'true') {
                ndjsonClient.on('heartbeat', () => {
                    console.log(`❤️ Heartbeat received for token ending in ...${token.slice(-4)}`);
                });
            }
            this.ndjsonClients.set(token, ndjsonClient);
        }
    }
    /**
     * Start the edge worker
     */
    async start() {
        // Connect all NDJSON clients
        const connections = Array.from(this.ndjsonClients.values()).map(client => client.connect());
        await Promise.all(connections);
    }
    /**
     * Stop the edge worker
     */
    async stop() {
        // Kill all Claude processes
        for (const [, runner] of this.claudeRunners) {
            runner.kill();
        }
        this.claudeRunners.clear();
        // Clear all sessions
        for (const [issueId] of this.sessionManager.getAllSessions()) {
            this.sessionManager.removeSession(issueId);
        }
        this.sessionToRepo.clear();
        // Disconnect all NDJSON clients
        for (const client of this.ndjsonClients.values()) {
            client.disconnect();
        }
    }
    /**
     * Handle connection established
     */
    handleConnect(token) {
        this.emit('connected', token);
        console.log(`✅ Connected to proxy with token ending in ...${token.slice(-4)}`);
    }
    /**
     * Handle disconnection
     */
    handleDisconnect(token, reason) {
        this.emit('disconnected', token, reason);
        console.log(`❌ Disconnected from proxy (token ...${token.slice(-4)}): ${reason || 'Unknown reason'}`);
    }
    /**
     * Handle errors
     */
    handleError(error) {
        this.emit('error', error);
        this.config.handlers?.onError?.(error);
    }
    /**
     * Handle webhook events from proxy
     */
    async handleWebhook(data, repos) {
        // Find the appropriate repository for this webhook
        const repository = this.findRepositoryForWebhook(data, repos);
        if (!repository) {
            console.log('No repository configured for webhook from workspace', this.extractWorkspaceId(data));
            return;
        }
        try {
            // Check for Agent notifications
            if (data.type === 'AppUserNotification') {
                await this.handleAgentNotification(data, repository);
            }
            else {
                // Handle legacy webhook format
                await this.handleLegacyWebhook(data, repository);
            }
            // Report success if we have an event ID
            if ('eventId' in data && data.eventId) {
                await this.reportStatus({
                    eventId: data.eventId,
                    status: 'completed'
                });
            }
        }
        catch (error) {
            // Report failure
            if ('eventId' in data && data.eventId) {
                await this.reportStatus({
                    eventId: data.eventId,
                    status: 'failed',
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
            throw error;
        }
    }
    /**
     * Handle Agent API notifications
     */
    async handleAgentNotification(data, repository) {
        const notification = data.notification;
        switch (notification?.type) {
            case 'issueAssignedToYou':
                await this.handleIssueAssigned(notification.issue, repository);
                break;
            case 'issueCommentMention':
            case 'issueCommentReply':
            case 'issueNewComment':
                await this.handleNewComment(notification.issue, notification.comment, repository);
                break;
            case 'issueUnassignedFromYou':
                await this.handleIssueUnassigned(notification.issue, repository);
                break;
            default:
                console.log(`Unhandled notification type: ${notification?.type}`);
        }
    }
    /**
     * Handle legacy webhook format
     */
    async handleLegacyWebhook(data, repository) {
        if (data.type === 'Comment' && data.action === 'create') {
            const issue = data.data?.issue;
            const comment = data.data;
            if (issue && comment) {
                await this.handleNewComment(issue, comment, repository);
            }
        }
    }
    /**
     * Find the repository configuration for a webhook
     */
    findRepositoryForWebhook(data, repos) {
        const workspaceId = this.extractWorkspaceId(data);
        if (!workspaceId)
            return repos[0] || null; // Fallback to first repo if no workspace ID
        return repos.find(repo => repo.linearWorkspaceId === workspaceId) || null;
    }
    /**
     * Extract workspace ID from webhook data
     */
    extractWorkspaceId(data) {
        // Try different locations where workspace ID might be
        return data.organizationId ||
            data.workspaceId ||
            data.data?.workspaceId ||
            data.notification?.issue?.team?.id ||
            null;
    }
    /**
     * Handle issue assignment
     */
    async handleIssueAssigned(issue, repository) {
        // Create workspace
        const workspace = this.config.handlers?.createWorkspace
            ? await this.config.handlers.createWorkspace(issue, repository)
            : {
                path: `${repository.workspaceBaseDir}/${issue.identifier}`,
                isGitWorktree: false
            };
        // Create Claude runner
        const runner = new ClaudeRunner({
            claudePath: this.config.claudePath,
            workingDirectory: workspace.path,
            allowedTools: this.config.defaultAllowedTools || getAllTools(),
            onEvent: (event) => this.handleClaudeEvent(issue.id, event, repository.id),
            onExit: (code) => this.handleClaudeExit(issue.id, code, repository.id)
        });
        // Store runner
        this.claudeRunners.set(issue.id, runner);
        // Spawn Claude process
        const processInfo = runner.spawn();
        // Create session
        const session = new Session({
            issue,
            workspace,
            process: processInfo.process,
            startedAt: processInfo.startedAt
        });
        this.sessionManager.addSession(issue.id, session);
        this.sessionToRepo.set(issue.id, repository.id);
        // Emit events
        this.emit('session:started', issue.id, issue, repository.id);
        this.config.handlers?.onSessionStart?.(issue.id, issue, repository.id);
        // Build and send initial prompt
        const prompt = await this.buildInitialPrompt(issue, repository);
        await runner.sendInitialPrompt(prompt);
    }
    /**
     * Handle new comment on issue
     */
    async handleNewComment(issue, comment, repository) {
        const session = this.sessionManager.getSession(issue.id);
        if (!session) {
            console.log(`No active session for issue ${issue.identifier}`);
            return;
        }
        // Check if continuation is enabled
        if (!this.config.features?.enableContinuation) {
            console.log('Continuation not enabled, ignoring comment');
            return;
        }
        // Kill existing Claude process
        const existingRunner = this.claudeRunners.get(issue.id);
        if (existingRunner) {
            existingRunner.kill();
        }
        // Create new runner with --continue flag
        const runner = new ClaudeRunner({
            claudePath: this.config.claudePath,
            workingDirectory: session.workspace.path,
            allowedTools: this.config.defaultAllowedTools || getAllTools(),
            continueSession: true,
            onEvent: (event) => this.handleClaudeEvent(issue.id, event, repository.id),
            onExit: (code) => this.handleClaudeExit(issue.id, code, repository.id)
        });
        // Store new runner
        this.claudeRunners.set(issue.id, runner);
        // Spawn new process
        runner.spawn();
        // Send comment as input
        await runner.sendInput(comment.body || comment.text || '');
    }
    /**
     * Handle issue unassignment
     */
    async handleIssueUnassigned(issue, repository) {
        // Kill Claude process
        const runner = this.claudeRunners.get(issue.id);
        if (runner) {
            runner.kill();
            this.claudeRunners.delete(issue.id);
        }
        // Remove session
        this.sessionManager.removeSession(issue.id);
        const repoId = this.sessionToRepo.get(issue.id);
        this.sessionToRepo.delete(issue.id);
        // Emit events
        this.emit('session:ended', issue.id, null, repoId || repository.id);
        this.config.handlers?.onSessionEnd?.(issue.id, null, repoId || repository.id);
    }
    /**
     * Handle Claude events
     */
    async handleClaudeEvent(issueId, event, repositoryId) {
        // Emit generic event
        this.emit('claude:event', issueId, event, repositoryId);
        this.config.handlers?.onClaudeEvent?.(issueId, event, repositoryId);
        // Handle specific events
        if (event.type === 'assistant') {
            const content = this.extractTextContent(event);
            if (content) {
                this.emit('claude:response', issueId, content, repositoryId);
                // Post to Linear
                await this.postComment(issueId, content, repositoryId);
            }
        }
        else if (event.type === 'tool' && 'tool_name' in event) {
            this.emit('claude:tool-use', issueId, event.tool_name, event.input, repositoryId);
        }
        else if (event.type === 'error' || event.type === 'tool_error') {
            const errorMessage = 'message' in event ? event.message : 'error' in event ? event.error : 'Unknown error';
            this.handleError(new Error(`Claude error: ${errorMessage}`));
        }
        // Handle token limit
        if (this.config.features?.enableTokenLimitHandling && event.type === 'error') {
            if ('message' in event && event.message?.includes('token')) {
                await this.handleTokenLimit(issueId, repositoryId);
            }
        }
    }
    /**
     * Handle Claude process exit
     */
    handleClaudeExit(issueId, code, repositoryId) {
        this.claudeRunners.delete(issueId);
        this.sessionToRepo.delete(issueId);
        this.emit('session:ended', issueId, code, repositoryId);
        this.config.handlers?.onSessionEnd?.(issueId, code, repositoryId);
    }
    /**
     * Handle token limit by restarting session
     */
    async handleTokenLimit(issueId, repositoryId) {
        const session = this.sessionManager.getSession(issueId);
        if (!session)
            return;
        const repository = this.repositories.get(repositoryId);
        if (!repository)
            return;
        // Post warning to Linear
        await this.postComment(issueId, '[System] Token limit reached. Starting fresh session with issue context.', repositoryId);
        // Restart session
        await this.handleIssueAssigned(session.issue, repository);
    }
    /**
     * Build initial prompt for issue
     */
    async buildInitialPrompt(issue, repository) {
        try {
            // Use custom template if provided (repository-specific takes precedence)
            let templatePath = repository.promptTemplatePath || this.config.features?.promptTemplatePath;
            // If no custom template, use the default one
            if (!templatePath) {
                const __filename = fileURLToPath(import.meta.url);
                const __dirname = dirname(__filename);
                templatePath = resolve(__dirname, '../prompt-template.md');
            }
            // Load the template
            const template = await readFile(templatePath, 'utf-8');
            // Get comment history
            const linearClient = this.linearClients.get(repository.id);
            let commentHistory = '';
            let latestComment = '';
            if (linearClient && issue.id) {
                try {
                    const comments = await linearClient.comments({
                        filter: { issue: { id: { eq: issue.id } } }
                    });
                    const commentNodes = await comments.nodes;
                    if (commentNodes.length > 0) {
                        commentHistory = commentNodes.map((comment, index) => `Comment ${index + 1} by ${comment.user?.name || 'Unknown'} at ${comment.createdAt}:\n${comment.body}`).join('\n\n');
                        latestComment = commentNodes[commentNodes.length - 1]?.body || '';
                    }
                }
                catch (error) {
                    console.error('Failed to fetch comments:', error);
                }
            }
            // Replace template variables
            const prompt = template
                .replace(/{{repository_name}}/g, repository.name)
                .replace(/{{issue_id}}/g, issue.id || issue.identifier || '')
                .replace(/{{issue_title}}/g, issue.title || '')
                .replace(/{{issue_description}}/g, issue.description || 'No description provided')
                .replace(/{{issue_state}}/g, issue.state?.name || 'Unknown')
                .replace(/{{issue_priority}}/g, issue.priority?.toString() || 'None')
                .replace(/{{issue_url}}/g, issue.url || '')
                .replace(/{{comment_history}}/g, commentHistory || 'No comments yet')
                .replace(/{{latest_comment}}/g, latestComment || 'No comments yet')
                .replace(/{{working_directory}}/g, this.config.handlers?.createWorkspace ?
                'Will be created based on issue' : repository.repositoryPath)
                .replace(/{{base_branch}}/g, repository.baseBranch)
                .replace(/{{branch_name}}/g, issue.branchName || `${issue.identifier}-${issue.title?.toLowerCase().replace(/\s+/g, '-').substring(0, 30)}`);
            return prompt;
        }
        catch (error) {
            console.error('Failed to load prompt template:', error);
            // Fallback to simple prompt
            return `Please help me with the following Linear issue:

Repository: ${repository.name}
Issue: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description provided'}

Working directory: ${repository.repositoryPath}
Base branch: ${repository.baseBranch}

Please analyze this issue and help implement a solution.`;
        }
    }
    /**
     * Extract text content from Claude event
     */
    extractTextContent(event) {
        if (event.type !== 'assistant')
            return null;
        const message = event.message;
        if (!message?.content)
            return null;
        if (typeof message.content === 'string') {
            return message.content;
        }
        if (Array.isArray(message.content)) {
            return message.content
                .filter((block) => block.type === 'text')
                .map((block) => block.text)
                .join('');
        }
        return null;
    }
    /**
     * Report status back to proxy
     */
    async reportStatus(update) {
        // Find which client to use based on the event ID
        // For now, send to all clients (they'll ignore if not their event)
        const promises = Array.from(this.ndjsonClients.values()).map(client => client.sendStatus(update).catch(err => console.error('Failed to send status update:', err)));
        await Promise.all(promises);
    }
    /**
     * Get connection status
     */
    getConnectionStatus() {
        const status = new Map();
        for (const [token, client] of this.ndjsonClients) {
            status.set(token, client.isConnected());
        }
        return status;
    }
    /**
     * Get active sessions
     */
    getActiveSessions() {
        return Array.from(this.sessionManager.getAllSessions().keys());
    }
    /**
     * Post a comment to Linear
     */
    async postComment(issueId, body, repositoryId) {
        try {
            // Get the Linear client for this repository
            const linearClient = this.linearClients.get(repositoryId);
            if (!linearClient) {
                throw new Error(`No Linear client found for repository ${repositoryId}`);
            }
            const commentData = {
                issueId,
                body
            };
            const response = await linearClient.createComment(commentData);
            // Linear SDK returns CommentPayload with structure: { comment, success, lastSyncId }
            if (response && response.comment) {
                console.log(`✅ Successfully created comment on issue ${issueId}`);
                const comment = await response.comment;
                if (comment?.id) {
                    console.log(`Comment ID: ${comment.id}`);
                }
            }
            else {
                throw new Error('Comment creation failed');
            }
        }
        catch (error) {
            console.error(`Failed to create comment on issue ${issueId}:`, error);
            throw error;
        }
    }
}
//# sourceMappingURL=EdgeWorker.js.map