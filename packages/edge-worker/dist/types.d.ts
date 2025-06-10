import type { Issue, Workspace } from '@cyrus/core';
import type { ClaudeEvent } from '@cyrus/claude-parser';
/**
 * Configuration for a single repository/workspace pair
 */
export interface RepositoryConfig {
    id: string;
    name: string;
    repositoryPath: string;
    baseBranch: string;
    linearWorkspaceId: string;
    linearToken: string;
    workspaceBaseDir: string;
    isActive?: boolean;
    promptTemplatePath?: string;
}
/**
 * Configuration for the EdgeWorker supporting multiple repositories
 */
export interface EdgeWorkerConfig {
    proxyUrl: string;
    claudePath: string;
    defaultAllowedTools?: string[];
    repositories: RepositoryConfig[];
    handlers?: {
        createWorkspace?: (issue: Issue, repository: RepositoryConfig) => Promise<Workspace>;
        onClaudeEvent?: (issueId: string, event: ClaudeEvent, repositoryId: string) => void;
        onSessionStart?: (issueId: string, issue: Issue, repositoryId: string) => void;
        onSessionEnd?: (issueId: string, exitCode: number | null, repositoryId: string) => void;
        onError?: (error: Error, context?: any) => void;
    };
    features?: {
        enableContinuation?: boolean;
        enableTokenLimitHandling?: boolean;
        enableAttachmentDownload?: boolean;
        promptTemplatePath?: string;
    };
}
/**
 * Webhook types we handle
 */
export interface IssueAssignedWebhook {
    type: 'webhook';
    id: string;
    timestamp: string;
    data: {
        type: 'AppUserNotification';
        notification: {
            type: 'issueAssignedToYou';
            issue: any;
        };
        createdAt: string;
        eventId?: string;
    };
}
export interface CommentCreatedWebhook {
    type: 'webhook';
    id: string;
    timestamp: string;
    data: {
        type: 'Comment';
        action: 'create';
        createdAt: string;
        data: {
            issue: any;
            comment: any;
        };
        eventId?: string;
    };
}
/**
 * Events emitted by EdgeWorker
 */
export interface EdgeWorkerEvents {
    'connected': (token: string) => void;
    'disconnected': (token: string, reason?: string) => void;
    'session:started': (issueId: string, issue: Issue, repositoryId: string) => void;
    'session:ended': (issueId: string, exitCode: number | null, repositoryId: string) => void;
    'claude:event': (issueId: string, event: ClaudeEvent, repositoryId: string) => void;
    'claude:response': (issueId: string, text: string, repositoryId: string) => void;
    'claude:tool-use': (issueId: string, tool: string, input: any, repositoryId: string) => void;
    'error': (error: Error, context?: any) => void;
}
//# sourceMappingURL=types.d.ts.map