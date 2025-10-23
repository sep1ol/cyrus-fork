/**
 * Strict type definitions for Linear webhooks
 * Replaces 'any' types with proper type safety
 */

import type { LinearWebhookAgentSession, LinearWebhookIssue } from "cyrus-core";

// Base webhook structure
export interface BaseWebhook {
	type: string;
	action: string;
	createdAt: string;
	organizationId: string;
	webhookTimestamp?: string;
	webhookId?: string;
}

// Issue webhook data
export interface IssueWebhookData {
	id: string;
	title?: string;
	description?: string;
	assigneeId?: string | null;
	state?: {
		id: string;
		name: string;
		type: string;
	};
	team?: {
		id: string;
		key: string;
		name: string;
	};
	teamId?: string;
	priority?: number;
	estimate?: number;
	labels?: Array<{ id: string; name: string }>;
	projectId?: string;
	project?: {
		id: string;
		name: string;
	};
	identifier?: string;
	url?: string;
	issue?: Partial<LinearWebhookIssue>;
}

// Comment webhook data
export interface CommentWebhookData {
	id: string;
	body?: string;
	userId?: string;
	issueId?: string;
	parentId?: string;
	botActor?: boolean;
	createdAt?: string;
	updatedAt?: string;
	issue?: {
		id: string;
		identifier?: string;
		title?: string;
		teamId?: string;
		team?: { id: string; key: string; name: string };
		url?: string;
	};
}

// Issue webhook with typed data
export interface IssueWebhook extends BaseWebhook {
	type: "Issue";
	action: "create" | "update" | "remove";
	data: IssueWebhookData;
	updatedFrom?: Partial<IssueWebhookData>;
}

// Comment webhook with typed data
export interface CommentWebhook extends BaseWebhook {
	type: "Comment";
	action: "create" | "update" | "remove";
	data: CommentWebhookData;
	updatedFrom?: Partial<CommentWebhookData>;
}

// AgentSession webhook (already well-typed in cyrus-core)
export interface AgentSessionWebhook extends BaseWebhook {
	type: "AgentSessionEvent";
	action: "created" | "prompted";
	agentSession: LinearWebhookAgentSession;
	guidance?: any[];
}

// Union type for all webhooks
export type TypedWebhook = IssueWebhook | CommentWebhook | AgentSessionWebhook;

// Type guards for webhook discrimination
export function isIssueWebhook(webhook: any): webhook is IssueWebhook {
	return webhook?.type === "Issue";
}

export function isCommentWebhook(webhook: any): webhook is CommentWebhook {
	return webhook?.type === "Comment";
}

export function isAgentSessionWebhook(
	webhook: any,
): webhook is AgentSessionWebhook {
	return webhook?.type === "AgentSessionEvent";
}

export function isIssueCreateWebhook(webhook: any): webhook is IssueWebhook {
	return isIssueWebhook(webhook) && webhook.action === "create";
}

export function isIssueUpdateWebhook(webhook: any): webhook is IssueWebhook {
	return isIssueWebhook(webhook) && webhook.action === "update";
}

export function isCommentCreateWebhook(
	webhook: any,
): webhook is CommentWebhook {
	return isCommentWebhook(webhook) && webhook.action === "create";
}

/**
 * Helper to safely extract issue ID from various webhook types
 */
export function extractIssueId(webhook: TypedWebhook): string | undefined {
	if (isIssueWebhook(webhook)) {
		return webhook.data.id;
	}
	if (isCommentWebhook(webhook)) {
		return webhook.data.issueId || webhook.data.issue?.id;
	}
	if (isAgentSessionWebhook(webhook)) {
		return webhook.agentSession.issueId;
	}
	return undefined;
}

/**
 * Helper to safely extract team ID from various webhook types
 */
export function extractTeamId(webhook: TypedWebhook): string | undefined {
	if (isIssueWebhook(webhook)) {
		return webhook.data.teamId || webhook.data.team?.id;
	}
	if (isCommentWebhook(webhook)) {
		return webhook.data.issue?.teamId || webhook.data.issue?.team?.id;
	}
	return undefined;
}

/**
 * Helper to check if issue was newly assigned
 */
export function wasNewlyAssigned(webhook: IssueWebhook): boolean {
	if (webhook.action !== "update") {
		return false;
	}

	const { data, updatedFrom } = webhook;
	const wasUnassigned =
		updatedFrom?.assigneeId === null || updatedFrom?.assigneeId === undefined;
	const nowAssigned = data.assigneeId !== null && data.assigneeId !== undefined;

	return wasUnassigned && nowAssigned;
}

/**
 * Helper to check if webhook is from bot
 */
export function isFromBot(webhook: CommentWebhook): boolean {
	return (
		!webhook.data.userId ||
		webhook.data.userId === "data-change-webhook-user" ||
		webhook.data.botActor === true
	);
}
