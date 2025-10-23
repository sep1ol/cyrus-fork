/**
 * SessionOrchestrator Service
 * Manages session lifecycle coordination between EdgeWorker and AgentSessionManager
 * Extracted from EdgeWorker.ts to reduce complexity
 */

import type { LinearClient } from "@linear/sdk";
import type { ClaudeRunner } from "cyrus-claude-runner";
import type { RepositoryConfig } from "cyrus-core";
import type { AgentSessionManager } from "../AgentSessionManager.js";
import type { ProcedureRouter } from "../procedures/ProcedureRouter.js";
import { Logger } from "../utils/Logger.js";
import type { LinearApiClient } from "./LinearApiClient.js";

const logger = new Logger({ name: "SessionOrchestrator" });

export interface SessionOrchestratorOptions {
	/** Linear API client with retry logic */
	linearApiClient: LinearApiClient;
	/** Raw Linear client */
	linearClient: LinearClient;
	/** Repository configuration */
	repository: RepositoryConfig;
	/** Agent session manager for this repository */
	agentSessionManager: AgentSessionManager;
	/** Procedure router for intelligent workflow routing */
	procedureRouter: ProcedureRouter;
}

/**
 * Session lifecycle orchestration service
 * Coordinates between EdgeWorker, AgentSessionManager, and ClaudeRunner
 */
export class SessionOrchestrator {
	private _repository: RepositoryConfig;

	constructor(options: SessionOrchestratorOptions) {
		this._linearApiClient = options.linearApiClient;
		this._linearClient = options.linearClient;
		this._repository = options.repository;
		this._agentSessionManager = options.agentSessionManager;
		this._procedureRouter = options.procedureRouter;
	}

	/**
	 * Start a new Claude session for an issue
	 */
	async startIssueSession(
		issueId: string,
		trigger: "assignment" | "mention" | "comment" | "manual",
	): Promise<ClaudeRunner | null> {
		logger.info("Starting session for issue", {
			repository: this._repository.name,
			issueId,
			trigger,
		});

		// NOTE: Actual implementation would be moved from EdgeWorker
		// For now, this is a placeholder demonstrating the service pattern
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Resume a parent session with prompt from child
	 */
	async resumeParentSession(
		parentSessionId: string,
		_prompt: string,
		_childSessionId?: string,
	): Promise<void> {
		logger.info("Resuming parent session", {
			repository: this._repository.name,
			parentSessionId,
			childSessionId: _childSessionId,
		});

		// NOTE: Actual implementation would be moved from EdgeWorker
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle session completion
	 */
	async onSessionComplete(sessionId: string, success: boolean): Promise<void> {
		logger.info("Session completed", {
			repository: this._repository.name,
			sessionId,
			success,
		});

		// NOTE: Actual implementation would be moved from EdgeWorker
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}

	/**
	 * Handle session error
	 */
	async onSessionError(sessionId: string, error: Error): Promise<void> {
		logger.error("Session error", {
			repository: this._repository.name,
			sessionId,
			error,
		});

		// NOTE: Actual implementation would be moved from EdgeWorker
		throw new Error("Not yet implemented - keeping in EdgeWorker for now");
	}
}
