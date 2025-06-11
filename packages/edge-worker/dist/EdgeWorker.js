import { EventEmitter } from 'events';
import { LinearClient } from '@linear/sdk';
import { NdjsonClient } from '@cyrus/ndjson-client';
import { ClaudeRunner, getAllTools } from '@cyrus/claude-runner';
import { SessionManager, Session } from '@cyrus/core';
import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { resolve, dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { fileTypeFromBuffer } from 'file-type';
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
    issueToCommentId = new Map(); // Maps issue ID to initial comment ID
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
        console.log(`[EdgeWorker] handleIssueAssigned started for issue ${issue.identifier} (${issue.id})`);
        // Post initial comment immediately
        const initialComment = await this.postInitialComment(issue.id, repository.id);
        // Create workspace
        const workspace = this.config.handlers?.createWorkspace
            ? await this.config.handlers.createWorkspace(issue, repository)
            : {
                path: `${repository.workspaceBaseDir}/${issue.identifier}`,
                isGitWorktree: false
            };
        console.log(`[EdgeWorker] Workspace created at: ${workspace.path}`);
        // Download attachments before creating Claude runner
        const attachmentResult = await this.downloadIssueAttachments(issue, repository, workspace.path);
        // Build allowed directories list
        const allowedDirectories = [];
        if (attachmentResult.attachmentsDir) {
            allowedDirectories.push(attachmentResult.attachmentsDir);
        }
        // Create Claude runner with attachment directory access
        const runner = new ClaudeRunner({
            claudePath: this.config.claudePath,
            workingDirectory: workspace.path,
            allowedTools: this.config.defaultAllowedTools || getAllTools(),
            allowedDirectories,
            repositoryName: repository.name,
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
        // Store initial comment ID if we have one
        if (initialComment?.id) {
            this.issueToCommentId.set(issue.id, initialComment.id);
        }
        this.sessionManager.addSession(issue.id, session);
        this.sessionToRepo.set(issue.id, repository.id);
        // Emit events
        this.emit('session:started', issue.id, issue, repository.id);
        this.config.handlers?.onSessionStart?.(issue.id, issue, repository.id);
        // Build and send initial prompt with attachment manifest
        console.log(`[EdgeWorker] Building initial prompt for issue ${issue.identifier}`);
        try {
            const prompt = await this.buildInitialPrompt(issue, repository, attachmentResult.manifest);
            console.log(`[EdgeWorker] Initial prompt built successfully, length: ${prompt.length} characters`);
            console.log(`[EdgeWorker] Sending initial prompt to Claude runner`);
            await runner.sendInitialPrompt(prompt);
            console.log(`[EdgeWorker] Initial prompt sent successfully`);
        }
        catch (error) {
            console.error(`[EdgeWorker] Error in prompt building/sending:`, error);
            throw error;
        }
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
        // Check if there's an active session for this issue
        const session = this.sessionManager.getSession(issue.id);
        const initialCommentId = this.issueToCommentId.get(issue.id);
        // Post farewell comment if there's an active session
        if (session && initialCommentId) {
            await this.postComment(issue.id, "I've been unassigned and am stopping work now.", repository.id, initialCommentId // Post as reply to initial comment
            );
        }
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
        // Clean up comment ID mapping
        this.issueToCommentId.delete(issue.id);
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
                // Don't post assistant messages anymore - wait for result
            }
        }
        else if (event.type === 'result' && 'result' in event && event.result) {
            // Post the final result to Linear as a reply to the initial comment
            const initialCommentId = this.issueToCommentId.get(issueId);
            await this.postComment(issueId, event.result, repositoryId, initialCommentId);
        }
        else if (event.type === 'tool' && 'tool_name' in event) {
            this.emit('claude:tool-use', issueId, event.tool_name, event.input, repositoryId);
            // Handle TodoWrite tool specifically
            if (event.tool_name === 'TodoWrite' && event.input?.todos) {
                await this.updateCommentWithTodos(issueId, event.input.todos, repositoryId);
            }
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
    async buildInitialPrompt(issue, repository, attachmentManifest = '') {
        console.log(`[EdgeWorker] buildInitialPrompt called for issue ${issue.identifier}`);
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
            console.log(`[EdgeWorker] Loading prompt template from: ${templatePath}`);
            const template = await readFile(templatePath, 'utf-8');
            console.log(`[EdgeWorker] Template loaded, length: ${template.length} characters`);
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
            // Append attachment manifest if provided
            if (attachmentManifest) {
                console.log(`[EdgeWorker] Adding attachment manifest, length: ${attachmentManifest.length} characters`);
                const finalPrompt = prompt + '\n\n' + attachmentManifest;
                console.log(`[EdgeWorker] Final prompt with attachments, total length: ${finalPrompt.length} characters`);
                return finalPrompt;
            }
            console.log(`[EdgeWorker] Returning prompt without attachments, length: ${prompt.length} characters`);
            return prompt;
        }
        catch (error) {
            console.error('[EdgeWorker] Failed to load prompt template:', error);
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
     * Post initial comment when assigned to issue
     */
    async postInitialComment(issueId, repositoryId) {
        try {
            const body = "I've been assigned to this issue and am getting started right away. I'll update this comment with my plan shortly.";
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
                const comment = await response.comment;
                console.log(`✅ Posted initial comment on issue ${issueId} (ID: ${comment.id})`);
                return comment;
            }
            else {
                throw new Error('Initial comment creation failed');
            }
        }
        catch (error) {
            console.error(`Failed to create initial comment on issue ${issueId}:`, error);
            return null;
        }
    }
    /**
     * Post a comment to Linear
     */
    async postComment(issueId, body, repositoryId, parentId) {
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
            // Add parent ID if provided (for reply)
            if (parentId) {
                commentData.parentId = parentId;
            }
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
            // Don't re-throw - just log the error so the edge worker doesn't crash
            // TODO: Implement retry logic or token refresh
        }
    }
    /**
     * Update initial comment with TODO checklist
     */
    async updateCommentWithTodos(issueId, todos, repositoryId) {
        try {
            const commentId = this.issueToCommentId.get(issueId);
            if (!commentId) {
                console.log('No initial comment ID found for issue, cannot update with todos');
                return;
            }
            // Convert todos to Linear checklist format
            const checklist = this.formatTodosAsChecklist(todos);
            const body = `I've been assigned to this issue and am getting started right away. Here's my plan:\n\n${checklist}`;
            // Get the Linear client
            const linearClient = this.linearClients.get(repositoryId);
            if (!linearClient) {
                throw new Error(`No Linear client found for repository ${repositoryId}`);
            }
            // Update the comment
            const response = await linearClient.updateComment(commentId, { body });
            if (response) {
                console.log(`✅ Updated comment ${commentId} with ${todos.length} todos`);
            }
        }
        catch (error) {
            console.error(`Failed to update comment with todos:`, error);
        }
    }
    /**
     * Format todos as Linear checklist markdown
     */
    formatTodosAsChecklist(todos) {
        return todos.map(todo => {
            const checkbox = todo.status === 'completed' ? '[x]' : '[ ]';
            const priorityEmoji = todo.priority === 'high' ? '🔴' : todo.priority === 'medium' ? '🟡' : '🟢';
            const statusEmoji = todo.status === 'in_progress' ? ' 🔄' : '';
            return `- ${checkbox} ${priorityEmoji} ${todo.content}${statusEmoji}`;
        }).join('\n');
    }
    /**
     * Extract attachment URLs from text (issue description or comment)
     */
    extractAttachmentUrls(text) {
        if (!text)
            return [];
        // Match URLs that start with https://uploads.linear.app
        const regex = /https:\/\/uploads\.linear\.app\/[^\s<>"')]+/gi;
        const matches = text.match(regex) || [];
        // Remove duplicates
        return [...new Set(matches)];
    }
    /**
     * Download attachments from Linear issue
     */
    async downloadIssueAttachments(issue, repository, workspacePath) {
        try {
            const attachmentMap = {};
            const imageMap = {};
            let attachmentCount = 0;
            let imageCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            const maxAttachments = 10;
            // Create attachments directory in home directory
            const workspaceFolderName = basename(workspacePath);
            const attachmentsDir = join(homedir(), '.cyrus', workspaceFolderName, 'attachments');
            // Ensure directory exists
            await mkdir(attachmentsDir, { recursive: true });
            // Extract URLs from issue description
            const descriptionUrls = this.extractAttachmentUrls(issue.description);
            // Extract URLs from comments if available
            const commentUrls = [];
            const linearClient = this.linearClients.get(repository.id);
            if (linearClient && issue.id) {
                try {
                    const comments = await linearClient.comments({
                        filter: { issue: { id: { eq: issue.id } } }
                    });
                    const commentNodes = await comments.nodes;
                    for (const comment of commentNodes) {
                        const urls = this.extractAttachmentUrls(comment.body);
                        commentUrls.push(...urls);
                    }
                }
                catch (error) {
                    console.error('Failed to fetch comments for attachments:', error);
                }
            }
            // Combine and deduplicate all URLs
            const allUrls = [...new Set([...descriptionUrls, ...commentUrls])];
            console.log(`Found ${allUrls.length} unique attachment URLs in issue ${issue.identifier}`);
            if (allUrls.length > maxAttachments) {
                console.warn(`Warning: Found ${allUrls.length} attachments but limiting to ${maxAttachments}. Skipping ${allUrls.length - maxAttachments} attachments.`);
            }
            // Download attachments up to the limit
            for (const url of allUrls) {
                if (attachmentCount >= maxAttachments) {
                    skippedCount++;
                    continue;
                }
                // Generate a temporary filename
                const tempFilename = `attachment_${attachmentCount + 1}.tmp`;
                const tempPath = join(attachmentsDir, tempFilename);
                const result = await this.downloadAttachment(url, tempPath, repository.linearToken);
                if (result.success) {
                    // Determine the final filename based on type
                    let finalFilename;
                    if (result.isImage) {
                        imageCount++;
                        finalFilename = `image_${imageCount}${result.fileType || '.png'}`;
                    }
                    else {
                        finalFilename = `attachment_${attachmentCount + 1}${result.fileType || ''}`;
                    }
                    const finalPath = join(attachmentsDir, finalFilename);
                    // Rename the file to include the correct extension
                    await rename(tempPath, finalPath);
                    // Store in appropriate map
                    if (result.isImage) {
                        imageMap[url] = finalPath;
                    }
                    else {
                        attachmentMap[url] = finalPath;
                    }
                    attachmentCount++;
                }
                else {
                    failedCount++;
                    console.warn(`Failed to download attachment: ${url}`);
                }
            }
            // Generate attachment manifest
            const manifest = this.generateAttachmentManifest({
                attachmentMap,
                imageMap,
                totalFound: allUrls.length,
                downloaded: attachmentCount,
                imagesDownloaded: imageCount,
                skipped: skippedCount,
                failed: failedCount
            });
            // Return manifest and directory path if any attachments were downloaded
            return {
                manifest,
                attachmentsDir: attachmentCount > 0 ? attachmentsDir : null
            };
        }
        catch (error) {
            console.error('Error downloading attachments:', error);
            return { manifest: '', attachmentsDir: null }; // Return empty manifest on error
        }
    }
    /**
     * Download a single attachment from Linear
     */
    async downloadAttachment(attachmentUrl, destinationPath, linearToken) {
        try {
            console.log(`Downloading attachment from: ${attachmentUrl}`);
            const response = await fetch(attachmentUrl, {
                headers: {
                    'Authorization': `Bearer ${linearToken}`
                }
            });
            if (!response.ok) {
                console.error(`Attachment download failed: ${response.status} ${response.statusText}`);
                return { success: false };
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            // Detect the file type from the buffer
            const fileType = await fileTypeFromBuffer(buffer);
            let detectedExtension = undefined;
            let isImage = false;
            if (fileType) {
                detectedExtension = `.${fileType.ext}`;
                isImage = fileType.mime.startsWith('image/');
                console.log(`Detected file type: ${fileType.mime} (${fileType.ext}), is image: ${isImage}`);
            }
            else {
                // Try to get extension from URL
                const urlPath = new URL(attachmentUrl).pathname;
                const urlExt = extname(urlPath);
                if (urlExt) {
                    detectedExtension = urlExt;
                    console.log(`Using extension from URL: ${detectedExtension}`);
                }
            }
            // Write the attachment to disk
            await writeFile(destinationPath, buffer);
            console.log(`Successfully downloaded attachment to: ${destinationPath}`);
            return { success: true, fileType: detectedExtension, isImage };
        }
        catch (error) {
            console.error(`Error downloading attachment:`, error);
            return { success: false };
        }
    }
    /**
     * Generate a markdown section describing downloaded attachments
     */
    generateAttachmentManifest(downloadResult) {
        const { attachmentMap, imageMap, totalFound, downloaded, imagesDownloaded, skipped, failed } = downloadResult;
        let manifest = '\n## Downloaded Attachments\n\n';
        if (totalFound === 0) {
            manifest += 'No attachments were found in this issue.\n';
            return manifest;
        }
        manifest += `Found ${totalFound} attachments. Downloaded ${downloaded}`;
        if (imagesDownloaded > 0) {
            manifest += ` (including ${imagesDownloaded} images)`;
        }
        if (skipped > 0) {
            manifest += `, skipped ${skipped} due to ${downloaded} attachment limit`;
        }
        if (failed > 0) {
            manifest += `, failed to download ${failed}`;
        }
        manifest += '.\n\n';
        if (failed > 0) {
            manifest += '**Note**: Some attachments failed to download. This may be due to authentication issues or the files being unavailable. The agent will continue processing the issue with the available information.\n\n';
        }
        manifest += 'Attachments have been downloaded to the `~/.cyrus/<workspace>/attachments` directory:\n\n';
        // List images first
        if (Object.keys(imageMap).length > 0) {
            manifest += '### Images\n';
            Object.entries(imageMap).forEach(([url, localPath], index) => {
                const filename = basename(localPath);
                manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
                manifest += `   Local path: ${localPath}\n\n`;
            });
            manifest += 'You can use the Read tool to view these images.\n\n';
        }
        // List other attachments
        if (Object.keys(attachmentMap).length > 0) {
            manifest += '### Other Attachments\n';
            Object.entries(attachmentMap).forEach(([url, localPath], index) => {
                const filename = basename(localPath);
                manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
                manifest += `   Local path: ${localPath}\n\n`;
            });
            manifest += 'You can use the Read tool to view these files.\n\n';
        }
        return manifest;
    }
}
//# sourceMappingURL=EdgeWorker.js.map