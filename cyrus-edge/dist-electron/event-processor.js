"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EventProcessor = void 0;
const events_1 = require("events");
const child_process_1 = require("child_process");
const path_1 = require("path");
const promises_1 = require("fs/promises");
class EventProcessor extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.activeSessions = new Map();
        this.config = config;
    }
    async processEvent(event) {
        console.log('Processing event:', event.type, event.data?.webhookType);
        console.log('Event data:', JSON.stringify(event.data, null, 2));
        switch (event.type) {
            case 'webhook':
                await this.handleWebhook(event);
                break;
            case 'heartbeat':
                // Just acknowledge heartbeats
                break;
            default:
                console.warn('Unknown event type:', event.type);
        }
    }
    async handleWebhook(event) {
        const webhook = event.data;
        // Linear webhook structure: { type, action, data, ... }
        // For notifications: { type: 'AppUserNotification', notification: { type: 'issueAssignedToYou', ... } }
        if (webhook.type === 'AppUserNotification') {
            const notificationType = webhook.notification?.type;
            const issue = webhook.notification?.issue;
            switch (notificationType) {
                case 'issueAssignedToYou':
                    await this.handleIssueAssigned(issue);
                    break;
                case 'issueCommentMention':
                case 'issueCommentReply':
                    await this.handleComment({ issue, comment: webhook.notification });
                    break;
                default:
                    console.log('Unhandled notification type:', notificationType);
            }
        }
        else {
            console.log('Unhandled webhook type:', webhook.type);
        }
    }
    async handleIssueAssigned(issue) {
        if (!issue) {
            console.error('No issue data provided to handleIssueAssigned');
            return;
        }
        console.log('Handling issue assigned:', issue.identifier, issue.title);
        // Create workspace directory
        const workspaceDir = (0, path_1.join)(this.config.workspaceBaseDir, `issue-${issue.id}`);
        await (0, promises_1.mkdir)(workspaceDir, { recursive: true });
        // Create a prompt file for Claude
        const prompt = `
You are working on Linear issue ${issue.identifier}: ${issue.title}

Description:
${issue.description || 'No description provided'}

Please help solve this issue.
`;
        await (0, promises_1.writeFile)((0, path_1.join)(workspaceDir, 'prompt.md'), prompt);
        // Start Claude session
        const claudeProcess = (0, child_process_1.spawn)(this.config.claudePath, [], {
            cwd: workspaceDir,
            env: {
                ...process.env,
                LINEAR_TOKEN: this.config.linearToken
            }
        });
        this.activeSessions.set(issue.id, {
            process: claudeProcess,
            workspaceDir
        });
        // Emit status updates
        this.emit('session-started', {
            issueId: issue.id,
            identifier: issue.identifier,
            title: issue.title
        });
        claudeProcess.on('exit', (code) => {
            this.emit('session-ended', {
                issueId: issue.id,
                code
            });
            this.activeSessions.delete(issue.id);
        });
    }
    async handleComment(data) {
        const { issue, comment } = data;
        const session = this.activeSessions.get(issue.id);
        if (!session) {
            console.log('No active session for issue:', issue.id);
            return;
        }
        // In a real implementation, we would send the comment to Claude
        // For now, just log it
        console.log('New comment on', issue.identifier, ':', comment.body);
    }
    getActiveSessions() {
        return Array.from(this.activeSessions.entries()).map(([issueId, session]) => ({
            issueId,
            workspaceDir: session.workspaceDir
        }));
    }
}
exports.EventProcessor = EventProcessor;
