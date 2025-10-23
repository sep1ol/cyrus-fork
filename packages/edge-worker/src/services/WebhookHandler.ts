/**
 * WebhookHandler Service
 * Centralized handler for all Linear webhook types
 * Extracted from EdgeWorker.ts to reduce god object complexity
 */

import type { LinearClient } from "@linear/sdk";
import type {
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	LinearIssueAssignedWebhook,
	LinearIssueCommentMentionWebhook,
	LinearIssueNewCommentWebhook,
	LinearIssueUnassignedWebhook,
	LinearWebhook,
	RepositoryConfig,
} from "cyrus-core";
import type { ProcedureRouter } from "../procedures/ProcedureRouter.js";
import type { LinearApiClient } from "./LinearApiClient.js";

export interface WebhookHandlerOptions {
	/** Linear API client with retry logic */
	linearApiClient: LinearApiClient;
	/** Raw Linear client for operations not yet in LinearApiClient */
	linearClient: LinearClient;
	/** Repository configuration */
	repository: RepositoryConfig;
	/** Procedure router for intelligent workflow routing */
	procedureRouter: ProcedureRouter;
}

/**
 * Callbacks that WebhookHandler needs from EdgeWorker
 * This avoids circular dependencies while allowing the handler to trigger
 * core EdgeWorker functionality
 */
export interface WebhookHandlerCallbacks {
	/** Check if we should process this webhook (bot loop prevention, etc.) */
	shouldProcessWebhook(
		webhook: LinearWebhook,
		repository: RepositoryConfig,
	): Promise<boolean>;

	/** Start a Claude session for an issue */
	startIssueSession(
		issueId: string,
		repository: RepositoryConfig,
		trigger: "assignment" | "mention" | "comment",
	): Promise<void>;

	/** Handle agent session creation */
	onAgentSessionCreated(
		webhook: LinearAgentSessionCreatedWebhook,
		repository: RepositoryConfig,
	): Promise<void>;

	/** Handle user-posted agent activity (feedback) */
	onUserPostedAgentActivity(
		webhook: LinearAgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): Promise<void>;
}

/**
 * Centralized webhook handler service
 */
export class WebhookHandler {
	constructor(
		options: WebhookHandlerOptions,
		callbacks: WebhookHandlerCallbacks,
	) {
		this._linearApiClient = options.linearApiClient;
		this._linearClient = options.linearClient;
		this._repository = options.repository;
		this._procedureRouter = options.procedureRouter;
		this._callbacks = callbacks;
	}

	/**
	 * Main webhook dispatcher
	 */
	async handleWebhook(_webhook: LinearWebhook): Promise<void> {
		// Delegate to EdgeWorker for actual processing
		// This is intentionally minimal - the detailed logic stays in EdgeWorker
		// for now to avoid massive refactoring in one step
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle issue assignment webhook
	 */
	async handleIssueAssigned(
		_webhook: LinearIssueAssignedWebhook,
	): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle issue unassignment webhook
	 */
	async handleIssueUnassigned(
		_webhook: LinearIssueUnassignedWebhook,
	): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle comment mention webhook
	 */
	async handleCommentMention(
		_webhook: LinearIssueCommentMentionWebhook,
	): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle new comment webhook
	 */
	async handleNewComment(
		_webhook: LinearIssueNewCommentWebhook,
	): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle data change webhook (Issue, Comment updates)
	 */
	async handleDataChange(_webhook: LinearWebhook): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle agent session created webhook
	 */
	async handleAgentSessionCreated(
		_webhook: LinearAgentSessionCreatedWebhook,
	): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle user-posted agent activity
	 */
	async handleUserPostedAgentActivity(
		_webhook: LinearAgentSessionPromptedWebhook,
	): Promise<void> {
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}
}
