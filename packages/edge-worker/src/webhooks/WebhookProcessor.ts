/**
 * Common webhook processing utilities
 * Extracts duplicated logic from EdgeWorker
 */

import type {
	LinearAgentSessionCreatedWebhook,
	LinearWebhookIssue,
	RepositoryConfig,
} from "cyrus-core";
import type {
	CommentWebhook,
	IssueWebhook,
	TypedWebhook,
} from "../types/webhooks.js";
import {
	extractIssueId,
	extractTeamId,
	isCommentWebhook,
	isIssueWebhook,
} from "../types/webhooks.js";

/**
 * Check if webhook should be processed based on repository routing rules
 */
export function shouldProcessWebhook(
	webhook: TypedWebhook,
	repository: RepositoryConfig,
): boolean {
	// Check if repository is active
	if (repository.isActive === false) {
		return false;
	}

	const teamId = extractTeamId(webhook);

	// If repository has teamKeys configured, check if webhook matches
	if (repository.teamKeys && repository.teamKeys.length > 0) {
		if (!teamId) {
			return false;
		}

		// Get team key from webhook
		let teamKey: string | undefined;
		if (isIssueWebhook(webhook)) {
			teamKey = webhook.data.team?.key;
		} else if (isCommentWebhook(webhook)) {
			teamKey = webhook.data.issue?.team?.key;
		}

		if (!teamKey || !repository.teamKeys.includes(teamKey)) {
			return false;
		}
	}

	// TODO: Add projectKeys and routingLabels checks here when needed

	return true;
}

/**
 * Create a fake AgentSession webhook from comment data
 * Common pattern used for comment webhooks that need to trigger sessions
 */
export function createFakeAgentSessionFromComment(
	commentWebhook: CommentWebhook,
	organizationId: string,
): LinearAgentSessionCreatedWebhook {
	const { data, createdAt, webhookTimestamp, webhookId } = commentWebhook;
	const issueId = data.issueId || data.issue?.id;

	if (!issueId) {
		throw new Error("Cannot create fake agent session: missing issueId");
	}

	const fakeIssue: LinearWebhookIssue = {
		id: issueId,
		title: data.issue?.title || "Unknown",
		teamId: data.issue?.teamId || "",
		team: data.issue?.team || { id: "", key: "", name: "" },
		identifier: data.issue?.identifier || issueId,
		url: data.issue?.url || `https://linear.app/issue/${issueId}`,
	};

	return {
		type: "AgentSessionEvent",
		action: "created",
		createdAt,
		organizationId,
		oauthClientId: "data-change-webhook",
		appUserId: "data-change-webhook-user",
		webhookTimestamp: webhookTimestamp || new Date().toISOString(),
		webhookId: `datachange_comment_${webhookId || crypto.randomUUID()}`,
		agentSession: {
			id: crypto.randomUUID(),
			createdAt,
			updatedAt: createdAt,
			archivedAt: null,
			creatorId: "data-change-webhook-user",
			appUserId: "data-change-webhook-user",
			commentId: data.id,
			issueId,
			status: "pending",
			startedAt: null,
			endedAt: null,
			type: "commentThread",
			summary: null,
			sourceMetadata: null,
			organizationId,
			creator: {
				id: "data-change-webhook-user",
				name: "Data Change Webhook",
				email: "",
				avatarUrl: "",
				url: "",
			},
			comment: {
				id: data.id,
				body: data.body || "",
				userId: data.userId || "",
				issueId,
				parentId: data.parentId,
			},
			issue: fakeIssue,
			metadata: {
				originalCommentId: data.id,
				originalCommentBody: data.body || "",
				shouldReplyInThread: true,
			},
		} as any,
		guidance: [],
	};
}

/**
 * Extract human-readable changes from issue webhook
 */
export function extractIssueChanges(webhook: IssueWebhook): {
	summary: string;
	updatedFields: string[];
} {
	const { data, updatedFrom } = webhook;
	const changes: string[] = [];
	const updatedFields: string[] = [];

	if (updatedFrom?.title !== undefined && data.title !== updatedFrom.title) {
		changes.push(`Title: "${updatedFrom.title}" → "${data.title}"`);
		updatedFields.push("title");
	}

	if (
		updatedFrom?.assigneeId !== undefined &&
		data.assigneeId !== updatedFrom.assigneeId
	) {
		const from = updatedFrom.assigneeId || "unassigned";
		const to = data.assigneeId || "unassigned";
		changes.push(`Assignee: ${from} → ${to}`);
		updatedFields.push("assignee");
	}

	if (
		updatedFrom?.state?.name !== undefined &&
		data.state?.name !== updatedFrom.state?.name
	) {
		changes.push(
			`State: ${updatedFrom.state.name} → ${data.state?.name || "unknown"}`,
		);
		updatedFields.push("state");
	}

	if (
		updatedFrom?.priority !== undefined &&
		data.priority !== updatedFrom.priority
	) {
		changes.push(`Priority: ${updatedFrom.priority} → ${data.priority}`);
		updatedFields.push("priority");
	}

	const summary = changes.length > 0 ? changes.join(", ") : "Issue updated";
	return { summary, updatedFields };
}

/**
 * Validate webhook has required fields
 */
export function validateWebhook(webhook: any): {
	valid: boolean;
	error?: string;
} {
	if (!webhook) {
		return { valid: false, error: "Webhook is null or undefined" };
	}

	if (!webhook.type) {
		return { valid: false, error: "Webhook missing 'type' field" };
	}

	if (!webhook.action) {
		return { valid: false, error: "Webhook missing 'action' field" };
	}

	if (!webhook.organizationId) {
		return { valid: false, error: "Webhook missing 'organizationId' field" };
	}

	return { valid: true };
}

/**
 * Get a readable description of the webhook for logging
 */
export function describeWebhook(webhook: TypedWebhook): string {
	const issueId = extractIssueId(webhook);
	const teamId = extractTeamId(webhook);

	if (isIssueWebhook(webhook)) {
		return `Issue ${webhook.action} (${issueId}, team: ${teamId})`;
	}

	if (isCommentWebhook(webhook)) {
		return `Comment ${webhook.action} on issue ${issueId} (${webhook.data.id})`;
	}

	return `${webhook.type} ${webhook.action}`;
}
