import { type LinearClient, LinearDocument } from "@linear/sdk";
import type {
	APIAssistantMessage,
	APIUserMessage,
	ClaudeRunner,
	SDKAssistantMessage,
	SDKMessage,
	SDKResultMessage,
	SDKSystemMessage,
	SDKUserMessage,
} from "cyrus-claude-runner";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	IssueMinimal,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
	Workspace,
} from "cyrus-core";
import type { ProcedureRouter } from "./procedures/ProcedureRouter.js";
import type { SharedApplicationServer } from "./SharedApplicationServer.js";
import { Logger } from "./utils/Logger.js";

/**
 * Manages Linear Agent Sessions integration with Claude Code SDK
 * Transforms Claude streaming messages into Agent Session format
 * Handles session lifecycle: create → active → complete/error
 *
 * CURRENTLY BEING HANDLED 'per repository'
 */
export class AgentSessionManager {
	private logger = new Logger({ name: "AgentSessionManager" });
	private linearClient: LinearClient;
	private sessions: Map<string, CyrusAgentSession> = new Map();
	private entries: Map<string, CyrusAgentSessionEntry[]> = new Map(); // Stores a list of session entries per each session by its linearAgentActivitySessionId
	private activeTasksBySession: Map<string, string> = new Map(); // Maps session ID to active Task tool use ID
	private toolCallsByToolUseId: Map<string, { name: string; input: any }> =
		new Map(); // Track tool calls by their tool_use_id
	private localOnlySessionsLogged: Set<string> = new Set(); // Track which local-only sessions have been logged
	private procedureRouter?: ProcedureRouter;
	private sharedApplicationServer?: SharedApplicationServer;
	private getParentSessionId?: (childSessionId: string) => string | undefined;
	private resumeParentSession?: (
		parentSessionId: string,
		prompt: string,
		childSessionId: string,
	) => Promise<void>;
	private resumeNextSubroutine?: (
		linearAgentActivitySessionId: string,
	) => Promise<void>;

	constructor(
		linearClient: LinearClient,
		getParentSessionId?: (childSessionId: string) => string | undefined,
		resumeParentSession?: (
			parentSessionId: string,
			prompt: string,
			childSessionId: string,
		) => Promise<void>,
		resumeNextSubroutine?: (
			linearAgentActivitySessionId: string,
		) => Promise<void>,
		procedureRouter?: ProcedureRouter,
		sharedApplicationServer?: SharedApplicationServer,
	) {
		this.linearClient = linearClient;
		this.getParentSessionId = getParentSessionId;
		this.resumeParentSession = resumeParentSession;
		this.resumeNextSubroutine = resumeNextSubroutine;
		this.procedureRouter = procedureRouter;
		this.sharedApplicationServer = sharedApplicationServer;
	}

	/**
	 * Initialize a Linear agent session from webhook
	 * The session is already created by Linear, we just need to track it
	 */
	createLinearAgentSession(
		linearAgentActivitySessionId: string,
		issueId: string,
		issueMinimal: IssueMinimal,
		workspace: Workspace,
		shouldSyncToLinear: boolean = true, // Default to true for backward compatibility
	): CyrusAgentSession {
		this.logger.info("Tracking Linear session", {
			sessionId: linearAgentActivitySessionId,
			issueId,
			shouldSyncToLinear,
			syncMode: shouldSyncToLinear ? "linear-sync" : "local-only",
		});

		const agentSession: CyrusAgentSession = {
			linearAgentActivitySessionId,
			type: LinearDocument.AgentSessionType.CommentThread,
			status: LinearDocument.AgentSessionStatus.Active,
			context: LinearDocument.AgentSessionType.CommentThread,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			issueId,
			issue: issueMinimal,
			workspace: workspace,
			metadata: {
				...({} as any),
				shouldSyncToLinear, // Add flag to control Linear sync
			},
		};

		// Store locally
		this.sessions.set(linearAgentActivitySessionId, agentSession);
		this.entries.set(linearAgentActivitySessionId, []);

		return agentSession;
	}

	/**
	 * Create a new Agent Session from Claude system initialization
	 */
	updateAgentSessionWithClaudeSessionId(
		linearAgentActivitySessionId: string,
		claudeSystemMessage: SDKSystemMessage,
	): void {
		const linearSession = this.sessions.get(linearAgentActivitySessionId);
		if (!linearSession) {
			this.logger.warn("No Linear session found for update", {
				sessionId: linearAgentActivitySessionId,
				operation: "updateClaudeSessionId",
			});
			return;
		}
		linearSession.claudeSessionId = claudeSystemMessage.session_id;
		linearSession.updatedAt = Date.now();
		linearSession.metadata = {
			...linearSession.metadata, // Preserve existing metadata
			model: claudeSystemMessage.model,
			tools: claudeSystemMessage.tools,
			permissionMode: claudeSystemMessage.permissionMode,
			apiKeySource: claudeSystemMessage.apiKeySource,
		};
	}

	/**
	 * Create a session entry from Claude user/assistant message (without syncing to Linear)
	 */
	private async createSessionEntry(
		_linearAgentActivitySessionId: string,
		sdkMessage: SDKUserMessage | SDKAssistantMessage,
	): Promise<CyrusAgentSessionEntry> {
		// Extract tool info if this is an assistant message
		const toolInfo =
			sdkMessage.type === "assistant" ? this.extractToolInfo(sdkMessage) : null;
		// Extract tool_use_id and error status if this is a user message with tool_result
		const toolResultInfo =
			sdkMessage.type === "user"
				? this.extractToolResultInfo(sdkMessage)
				: null;

		const sessionEntry: CyrusAgentSessionEntry = {
			claudeSessionId: sdkMessage.session_id,
			type: sdkMessage.type,
			content: this.extractContent(sdkMessage),
			metadata: {
				timestamp: Date.now(),
				parentToolUseId: sdkMessage.parent_tool_use_id || undefined,
				...(toolInfo && {
					toolUseId: toolInfo.id,
					toolName: toolInfo.name,
					toolInput: toolInfo.input,
				}),
				...(toolResultInfo && {
					toolUseId: toolResultInfo.toolUseId,
					toolResultError: toolResultInfo.isError,
				}),
			},
		};

		// DON'T store locally yet - wait until we actually post to Linear
		return sessionEntry;
	}

	/**
	 * Format TodoWrite tool parameter as a nice checklist
	 */
	private formatTodoWriteParameter(jsonContent: string): string {
		try {
			const data = JSON.parse(jsonContent);
			if (!data.todos || !Array.isArray(data.todos)) {
				return jsonContent;
			}

			const todos = data.todos as Array<{
				id: string;
				content: string;
				status: string;
				priority: string;
			}>;

			// Keep original order but add status indicators
			let formatted = "\n";

			todos.forEach((todo, index) => {
				let statusEmoji = "";
				if (todo.status === "completed") {
					statusEmoji = "✅ ";
				} else if (todo.status === "in_progress") {
					statusEmoji = "🔄 ";
				} else if (todo.status === "pending") {
					statusEmoji = "⏳ ";
				}

				formatted += `${statusEmoji}${todo.content}`;
				if (index < todos.length - 1) {
					formatted += "\n";
				}
			});

			return formatted;
		} catch (error) {
			this.logger.error("Failed to format TodoWrite parameter", error, {
				operation: "formatTodoWriteParameter",
			});
			return jsonContent;
		}
	}

	/**
	 * Get entries for a session
	 */
	getEntriesForSession(
		linearAgentActivitySessionId: string,
	): CyrusAgentSessionEntry[] {
		return this.entries.get(linearAgentActivitySessionId) || [];
	}

	/**
	 * Get all active sessions for a specific issue
	 */
	getSessionsForIssue(issueId: string): CyrusAgentSession[] {
		const sessions: CyrusAgentSession[] = [];
		for (const session of this.sessions.values()) {
			if (session.issueId === issueId) {
				sessions.push(session);
			}
		}
		return sessions;
	}

	/**
	 * Complete a session from Claude result message
	 */
	async completeSession(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (!session) {
			this.logger.error("No session found for completion", undefined, {
				sessionId: linearAgentActivitySessionId,
				operation: "completeSession",
			});
			return;
		}

		// Clear any active Task when session completes
		this.activeTasksBySession.delete(linearAgentActivitySessionId);

		// Clear tool calls tracking for this session
		// Note: We should ideally track by session, but for now clearing all is safer
		// to prevent memory leaks

		const status =
			resultMessage.subtype === "success"
				? LinearDocument.AgentSessionStatus.Complete
				: LinearDocument.AgentSessionStatus.Error;

		// Update session status and metadata
		await this.updateSessionStatus(linearAgentActivitySessionId, status, {
			totalCostUsd: resultMessage.total_cost_usd,
			usage: resultMessage.usage,
		});

		// Handle result using procedure routing system
		if ("result" in resultMessage && resultMessage.result) {
			await this.handleProcedureCompletion(
				session,
				linearAgentActivitySessionId,
				resultMessage,
			);
		}
	}

	/**
	 * Handle completion using procedure routing system
	 */
	private async handleProcedureCompletion(
		session: CyrusAgentSession,
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		if (!this.procedureRouter) {
			throw new Error("ProcedureRouter not available");
		}

		// Check if error occurred
		if (resultMessage.subtype !== "success") {
			this.logger.info("Subroutine completed with error", {
				sessionId: linearAgentActivitySessionId,
				resultSubtype: resultMessage.subtype,
				skipNextSubroutine: true,
			});
			return;
		}

		const claudeSessionId = session.claudeSessionId;
		if (!claudeSessionId) {
			this.logger.error("No Claude session ID for procedure", undefined, {
				sessionId: linearAgentActivitySessionId,
				operation: "handleProcedureCompletion",
			});
			return;
		}

		// Check if there's a next subroutine
		const nextSubroutine = this.procedureRouter.getNextSubroutine(session);

		if (nextSubroutine) {
			// More subroutines to run - check if current subroutine requires approval
			const currentSubroutine =
				this.procedureRouter.getCurrentSubroutine(session);

			if (currentSubroutine?.requiresApproval) {
				this.logger.info("Subroutine requires approval", {
					sessionId: linearAgentActivitySessionId,
					subroutineName: currentSubroutine.name,
					awaitingApproval: true,
				});

				// Check if SharedApplicationServer is available
				if (!this.sharedApplicationServer) {
					this.logger.error(
						"SharedApplicationServer not available",
						undefined,
						{
							sessionId: linearAgentActivitySessionId,
							operation: "approvalWorkflow",
						},
					);
					await this.createErrorActivity(
						linearAgentActivitySessionId,
						"Approval workflow failed: Server not available",
					);
					return;
				}

				// Extract the final result from the completed subroutine
				const subroutineResult =
					"result" in resultMessage && resultMessage.result
						? resultMessage.result
						: "No result available";

				try {
					// Register approval request with server
					const approvalRequest =
						this.sharedApplicationServer.registerApprovalRequest(
							linearAgentActivitySessionId,
						);

					// Post approval elicitation to Linear with auth signal URL
					const approvalMessage = `The previous step has completed. Please review the result below and approve to continue:\n\n${subroutineResult}`;

					await this.createApprovalElicitation(
						linearAgentActivitySessionId,
						approvalMessage,
						approvalRequest.url,
					);

					this.logger.info("Waiting for approval", {
						sessionId: linearAgentActivitySessionId,
						approvalUrl: approvalRequest.url,
					});

					// Wait for approval with timeout (30 minutes)
					const approvalTimeout = 30 * 60 * 1000;
					const timeoutPromise = new Promise<never>((_, reject) =>
						setTimeout(
							() => reject(new Error("Approval timeout")),
							approvalTimeout,
						),
					);

					const { approved, feedback } = await Promise.race([
						approvalRequest.promise,
						timeoutPromise,
					]);

					if (!approved) {
						this.logger.info("Approval rejected", {
							sessionId: linearAgentActivitySessionId,
							hasFeedback: !!feedback,
						});
						await this.createErrorActivity(
							linearAgentActivitySessionId,
							`Workflow stopped: User rejected approval.${feedback ? `\n\nFeedback: ${feedback}` : ""}`,
						);
						return; // Stop workflow
					}

					this.logger.info("Approval granted", {
						sessionId: linearAgentActivitySessionId,
						hasFeedback: !!feedback,
					});

					// Optionally post feedback as a thought
					if (feedback) {
						await this.createThoughtActivity(
							linearAgentActivitySessionId,
							`User feedback: ${feedback}`,
						);
					}

					// Continue with advancement (fall through to existing code)
				} catch (error) {
					const errorMessage = (error as Error).message;
					if (errorMessage === "Approval timeout") {
						this.logger.warn("Approval timed out", {
							sessionId: linearAgentActivitySessionId,
							timeoutMs: 30 * 60 * 1000,
						});
						await this.createErrorActivity(
							linearAgentActivitySessionId,
							"Workflow stopped: Approval request timed out after 30 minutes.",
						);
					} else {
						this.logger.error("Approval request failed", error, {
							sessionId: linearAgentActivitySessionId,
						});
						await this.createErrorActivity(
							linearAgentActivitySessionId,
							`Workflow stopped: Approval request failed - ${errorMessage}`,
						);
					}
					return; // Stop workflow
				}
			}

			// Advance procedure state
			this.logger.info("Advancing to next subroutine", {
				sessionId: linearAgentActivitySessionId,
				nextSubroutineName: nextSubroutine.name,
			});
			this.procedureRouter.advanceToNextSubroutine(session, claudeSessionId);

			// Trigger next subroutine
			if (this.resumeNextSubroutine) {
				try {
					await this.resumeNextSubroutine(linearAgentActivitySessionId);
				} catch (error) {
					this.logger.error("Failed to trigger next subroutine", error, {
						sessionId: linearAgentActivitySessionId,
						nextSubroutineName: nextSubroutine.name,
					});
				}
			}
		} else {
			// Procedure complete - post final result
			this.logger.info("All subroutines completed", {
				sessionId: linearAgentActivitySessionId,
				postingFinalResult: true,
			});
			await this.addResultEntry(linearAgentActivitySessionId, resultMessage);

			// Handle child session completion
			const isChildSession = this.getParentSessionId?.(
				linearAgentActivitySessionId,
			);
			if (isChildSession && this.resumeParentSession) {
				await this.handleChildSessionCompletion(
					linearAgentActivitySessionId,
					resultMessage,
				);
			}
		}
	}

	/**
	 * Handle child session completion and resume parent
	 */
	private async handleChildSessionCompletion(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		if (!this.getParentSessionId || !this.resumeParentSession) {
			return;
		}

		const parentAgentSessionId = this.getParentSessionId(
			linearAgentActivitySessionId,
		);

		if (!parentAgentSessionId) {
			this.logger.error("No parent session ID found for child", undefined, {
				childSessionId: linearAgentActivitySessionId,
				operation: "handleChildSessionCompletion",
			});
			return;
		}

		this.logger.info("Child session completed, resuming parent", {
			childSessionId: linearAgentActivitySessionId,
			parentSessionId: parentAgentSessionId,
		});

		try {
			const childResult =
				"result" in resultMessage
					? resultMessage.result
					: "No result available";
			const promptToParent = `Child agent session ${linearAgentActivitySessionId} completed with result:\n\n${childResult}`;

			await this.resumeParentSession(
				parentAgentSessionId,
				promptToParent,
				linearAgentActivitySessionId,
			);

			this.logger.info("Successfully resumed parent session", {
				parentSessionId: parentAgentSessionId,
				childSessionId: linearAgentActivitySessionId,
			});
		} catch (error) {
			this.logger.error("Failed to resume parent session", error, {
				parentSessionId: parentAgentSessionId,
				childSessionId: linearAgentActivitySessionId,
			});
		}
	}

	/**
	 * Handle streaming Claude messages and route to appropriate methods
	 */
	async handleClaudeMessage(
		linearAgentActivitySessionId: string,
		message: SDKMessage,
	): Promise<void> {
		try {
			switch (message.type) {
				case "system":
					if (message.subtype === "init") {
						this.updateAgentSessionWithClaudeSessionId(
							linearAgentActivitySessionId,
							message,
						);

						// Post model notification
						const systemMessage = message as SDKSystemMessage;
						if (systemMessage.model) {
							await this.postModelNotificationThought(
								linearAgentActivitySessionId,
								systemMessage.model,
							);
						}
					}
					break;

				case "user": {
					const userEntry = await this.createSessionEntry(
						linearAgentActivitySessionId,
						message as SDKUserMessage,
					);
					await this.syncEntryToLinear(userEntry, linearAgentActivitySessionId);
					break;
				}

				case "assistant": {
					const assistantEntry = await this.createSessionEntry(
						linearAgentActivitySessionId,
						message as SDKAssistantMessage,
					);
					await this.syncEntryToLinear(
						assistantEntry,
						linearAgentActivitySessionId,
					);
					break;
				}

				case "result":
					await this.completeSession(
						linearAgentActivitySessionId,
						message as SDKResultMessage,
					);
					break;

				default:
					this.logger.warn("Unknown message type", {
						sessionId: linearAgentActivitySessionId,
						messageType: (message as any).type,
					});
			}
		} catch (error) {
			this.logger.error("Error handling message", error, {
				sessionId: linearAgentActivitySessionId,
				messageType: message.type,
			});
			// Mark session as error state
			await this.updateSessionStatus(
				linearAgentActivitySessionId,
				LinearDocument.AgentSessionStatus.Error,
			);
		}
	}

	/**
	 * Update session status and metadata
	 */
	private async updateSessionStatus(
		linearAgentActivitySessionId: string,
		status: LinearDocument.AgentSessionStatus,
		additionalMetadata?: Partial<CyrusAgentSession["metadata"]>,
	): Promise<void> {
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (!session) return;

		session.status = status;
		session.updatedAt = Date.now();

		if (additionalMetadata) {
			session.metadata = { ...session.metadata, ...additionalMetadata };
		}

		this.sessions.set(linearAgentActivitySessionId, session);
	}

	/**
	 * Add result entry from Claude result message
	 */
	private async addResultEntry(
		linearAgentActivitySessionId: string,
		resultMessage: SDKResultMessage,
	): Promise<void> {
		const resultEntry: CyrusAgentSessionEntry = {
			claudeSessionId: resultMessage.session_id,
			type: "result",
			content: "result" in resultMessage ? resultMessage.result : "",
			metadata: {
				timestamp: Date.now(),
				durationMs: resultMessage.duration_ms,
				isError: resultMessage.is_error,
			},
		};

		// DON'T store locally - syncEntryToLinear will do it
		// Sync to Linear
		await this.syncEntryToLinear(resultEntry, linearAgentActivitySessionId);
	}

	/**
	 * Extract content from Claude message
	 */
	private extractContent(
		sdkMessage: SDKUserMessage | SDKAssistantMessage,
	): string {
		const message =
			sdkMessage.type === "user"
				? (sdkMessage.message as APIUserMessage)
				: (sdkMessage.message as APIAssistantMessage);

		if (typeof message.content === "string") {
			return message.content;
		}

		if (Array.isArray(message.content)) {
			return message.content
				.map((block: any) => {
					if (block.type === "text") {
						return block.text;
					} else if (block.type === "tool_use") {
						// For tool use blocks, return the input as JSON string
						return JSON.stringify(block.input, null, 2);
					} else if (block.type === "tool_result") {
						// For tool_result blocks, extract just the text content
						// Also store the error status in metadata if needed
						if ("is_error" in block && block.is_error) {
							// Mark this as an error result - we'll handle this elsewhere
						}
						if (typeof block.content === "string") {
							return block.content;
						}
						if (Array.isArray(block.content)) {
							return block.content
								.filter((contentBlock: any) => contentBlock.type === "text")
								.map((contentBlock: any) => contentBlock.text)
								.join("\n");
						}
						return "";
					}
					return "";
				})
				.filter(Boolean)
				.join("\n");
		}

		return "";
	}

	/**
	 * Extract tool information from Claude assistant message
	 */
	private extractToolInfo(
		sdkMessage: SDKAssistantMessage,
	): { id: string; name: string; input: any } | null {
		const message = sdkMessage.message as APIAssistantMessage;

		if (Array.isArray(message.content)) {
			const toolUse = message.content.find(
				(block: any) => block.type === "tool_use",
			);
			if (
				toolUse &&
				"id" in toolUse &&
				"name" in toolUse &&
				"input" in toolUse
			) {
				return {
					id: toolUse.id,
					name: toolUse.name,
					input: toolUse.input,
				};
			}
		}
		return null;
	}

	/**
	 * Extract tool_use_id and error status from Claude user message containing tool_result
	 */
	private extractToolResultInfo(
		sdkMessage: SDKUserMessage,
	): { toolUseId: string; isError: boolean } | null {
		const message = sdkMessage.message as APIUserMessage;

		if (Array.isArray(message.content)) {
			const toolResult = message.content.find(
				(block: any) => block.type === "tool_result",
			);
			if (toolResult && "tool_use_id" in toolResult) {
				return {
					toolUseId: toolResult.tool_use_id,
					isError: "is_error" in toolResult && toolResult.is_error === true,
				};
			}
		}
		return null;
	}

	/**
	 * Extract tool result content and error status from session entry
	 */
	private extractToolResult(
		entry: CyrusAgentSessionEntry,
	): { content: string; isError: boolean } | null {
		// Check if we have the error status in metadata
		const isError = entry.metadata?.toolResultError || false;

		return {
			content: entry.content,
			isError: isError,
		};
	}

	/**
	 * Sync Agent Session Entry to Linear (create AgentActivity)
	 */
	private async syncEntryToLinear(
		entry: CyrusAgentSessionEntry,
		linearAgentActivitySessionId: string,
	): Promise<void> {
		try {
			const session = this.sessions.get(linearAgentActivitySessionId);
			if (!session) {
				this.logger.warn("No Linear session for entry sync", {
					sessionId: linearAgentActivitySessionId,
					operation: "syncEntryToLinear",
				});
				return;
			}

			// Store entry locally first
			const entries = this.entries.get(linearAgentActivitySessionId) || [];
			entries.push(entry);
			this.entries.set(linearAgentActivitySessionId, entries);

			// Skip Linear sync for sessions marked as local-only (e.g., from data change webhooks)
			if (session.metadata?.shouldSyncToLinear === false) {
				// Only log this once per session to avoid spam
				if (!this.localOnlySessionsLogged.has(linearAgentActivitySessionId)) {
					this.logger.debug("Skipping Linear sync for local-only session", {
						sessionId: linearAgentActivitySessionId,
						entryType: entry.type,
					});
					this.localOnlySessionsLogged.add(linearAgentActivitySessionId);
				}
				return;
			}

			// Build activity content based on entry type
			let content: any;
			let ephemeral = false;
			switch (entry.type) {
				case "user": {
					const activeTaskId = this.activeTasksBySession.get(
						linearAgentActivitySessionId,
					);
					if (activeTaskId && activeTaskId === entry.metadata?.toolUseId) {
						content = {
							type: "thought",
							body: `✅ Task Completed\n\n\n\n${entry.content}\n\n---\n\n`,
						};
						this.activeTasksBySession.delete(linearAgentActivitySessionId);
					} else if (entry.metadata?.toolUseId) {
						// This is a tool result - create an action activity with the result
						const toolResult = this.extractToolResult(entry);
						if (toolResult) {
							// Get the original tool information
							const originalTool = this.toolCallsByToolUseId.get(
								entry.metadata.toolUseId,
							);
							const toolName = originalTool?.name || "Tool";
							const toolInput = originalTool?.input || "";

							// Clean up the tool call from our tracking map
							if (entry.metadata.toolUseId) {
								this.toolCallsByToolUseId.delete(entry.metadata.toolUseId);
							}

							// Skip creating activity for TodoWrite results since TodoWrite already created a non-ephemeral thought
							if (toolName === "TodoWrite" || toolName === "↪ TodoWrite") {
								return;
							}

							// Format input for display
							const formattedInput =
								typeof toolInput === "string"
									? toolInput
									: JSON.stringify(toolInput, null, 2);

							// Only wrap the tool output in a collapsible block if it has content
							const wrappedResult = toolResult.content?.trim()
								? `+++Tool Output\n${toolResult.content}\n+++`
								: "";

							content = {
								type: "action",
								action: toolResult.isError ? `${toolName} (Error)` : toolName,
								parameter: formattedInput,
								result: wrappedResult,
							};
						} else {
							return;
						}
					} else {
						return;
					}
					break;
				}
				case "assistant": {
					// Assistant messages can be thoughts or responses
					if (entry.metadata?.toolUseId) {
						const toolName = entry.metadata.toolName || "Tool";

						// Store tool information for later use in tool results
						if (entry.metadata.toolUseId) {
							// Check if this is a subtask with arrow prefix
							let storedName = toolName;
							if (entry.metadata?.parentToolUseId) {
								const activeTaskId = this.activeTasksBySession.get(
									linearAgentActivitySessionId,
								);
								if (activeTaskId === entry.metadata?.parentToolUseId) {
									storedName = `↪ ${toolName}`;
								}
							}

							this.toolCallsByToolUseId.set(entry.metadata.toolUseId, {
								name: storedName,
								input: entry.metadata.toolInput || entry.content,
							});
						}

						// Special handling for TodoWrite tool - treat as thought instead of action
						if (toolName === "TodoWrite") {
							const formattedTodos = this.formatTodoWriteParameter(
								entry.content,
							);
							content = {
								type: "thought",
								body: formattedTodos,
							};
							// TodoWrite is not ephemeral
							ephemeral = false;
						} else if (toolName === "Task") {
							// Special handling for Task tool - add start marker and track active task
							const parameter = entry.content;
							const displayName = toolName;

							// Track this as the active Task for this session
							if (entry.metadata?.toolUseId) {
								this.activeTasksBySession.set(
									linearAgentActivitySessionId,
									entry.metadata.toolUseId,
								);
							}

							content = {
								type: "action",
								action: displayName,
								parameter: parameter,
								// result will be added later when we get tool result
							};
							// Task is not ephemeral
							ephemeral = false;
						} else {
							// Other tools - check if they're within an active Task
							const parameter = entry.content;
							let displayName = toolName;

							if (entry.metadata?.parentToolUseId) {
								const activeTaskId = this.activeTasksBySession.get(
									linearAgentActivitySessionId,
								);
								if (activeTaskId === entry.metadata?.parentToolUseId) {
									displayName = `↪ ${toolName}`;
								}
							}

							content = {
								type: "action",
								action: displayName,
								parameter: parameter,
								// result will be added later when we get tool result
							};
							// Standard tool calls are ephemeral
							ephemeral = true;
						}
					} else {
						// Regular assistant message - create a thought
						content = {
							type: "thought",
							body: entry.content,
						};
					}
					break;
				}

				case "system":
					// System messages are thoughts
					content = {
						type: "thought",
						body: entry.content,
					};
					break;

				case "result":
					// Result messages can be responses or errors
					if (entry.metadata?.isError) {
						content = {
							type: "error",
							body: entry.content,
						};
					} else {
						content = {
							type: "response",
							body: entry.content,
						};
					}
					break;

				default:
					// Default to thought
					content = {
						type: "thought",
						body: entry.content,
					};
			}

			// Check if current subroutine has suppressThoughtPosting enabled
			// If so, suppress thoughts and actions (but still post responses and results)
			const currentSubroutine =
				this.procedureRouter?.getCurrentSubroutine(session);
			if (currentSubroutine?.suppressThoughtPosting) {
				// Only suppress thoughts and actions, not responses or results
				if (content.type === "thought" || content.type === "action") {
					this.logger.debug("Suppressing activity posting", {
						sessionId: linearAgentActivitySessionId,
						contentType: content.type,
						subroutineName: currentSubroutine.name,
					});
					return; // Don't post to Linear
				}
			}

			const activityInput: LinearDocument.AgentActivityCreateInput = {
				agentSessionId: session.linearAgentActivitySessionId, // Use the Linear session ID
				content,
				...(ephemeral && { ephemeral: true }),
			};

			const result = await this.linearClient.createAgentActivity(activityInput);

			if (result.success && result.agentActivity) {
				const agentActivity = await result.agentActivity;
				entry.linearAgentActivityId = agentActivity.id;
				this.logger.debug("Created Linear activity", {
					sessionId: linearAgentActivitySessionId,
					activityId: entry.linearAgentActivityId,
					activityType: content.type,
					ephemeral,
				});
			} else {
				this.logger.error("Failed to create Linear activity", undefined, {
					sessionId: linearAgentActivitySessionId,
					activityType: content.type,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Failed to sync entry to Linear", error, {
				sessionId: linearAgentActivitySessionId,
				entryType: entry.type,
			});
		}
	}

	/**
	 * Get session by ID
	 */
	getSession(
		linearAgentActivitySessionId: string,
	): CyrusAgentSession | undefined {
		return this.sessions.get(linearAgentActivitySessionId);
	}

	/**
	 * Get session entries by session ID
	 */
	getSessionEntries(
		linearAgentActivitySessionId: string,
	): CyrusAgentSessionEntry[] {
		return this.entries.get(linearAgentActivitySessionId) || [];
	}

	/**
	 * Get all active sessions
	 */
	getActiveSessions(): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) => session.status === LinearDocument.AgentSessionStatus.Active,
		);
	}

	/**
	 * Add or update ClaudeRunner for a session
	 */
	addClaudeRunner(
		linearAgentActivitySessionId: string,
		claudeRunner: ClaudeRunner,
	): void {
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (!session) {
			this.logger.warn("No session found for ClaudeRunner", {
				sessionId: linearAgentActivitySessionId,
				operation: "addClaudeRunner",
			});
			return;
		}

		session.claudeRunner = claudeRunner;
		session.updatedAt = Date.now();
		this.logger.debug("Added ClaudeRunner to session", {
			sessionId: linearAgentActivitySessionId,
		});
	}

	/**
	 *  Get all ClaudeRunners
	 */
	getAllClaudeRunners(): ClaudeRunner[] {
		return Array.from(this.sessions.values())
			.map((session) => session.claudeRunner)
			.filter((runner): runner is ClaudeRunner => runner !== undefined);
	}

	/**
	 * Get all ClaudeRunners for a specific issue
	 */
	getClaudeRunnersForIssue(issueId: string): ClaudeRunner[] {
		return Array.from(this.sessions.values())
			.filter((session) => session.issueId === issueId)
			.map((session) => session.claudeRunner)
			.filter((runner): runner is ClaudeRunner => runner !== undefined);
	}

	/**
	 * Get sessions by issue ID
	 */
	getSessionsByIssueId(issueId: string): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) => session.issueId === issueId,
		);
	}

	/**
	 * Get active sessions by issue ID
	 */
	getActiveSessionsByIssueId(issueId: string): CyrusAgentSession[] {
		return Array.from(this.sessions.values()).filter(
			(session) =>
				session.issueId === issueId &&
				session.status === LinearDocument.AgentSessionStatus.Active,
		);
	}

	/**
	 * Get all sessions
	 */
	getAllSessions(): CyrusAgentSession[] {
		return Array.from(this.sessions.values());
	}

	/**
	 * Get ClaudeRunner for a specific session
	 */
	getClaudeRunner(
		linearAgentActivitySessionId: string,
	): ClaudeRunner | undefined {
		const session = this.sessions.get(linearAgentActivitySessionId);
		return session?.claudeRunner;
	}

	/**
	 * Check if a ClaudeRunner exists for a session
	 */
	hasClaudeRunner(linearAgentActivitySessionId: string): boolean {
		const session = this.sessions.get(linearAgentActivitySessionId);
		return session?.claudeRunner !== undefined;
	}

	/**
	 * Create a thought activity
	 */
	async createThoughtActivity(sessionId: string, body: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			this.logger.warn("No Linear session ID for thought activity", {
				sessionId,
				operation: "createThoughtActivity",
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "thought",
					body,
				},
			});

			if (result.success) {
				this.logger.debug("Created thought activity", {
					sessionId,
				});
			} else {
				this.logger.error("Failed to create thought activity", undefined, {
					sessionId,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error creating thought activity", error, {
				sessionId,
			});
		}
	}

	/**
	 * Create an action activity
	 */
	async createActionActivity(
		sessionId: string,
		action: string,
		parameter: string,
		result?: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			this.logger.warn("No Linear session ID for action activity", {
				sessionId,
				operation: "createActionActivity",
			});
			return;
		}

		try {
			const content: any = {
				type: "action",
				action,
				parameter,
			};

			if (result !== undefined) {
				content.result = result;
			}

			const response = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content,
			});

			if (response.success) {
				this.logger.debug("Created action activity", {
					sessionId,
					action,
					hasResult: result !== undefined,
				});
			} else {
				this.logger.error("Failed to create action activity", undefined, {
					sessionId,
					action,
					response,
				});
			}
		} catch (error) {
			this.logger.error("Error creating action activity", error, {
				sessionId,
				action,
			});
		}
	}

	/**
	 * Create a response activity
	 */
	async createResponseActivity(sessionId: string, body: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			this.logger.warn("No Linear session ID for response activity", {
				sessionId,
				operation: "createResponseActivity",
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "response",
					body,
				},
			});

			if (result.success) {
				this.logger.debug("Created response activity", {
					sessionId,
				});
			} else {
				this.logger.error("Failed to create response activity", undefined, {
					sessionId,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error creating response activity", error, {
				sessionId,
			});
		}
	}

	/**
	 * Create an error activity
	 */
	async createErrorActivity(sessionId: string, body: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			this.logger.warn("No Linear session ID for error activity", {
				sessionId,
				operation: "createErrorActivity",
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "error",
					body,
				},
			});

			if (result.success) {
				this.logger.debug("Created error activity", {
					sessionId,
				});
			} else {
				this.logger.error("Failed to create error activity", undefined, {
					sessionId,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error creating error activity", error, {
				sessionId,
			});
		}
	}

	/**
	 * Create an elicitation activity
	 */
	async createElicitationActivity(
		sessionId: string,
		body: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			this.logger.warn("No Linear session ID for elicitation activity", {
				sessionId,
				operation: "createElicitationActivity",
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "elicitation",
					body,
				},
			});

			if (result.success) {
				this.logger.debug("Created elicitation activity", {
					sessionId,
				});
			} else {
				this.logger.error("Failed to create elicitation activity", undefined, {
					sessionId,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error creating elicitation activity", error, {
				sessionId,
			});
		}
	}

	/**
	 * Create an approval elicitation activity with auth signal
	 */
	async createApprovalElicitation(
		sessionId: string,
		body: string,
		approvalUrl: string,
	): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || !session.linearAgentActivitySessionId) {
			this.logger.warn("No Linear session ID for approval elicitation", {
				sessionId,
				operation: "createApprovalElicitation",
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: session.linearAgentActivitySessionId,
				content: {
					type: "elicitation",
					body,
				},
				signal: LinearDocument.AgentActivitySignal.Auth,
				signalMetadata: {
					url: approvalUrl,
				},
			});

			if (result.success) {
				this.logger.info("Created approval elicitation", {
					sessionId,
					approvalUrl,
				});
			} else {
				this.logger.error("Failed to create approval elicitation", undefined, {
					sessionId,
					approvalUrl,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error creating approval elicitation", error, {
				sessionId,
				approvalUrl,
			});
		}
	}

	/**
	 * Clear completed sessions older than specified time
	 */
	cleanup(olderThanMs: number = 24 * 60 * 60 * 1000): void {
		const cutoff = Date.now() - olderThanMs;
		let cleanedCount = 0;

		for (const [sessionId, session] of this.sessions.entries()) {
			if (
				(session.status === "complete" || session.status === "error") &&
				session.updatedAt < cutoff
			) {
				this.sessions.delete(sessionId);
				this.entries.delete(sessionId);
				cleanedCount++;
			}
		}

		if (cleanedCount > 0) {
			this.logger.info("Session cleanup completed", {
				cleanedCount,
				olderThanMs,
				cutoffTimestamp: cutoff,
			});
		}
	}

	/**
	 * Serialize Agent Session state for persistence
	 */
	serializeState(): {
		sessions: Record<string, SerializedCyrusAgentSession>;
		entries: Record<string, SerializedCyrusAgentSessionEntry[]>;
	} {
		const sessions: Record<string, SerializedCyrusAgentSession> = {};
		const entries: Record<string, SerializedCyrusAgentSessionEntry[]> = {};

		// Serialize sessions
		for (const [sessionId, session] of this.sessions.entries()) {
			// Exclude claudeRunner from serialization as it's not serializable
			const { claudeRunner: _claudeRunner, ...serializableSession } = session;
			sessions[sessionId] = serializableSession;
		}

		// Serialize entries
		for (const [sessionId, sessionEntries] of this.entries.entries()) {
			entries[sessionId] = sessionEntries.map((entry) => ({
				...entry,
			}));
		}

		return { sessions, entries };
	}

	/**
	 * Restore Agent Session state from serialized data
	 */
	restoreState(
		serializedSessions: Record<string, SerializedCyrusAgentSession>,
		serializedEntries: Record<string, SerializedCyrusAgentSessionEntry[]>,
	): void {
		// Clear existing state
		this.sessions.clear();
		this.entries.clear();

		// Restore sessions
		for (const [sessionId, sessionData] of Object.entries(serializedSessions)) {
			const session: CyrusAgentSession = {
				...sessionData,
			};
			this.sessions.set(sessionId, session);
		}

		// Restore entries
		for (const [sessionId, entriesData] of Object.entries(serializedEntries)) {
			const sessionEntries: CyrusAgentSessionEntry[] = entriesData.map(
				(entryData) => ({
					...entryData,
				}),
			);
			this.entries.set(sessionId, sessionEntries);
		}

		this.logger.info("Restored session state", {
			sessionCount: this.sessions.size,
			entryCollectionCount: Object.keys(serializedEntries).length,
		});
	}

	/**
	 * Post a thought about the model being used
	 */
	private async postModelNotificationThought(
		linearAgentActivitySessionId: string,
		model: string,
	): Promise<void> {
		// Skip Linear sync for local-only sessions
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (session?.metadata?.shouldSyncToLinear === false) {
			this.logger.debug("Skipping model notification for local-only session", {
				sessionId: linearAgentActivitySessionId,
				model,
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Using model: ${model}`,
				},
			});

			if (result.success) {
				this.logger.debug("Posted model notification", {
					sessionId: linearAgentActivitySessionId,
					model,
				});
			} else {
				this.logger.error("Failed to post model notification", undefined, {
					sessionId: linearAgentActivitySessionId,
					model,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error posting model notification", error, {
				sessionId: linearAgentActivitySessionId,
				model,
			});
		}
	}

	/**
	 * Post an ephemeral "Routing your request..." thought and return the activity ID
	 */
	async postRoutingThought(
		linearAgentActivitySessionId: string,
	): Promise<string | null> {
		// Skip Linear sync for local-only sessions
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (session?.metadata?.shouldSyncToLinear === false) {
			this.logger.debug("Skipping routing thought for local-only session", {
				sessionId: linearAgentActivitySessionId,
			});
			return null;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: "Routing your request…",
				},
				ephemeral: true,
			});

			if (result.success && result.agentActivity) {
				const activity = await result.agentActivity;
				this.logger.debug("Posted routing thought", {
					sessionId: linearAgentActivitySessionId,
					activityId: activity.id,
				});
				return activity.id;
			} else {
				this.logger.error("Failed to post routing thought", undefined, {
					sessionId: linearAgentActivitySessionId,
					result,
				});
				return null;
			}
		} catch (error) {
			this.logger.error("Error posting routing thought", error, {
				sessionId: linearAgentActivitySessionId,
			});
			return null;
		}
	}

	/**
	 * Post the procedure selection result as a non-ephemeral thought
	 */
	async postProcedureSelectionThought(
		linearAgentActivitySessionId: string,
		procedureName: string,
		classification: string,
	): Promise<void> {
		// Skip Linear sync for local-only sessions
		const session = this.sessions.get(linearAgentActivitySessionId);
		if (session?.metadata?.shouldSyncToLinear === false) {
			this.logger.debug("Skipping procedure selection for local-only session", {
				sessionId: linearAgentActivitySessionId,
				procedureName,
				classification,
			});
			return;
		}

		try {
			const result = await this.linearClient.createAgentActivity({
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Selected procedure: **${procedureName}** (classified as: ${classification})`,
				},
				ephemeral: false,
			});

			if (result.success) {
				this.logger.info("Posted procedure selection", {
					sessionId: linearAgentActivitySessionId,
					procedureName,
					classification,
				});
			} else {
				this.logger.error("Failed to post procedure selection", undefined, {
					sessionId: linearAgentActivitySessionId,
					procedureName,
					classification,
					result,
				});
			}
		} catch (error) {
			this.logger.error("Error posting procedure selection", error, {
				sessionId: linearAgentActivitySessionId,
				procedureName,
				classification,
			});
		}
	}
}
