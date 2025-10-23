/**
 * Agent Session types for Linear Agent Sessions integration
 * These types represent the core data structures for tracking Claude Code sessions in Linear
 */

import type { LinearDocument } from "@linear/sdk";
import type { ClaudeRunner } from "cyrus-claude-runner";

export interface IssueMinimal {
	id: string;
	identifier: string;
	title: string;
	description?: string;
	branchName: string;
}

export interface Workspace {
	path: string;
	isGitWorktree: boolean;
	historyPath?: string;
}

export interface CyrusAgentSession {
	linearAgentActivitySessionId: string;
	type: LinearDocument.AgentSessionType.CommentThread;
	status: LinearDocument.AgentSessionStatus;
	context: LinearDocument.AgentSessionType.CommentThread;
	createdAt: number; // e.g. Date.now()
	updatedAt: number; // e.g. Date.now()
	issueId: string;
	issue: IssueMinimal;
	workspace: Workspace;
	claudeSessionId?: string; // this gets assigned once it initializes
	claudeRunner?: ClaudeRunner;
	metadata?: {
		model?: string;
		tools?: string[];
		permissionMode?: string;
		apiKeySource?: string;
		totalCostUsd?: number;
		usage?: any;
		commentId?: string;
		shouldSyncToLinear?: boolean; // Control whether to sync activities to Linear (false for fake sessions from data change webhooks)
		// Thread reply support
		originalCommentId?: string; // ID of the comment that triggered this session
		originalCommentBody?: string; // Body of the original comment for context
		shouldReplyInThread?: boolean; // Whether to post a reply when session completes
		// Response template selection (for adaptive responses)
		responseTemplate?: string; // Automatically selected by select-template subroutine (e.g., "just-replying", "task-completion", "documentation", etc.)
		// Issue change tracking
		issueChangeHistory?: Array<{
			timestamp: number;
			changes: string; // Human-readable summary
			updatedFields: string[]; // List of specific changes
		}>;
		procedure?: {
			procedureName: string;
			currentSubroutineIndex: number;
			subroutineHistory: Array<{
				subroutine: string;
				completedAt: number;
				claudeSessionId: string | null;
			}>;
		};
	};
}

export interface CyrusAgentSessionEntry {
	claudeSessionId: string; // originated in this claude sessions
	linearAgentActivityId?: string; // got assigned this ID in linear, after creation, for this 'agent activity'
	type: "user" | "assistant" | "system" | "result";
	content: string;
	metadata?: {
		toolUseId?: string;
		toolName?: string;
		toolInput?: any;
		parentToolUseId?: string;
		toolResultError?: boolean; // Error status from tool_result blocks
		timestamp: number; // e.g. Date.now()
		durationMs?: number;
		isError?: boolean;
	};
}
