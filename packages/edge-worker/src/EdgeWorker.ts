import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type Comment,
	LinearClient,
	type Issue as LinearIssue,
} from "@linear/sdk";
import { watch as chokidarWatch, type FSWatcher } from "chokidar";
import type {
	ClaudeRunnerConfig,
	HookCallbackMatcher,
	HookEvent,
	McpServerConfig,
	PostToolUseHookInput,
	SDKMessage,
} from "cyrus-claude-runner";
import {
	ClaudeRunner,
	createCyrusToolsServer,
	createImageToolsServer,
	createSoraToolsServer,
	getAllTools,
	getCoordinatorTools,
	getReadOnlyTools,
	getSafeTools,
} from "cyrus-claude-runner";
import type {
	CyrusAgentSession,
	CyrusAgentSessionEntry,
	EdgeWorkerConfig,
	IssueMinimal,
	LinearAgentSessionCreatedWebhook,
	LinearAgentSessionPromptedWebhook,
	LinearIssueAssignedWebhook,
	LinearIssueCommentMentionWebhook,
	LinearIssueNewCommentWebhook,
	LinearIssueUnassignedWebhook,
	LinearWebhook,
	LinearWebhookAgentSession,
	LinearWebhookComment,
	LinearWebhookGuidanceRule,
	LinearWebhookIssue,
	RepositoryConfig,
	SerializableEdgeWorkerState,
	SerializedCyrusAgentSession,
	SerializedCyrusAgentSessionEntry,
} from "cyrus-core";
import {
	isAgentSessionCreatedWebhook,
	isAgentSessionPromptedWebhook,
	isDataChangeWebhook,
	isIssueAssignedWebhook,
	isIssueCommentMentionWebhook,
	isIssueNewCommentWebhook,
	isIssueUnassignedWebhook,
	PersistenceManager,
} from "cyrus-core";
import { LinearWebhookClient } from "cyrus-linear-webhook-client";
import { NdjsonClient } from "cyrus-ndjson-client";
import { fileTypeFromBuffer } from "file-type";
import { AgentSessionManager } from "./AgentSessionManager.js";
import { Config } from "./config/Config.js";
import {
	type ProcedureDefinition,
	ProcedureRouter,
	type RequestClassification,
} from "./procedures/index.js";
import { SharedApplicationServer } from "./SharedApplicationServer.js";
import { LinearApiClient } from "./services/LinearApiClient.js";
import type { EdgeWorkerEvents, LinearAgentSessionData } from "./types.js";
import { LINEAR_API, PROCEDURE_ROUTING, TIME } from "./utils/constants.js";
import { debounceAsync } from "./utils/debounce.js";
import { LinearCache } from "./utils/LinearCache.js";
import { Logger } from "./utils/Logger.js";
import { ResponseVerifier } from "./utils/ResponseVerifier.js";
import { RateLimiter, retryWithBackoff } from "./utils/retry.js";
import { SessionCleanupManager } from "./utils/SessionCleanupManager.js";
import { TimeoutManager } from "./utils/TimeoutManager.js";
import { UnrespondedMessageTracker } from "./utils/UnrespondedMessageTracker.js";
import { WebhookDeduplicator } from "./utils/WebhookDeduplicator.js";

// TypedWebhook available for future type safety improvements
// import type { TypedWebhook } from "./types/webhooks.js";

// Create logger instance for EdgeWorker
const logger = new Logger({ name: "EdgeWorker" });

export declare interface EdgeWorker {
	on<K extends keyof EdgeWorkerEvents>(
		event: K,
		listener: EdgeWorkerEvents[K],
	): this;
	emit<K extends keyof EdgeWorkerEvents>(
		event: K,
		...args: Parameters<EdgeWorkerEvents[K]>
	): boolean;
}

/**
 * Unified edge worker that **orchestrates**
 *   capturing Linear webhooks,
 *   managing Claude Code processes, and
 *   processes results through to Linear Agent Activity Sessions
 */
export class EdgeWorker extends EventEmitter {
	private config: EdgeWorkerConfig;
	private repositories: Map<string, RepositoryConfig> = new Map(); // repository 'id' (internal, stored in config.json) mapped to the full repo config
	private agentSessionManagers: Map<string, AgentSessionManager> = new Map(); // Maps repository ID to AgentSessionManager, which manages ClaudeRunners for a repo
	private linearClients: Map<string, LinearClient> = new Map(); // one linear client per 'repository'
	private linearApiClients: Map<string, LinearApiClient> = new Map(); // API clients with retry logic (one per repository)
	private ndjsonClients: Map<string, NdjsonClient | LinearWebhookClient> =
		new Map(); // listeners for webhook events, one per linear token
	private persistenceManager: PersistenceManager;
	private sharedApplicationServer: SharedApplicationServer;
	private cyrusHome: string;
	// Session tracking moved to SessionCleanupManager (TTL-based cleanup prevents memory leaks)
	private procedureRouter: ProcedureRouter; // Intelligent workflow routing
	private configWatcher?: FSWatcher; // File watcher for config.json
	private configPath?: string; // Path to config.json file
	private tokenToRepoIds: Map<string, string[]> = new Map(); // Maps Linear token to repository IDs using that token
	private botUserIds: Set<string> = new Set(); // Track known bot user IDs

	// New: Centralized utilities
	private validatedConfig: Config; // Validated configuration
	private timeouts: TimeoutManager; // Centralized timeout management
	private linearRateLimiter: RateLimiter; // Rate limiter for Linear API calls (10 requests/second)
	private sessionCleanup: SessionCleanupManager; // TTL-based session cleanup (prevents memory leaks)
	private linearCache: LinearCache; // API response cache (50-70% reduction in API calls)
	private webhookDeduplicator: WebhookDeduplicator; // Duplicate webhook detection (10-20% skip rate)
	private unrespondedTracker: UnrespondedMessageTracker; // Tracks messages waiting for thread replies

	constructor(config: EdgeWorkerConfig) {
		super();
		this.config = config;

		// Validate config with Zod
		this.validatedConfig = Config.fromConfig(config);

		// Initialize utilities
		this.timeouts = new TimeoutManager();
		this.sessionCleanup = new SessionCleanupManager();
		this.linearCache = new LinearCache(TIME.FIVE_MINUTES); // 5 min TTL for cached responses
		this.webhookDeduplicator = new WebhookDeduplicator(TIME.FIVE_MINUTES * 2); // 10 min dedup window
		this.unrespondedTracker = new UnrespondedMessageTracker(
			TIME.FIVE_MINUTES * 6,
		); // Alert after 30 min
		this.linearRateLimiter = new RateLimiter(
			LINEAR_API.RATE_LIMIT_REQUESTS_PER_SECOND,
		);
		this.cyrusHome = config.cyrusHome;
		this.persistenceManager = new PersistenceManager(
			join(this.cyrusHome, "state"),
		);

		// Initialize procedure router with haiku model for fast classification
		this.procedureRouter = new ProcedureRouter({
			cyrusHome: this.cyrusHome,
			model: "haiku",
			timeoutMs: PROCEDURE_ROUTING.CLASSIFICATION_TIMEOUT_MS,
		});

		logger.info("Initializing parent-child session mapping system");
		logger.info("Parent-child mapping initialized with 0 entries");

		// Initialize shared application server
		const serverPort = config.serverPort || config.webhookPort || 3456;
		const serverHost = config.serverHost || "localhost";
		this.sharedApplicationServer = new SharedApplicationServer(
			serverPort,
			serverHost,
			config.ngrokAuthToken,
			config.proxyUrl,
		);

		// Register OAuth callback handler if provided
		if (config.handlers?.onOAuthCallback) {
			this.sharedApplicationServer.registerOAuthCallbackHandler(
				config.handlers.onOAuthCallback,
			);
		}

		// Initialize repositories
		for (const repo of config.repositories) {
			if (repo.isActive !== false) {
				this.repositories.set(repo.id, repo);

				// Create Linear client for this repository's workspace
				const linearClient = new LinearClient({
					accessToken: repo.linearToken,
				});
				this.linearClients.set(repo.id, linearClient);

				// Create LinearApiClient with retry logic, rate limiting, and caching
				const linearApiClient = new LinearApiClient({
					linearClient,
					rateLimiter: this.linearRateLimiter,
					repositoryId: repo.id,
					repositoryName: repo.name,
					cache: this.linearCache, // Share cache across all repositories
				});
				this.linearApiClients.set(repo.id, linearApiClient);

				// Create AgentSessionManager for this repository with parent session lookup and resume callback
				//
				// Note: This pattern works (despite appearing recursive) because:
				// 1. The agentSessionManager variable is captured by the closure after it's assigned
				// 2. JavaScript's variable hoisting means 'agentSessionManager' exists (but is undefined) when the arrow function is created
				// 3. By the time the callback is actually invoked (when a child session completes), agentSessionManager is fully initialized
				// 4. The callback only executes asynchronously, well after the constructor has completed and agentSessionManager is assigned
				//
				// This allows the AgentSessionManager to call back into itself to access its own sessions,
				// enabling child sessions to trigger parent session resumption using the same manager instance.
				const agentSessionManager = new AgentSessionManager(
					linearClient,
					(childSessionId: string) => {
						logger.debug("Looking up parent session for child", {
							repository: repo.name,
							childSessionId,
						});
						const parentId =
							this.sessionCleanup.getParentSession(childSessionId);
						logger.debug("Parent session lookup result", {
							repository: repo.name,
							childSessionId,
							parentId: parentId || null,
							found: !!parentId,
						});
						return parentId;
					},
					async (parentSessionId, prompt, childSessionId) => {
						await this.handleResumeParentSession(
							parentSessionId,
							prompt,
							childSessionId,
							repo,
							agentSessionManager,
						);
					},
					async (linearAgentActivitySessionId: string) => {
						logger.info("Advancing to next subroutine", {
							repository: repo.name,
							sessionId: linearAgentActivitySessionId,
						});

						// Get the session
						const session = agentSessionManager.getSession(
							linearAgentActivitySessionId,
						);
						if (!session) {
							logger.error("Session not found for subroutine transition", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
							});
							return;
						}

						// Get next subroutine (advancement already handled by AgentSessionManager)
						const nextSubroutine =
							this.procedureRouter.getCurrentSubroutine(session);

						if (!nextSubroutine) {
							logger.info("Procedure complete", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
							});
							return;
						}

						logger.info("Next subroutine determined", {
							repository: repo.name,
							sessionId: linearAgentActivitySessionId,
							subroutineName: nextSubroutine.name,
						});

						// Load subroutine prompt
						const __filename = fileURLToPath(import.meta.url);
						const __dirname = dirname(__filename);
						const subroutinePromptPath = join(
							__dirname,
							"prompts",
							nextSubroutine.promptPath,
						);

						let subroutinePrompt: string;
						try {
							subroutinePrompt = await readFile(subroutinePromptPath, "utf-8");
							logger.debug("Loaded subroutine prompt", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
								subroutineName: nextSubroutine.name,
								promptLength: subroutinePrompt.length,
							});
						} catch (error) {
							logger.error("Failed to load subroutine prompt", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
								subroutineName: nextSubroutine.name,
								promptPath: subroutinePromptPath,
								error,
							});
							// Fallback to simple prompt
							subroutinePrompt = `Continue with: ${nextSubroutine.description}`;
						}

						// Add response template context if available (for concise-summary subroutine)
						if (session.metadata?.responseTemplate) {
							subroutinePrompt += `\n\n<response-template>${session.metadata.responseTemplate}</response-template>`;
							logger.debug("Added response template context", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
								responseTemplate: session.metadata.responseTemplate,
							});
						}

						// Resume Claude session with subroutine prompt
						try {
							await this.resumeClaudeSession(
								session,
								repo,
								linearAgentActivitySessionId,
								agentSessionManager,
								subroutinePrompt,
								"", // No attachment manifest
								false, // Not a new session
								[], // No additional allowed directories
								nextSubroutine.maxTurns, // Use subroutine-specific maxTurns
							);
							logger.info("Successfully resumed session for subroutine", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
								subroutineName: nextSubroutine.name,
								maxTurns: nextSubroutine.maxTurns,
							});
						} catch (error) {
							logger.error("Failed to resume session for subroutine", {
								repository: repo.name,
								sessionId: linearAgentActivitySessionId,
								subroutineName: nextSubroutine.name,
								error,
							});
						}
					},
					this.procedureRouter,
					this.sharedApplicationServer,
				);
				this.agentSessionManagers.set(repo.id, agentSessionManager);
			}
		}

		// Group repositories by token to minimize NDJSON connections
		const tokenToRepos = new Map<string, RepositoryConfig[]>();
		for (const repo of this.repositories.values()) {
			const repos = tokenToRepos.get(repo.linearToken) || [];
			repos.push(repo);
			tokenToRepos.set(repo.linearToken, repos);

			// Track token-to-repo-id mapping for dynamic config updates
			const repoIds = this.tokenToRepoIds.get(repo.linearToken) || [];
			if (!repoIds.includes(repo.id)) {
				repoIds.push(repo.id);
			}
			this.tokenToRepoIds.set(repo.linearToken, repoIds);
		}

		// Create one NDJSON client per unique token using shared application server
		for (const [token, repos] of tokenToRepos) {
			if (!repos || repos.length === 0) continue;
			const firstRepo = repos[0];
			if (!firstRepo) continue;
			const primaryRepoId = firstRepo.id;

			// Determine which client to use based on environment variable
			const useLinearDirectWebhooks =
				this.validatedConfig.useLinearDirectWebhooks;

			const clientConfig = {
				proxyUrl: config.proxyUrl,
				token: token,
				name: repos.map((r) => r.name).join(", "), // Pass repository names
				transport: "webhook" as const,
				// Use shared application server instead of individual servers
				useExternalWebhookServer: true,
				externalWebhookServer: this.sharedApplicationServer,
				webhookPort: serverPort, // All clients use same port
				webhookPath: "/webhook",
				webhookHost: serverHost,
				...(config.baseUrl && { webhookBaseUrl: config.baseUrl }),
				// Legacy fallback support
				...(!config.baseUrl &&
					config.webhookBaseUrl && { webhookBaseUrl: config.webhookBaseUrl }),
				onConnect: () => this.handleConnect(primaryRepoId, repos),
				onDisconnect: (reason?: string) =>
					this.handleDisconnect(primaryRepoId, repos, reason),
				onError: (error: Error) => this.handleError(error),
			};

			// Create the appropriate client based on configuration
			const ndjsonClient = useLinearDirectWebhooks
				? new LinearWebhookClient({
						...clientConfig,
						onWebhook: (payload: any) => {
							// Get fresh repositories for this token to avoid stale closures
							const freshRepos = this.getRepositoriesForToken(token);
							this.handleWebhook(
								payload as unknown as LinearWebhook,
								freshRepos,
							);
						},
					})
				: new NdjsonClient(clientConfig);

			// Set up webhook handler for NdjsonClient (LinearWebhookClient uses onWebhook in constructor)
			if (!useLinearDirectWebhooks) {
				(ndjsonClient as NdjsonClient).on("webhook", (data) => {
					// Get fresh repositories for this token to avoid stale closures
					const freshRepos = this.getRepositoriesForToken(token);
					this.handleWebhook(data as LinearWebhook, freshRepos);
				});
			}

			// Optional heartbeat logging (only for NdjsonClient)
			if (this.validatedConfig.isDebugMode && !useLinearDirectWebhooks) {
				(ndjsonClient as NdjsonClient).on("heartbeat", () => {
					logger.debug("Heartbeat received", {
						tokenSuffix: token.slice(-4),
					});
				});
			}

			// Store with the first repo's ID as the key (for error messages)
			// But also store the token mapping for lookup
			this.ndjsonClients.set(primaryRepoId, ndjsonClient);
		}
	}

	/**
	 * Register process signal handlers for graceful shutdown
	 * Call this after constructing EdgeWorker to enable SIGTERM/SIGINT handling
	 */
	registerSignalHandlers(): void {
		let isShuttingDown = false;

		const handleShutdown = async (signal: string) => {
			if (isShuttingDown) {
				logger.info("Already shutting down, ignoring signal", { signal });
				return;
			}

			isShuttingDown = true;
			logger.info("Received signal, initiating shutdown", { signal });

			try {
				// Give ourselves 30 seconds to shut down gracefully
				const shutdownTimeout = setTimeout(() => {
					logger.error("Graceful shutdown timeout, forcing exit", {
						timeoutMs: TIME.GRACEFUL_SHUTDOWN_TIMEOUT,
					});
					process.exit(1);
				}, TIME.GRACEFUL_SHUTDOWN_TIMEOUT);

				// Perform graceful shutdown
				await this.stop();

				// Clear timeout and exit successfully
				clearTimeout(shutdownTimeout);
				logger.info("Clean shutdown complete");
				process.exit(0);
			} catch (error) {
				logger.error("Error during shutdown", error);
				process.exit(1);
			}
		};

		// Register handlers
		process.on("SIGTERM", () => handleShutdown("SIGTERM"));
		process.on("SIGINT", () => handleShutdown("SIGINT"));

		logger.info("Process signal handlers registered", {
			signals: ["SIGTERM", "SIGINT"],
		});
	}

	/**
	 * Start the edge worker
	 */
	async start(): Promise<void> {
		// Load persisted state for each repository
		await this.loadPersistedState();

		// Start config file watcher if configPath is provided
		if (this.configPath) {
			this.startConfigWatcher();
		}

		// Start shared application server first
		await this.sharedApplicationServer.start();

		// Connect all NDJSON clients
		const connections = Array.from(this.ndjsonClients.entries()).map(
			async ([repoId, client]) => {
				try {
					await client.connect();
				} catch (error: any) {
					const repoConfig = this.config.repositories.find(
						(r) => r.id === repoId,
					);
					const repoName = repoConfig?.name || repoId;

					// Check if it's an authentication error
					if (error.isAuthError || error.code === "LINEAR_AUTH_FAILED") {
						logger.error("Linear authentication failed for repository", {
							repository: repoName,
							workspace:
								repoConfig?.linearWorkspaceName ||
								repoConfig?.linearWorkspaceId ||
								"Unknown",
							error: error.message,
							fix: "Run 'cyrus refresh-token' and complete OAuth flow, or check with 'cyrus check-tokens'",
						});

						// Continue with other repositories instead of failing completely
						return { repoId, success: false, error };
					}

					// For other errors, still log but with less guidance
					logger.error("Failed to connect repository", {
						repository: repoName,
						error: error.message,
					});
					return { repoId, success: false, error };
				}
				return { repoId, success: true };
			},
		);

		const results = await Promise.all(connections);
		const failures = results.filter((r) => !r.success);

		if (failures.length === this.ndjsonClients.size) {
			// All connections failed
			throw new Error(
				"Failed to connect any repositories. Please check your configuration and Linear tokens.",
			);
		} else if (failures.length > 0) {
			// Some connections failed
			logger.warn("Partial repository connection", {
				connected: results.length - failures.length,
				total: results.length,
				failed: failures.map((f) => {
					const repoConfig = this.config.repositories.find(
						(r) => r.id === f.repoId,
					);
					return repoConfig?.name || f.repoId;
				}),
			});
		}
	}

	/**
	 * Stop the edge worker
	 */
	async stop(): Promise<void> {
		logger.info("Initiating graceful shutdown");

		// Stop config file watcher
		if (this.configWatcher) {
			await this.configWatcher.close();
			this.configWatcher = undefined;
			logger.info("Config file watcher stopped");
		}

		// Stop accepting new work and clean up timeouts
		this.timeouts.shutdown();
		logger.info("Timeout manager shutdown complete");

		// Cleanup session tracking data
		this.sessionCleanup.shutdown();
		logger.info("Session cleanup manager shutdown complete");

		// Stop cache and deduplicator cleanup intervals
		this.linearCache.stop();
		logger.info("Linear cache stopped");
		this.webhookDeduplicator.stop();
		logger.info("Webhook deduplicator stopped");
		this.unrespondedTracker.stop();
		logger.info("Unresponded message tracker stopped");

		try {
			await this.savePersistedState();
			logger.info("EdgeWorker state saved successfully");
		} catch (error) {
			logger.error("Failed to save EdgeWorker state during shutdown", {
				error,
			});
		}

		// get all claudeRunners
		const claudeRunners: ClaudeRunner[] = [];
		for (const agentSessionManager of this.agentSessionManagers.values()) {
			claudeRunners.push(...agentSessionManager.getAllClaudeRunners());
		}

		// Kill all Claude processes with null checking
		for (const runner of claudeRunners) {
			if (runner) {
				try {
					runner.stop();
				} catch (error) {
					logger.error("Error stopping Claude runner", { error });
				}
			}
		}

		// Disconnect all NDJSON clients with error handling
		for (const client of this.ndjsonClients.values()) {
			try {
				client.disconnect();
			} catch (error) {
				logger.error("Error disconnecting NDJSON client", { error });
			}
		}

		// Stop shared application server
		await this.sharedApplicationServer.stop();

		logger.info("Graceful shutdown complete");
	}

	/**
	 * Set the config file path for dynamic reloading
	 */
	setConfigPath(configPath: string): void {
		this.configPath = configPath;
	}

	/**
	 * Get fresh list of repositories for a given Linear token
	 * This ensures webhook handlers always work with current repository state
	 */
	private getRepositoriesForToken(token: string): RepositoryConfig[] {
		const repoIds = this.tokenToRepoIds.get(token) || [];
		const repos: RepositoryConfig[] = [];
		for (const repoId of repoIds) {
			const repo = this.repositories.get(repoId);
			if (repo) {
				repos.push(repo);
			}
		}
		return repos;
	}

	/**
	 * Handle resuming a parent session when a child session completes
	 * This is the core logic used by the resume parent session callback
	 * Extracted to reduce duplication between constructor and addNewRepositories
	 */
	private async handleResumeParentSession(
		parentSessionId: string,
		prompt: string,
		childSessionId: string,
		repo: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
	): Promise<void> {
		logger.info("Child session completed, resuming parent session", {
			repository: repo.name,
			parentSessionId,
			childSessionId,
		});

		// Get the parent session and repository
		logger.debug("Retrieving parent session", {
			repository: repo.name,
			parentSessionId,
		});
		const parentSession = agentSessionManager.getSession(parentSessionId);
		if (!parentSession) {
			logger.error("Parent session not found", {
				repository: repo.name,
				parentSessionId,
			});
			return;
		}

		logger.debug("Found parent session", {
			repository: repo.name,
			parentSessionId,
			issueId: parentSession.issueId,
			workspacePath: parentSession.workspace.path,
		});

		// Get the child session to access its workspace path
		const childSession = agentSessionManager.getSession(childSessionId);
		const childWorkspaceDirs: string[] = [];
		if (childSession) {
			childWorkspaceDirs.push(childSession.workspace.path);
			logger.debug("Adding child workspace to parent allowed directories", {
				repository: repo.name,
				parentSessionId,
				childSessionId,
				childWorkspace: childSession.workspace.path,
			});
		} else {
			logger.warn("Could not find child session for workspace mapping", {
				repository: repo.name,
				parentSessionId,
				childSessionId,
			});
		}

		await this.postParentResumeAcknowledgment(parentSessionId, repo.id);

		// Resume the parent session with the child's result
		logger.info("Resuming parent Claude session with child results", {
			repository: repo.name,
			parentSessionId,
			childSessionId,
		});
		try {
			await this.resumeClaudeSession(
				parentSession,
				repo,
				parentSessionId,
				agentSessionManager,
				prompt,
				"", // No attachment manifest for child results
				false, // Not a new session
				childWorkspaceDirs, // Add child workspace directories to parent's allowed directories
			);
			logger.info("Successfully resumed parent session with child results", {
				repository: repo.name,
				parentSessionId,
				childSessionId,
			});
		} catch (error) {
			logger.error("Failed to resume parent session", {
				repository: repo.name,
				parentSessionId,
				childSessionId,
				issueId: parentSession.issueId,
				error,
			});
		}
	}

	/**
	 * Start watching config file for changes
	 */
	private startConfigWatcher(): void {
		if (!this.configPath) {
			logger.warn("No config path set, skipping config file watcher");
			return;
		}

		logger.info("Watching config file for changes", {
			configPath: this.configPath,
		});

		this.configWatcher = chokidarWatch(this.configPath, {
			persistent: true,
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: 500,
				pollInterval: 100,
			},
		});

		// Debounce config changes to prevent rapid-fire reloads
		const debouncedHandleConfigChange = debounceAsync(
			this.handleConfigChange.bind(this),
			TIME.DEBOUNCE_DELAY,
		);

		this.configWatcher.on("change", async () => {
			logger.info("Config file changed, reloading", {
				configPath: this.configPath,
			});
			await debouncedHandleConfigChange();
		});

		this.configWatcher.on("error", (error: unknown) => {
			logger.error("Config watcher error", { error });
		});
	}

	/**
	 * Handle configuration file changes
	 */
	private async handleConfigChange(): Promise<void> {
		try {
			const newConfig = await this.loadConfigSafely();
			if (!newConfig) {
				return;
			}

			const changes = this.detectRepositoryChanges(newConfig);

			if (
				changes.added.length === 0 &&
				changes.modified.length === 0 &&
				changes.removed.length === 0
			) {
				logger.info("No repository changes detected");
				return;
			}

			logger.info("Repository changes detected", {
				added: changes.added.length,
				modified: changes.modified.length,
				removed: changes.removed.length,
			});

			// Apply changes incrementally
			await this.removeDeletedRepositories(changes.removed);
			await this.updateModifiedRepositories(changes.modified);
			await this.addNewRepositories(changes.added);

			// Update config reference
			this.config = newConfig;

			logger.info("Configuration reloaded successfully");
		} catch (error) {
			logger.error("Failed to reload configuration", { error });
		}
	}

	/**
	 * Safely load configuration from file with validation
	 */
	private async loadConfigSafely(): Promise<EdgeWorkerConfig | null> {
		try {
			if (!this.configPath) {
				logger.error("No config path set");
				return null;
			}

			const configContent = await readFile(this.configPath, "utf-8");
			const parsedConfig = JSON.parse(configContent);

			// Merge with current EdgeWorker config structure
			const newConfig: EdgeWorkerConfig = {
				...this.config,
				repositories: parsedConfig.repositories || [],
				ngrokAuthToken:
					parsedConfig.ngrokAuthToken || this.config.ngrokAuthToken,
				defaultModel: parsedConfig.defaultModel || this.config.defaultModel,
				defaultFallbackModel:
					parsedConfig.defaultFallbackModel || this.config.defaultFallbackModel,
				defaultAllowedTools:
					parsedConfig.defaultAllowedTools || this.config.defaultAllowedTools,
				defaultDisallowedTools:
					parsedConfig.defaultDisallowedTools ||
					this.config.defaultDisallowedTools,
			};

			// Basic validation
			if (!Array.isArray(newConfig.repositories)) {
				logger.error("Invalid config: repositories must be an array");
				return null;
			}

			// Validate each repository has required fields
			for (const repo of newConfig.repositories) {
				if (
					!repo.id ||
					!repo.name ||
					!repo.repositoryPath ||
					!repo.baseBranch
				) {
					logger.error("Invalid repository config: missing required fields", {
						requiredFields: ["id", "name", "repositoryPath", "baseBranch"],
						repo,
					});
					return null;
				}
			}

			return newConfig;
		} catch (error) {
			logger.error("Failed to load config file", {
				error,
			});
			return null;
		}
	}

	/**
	 * Detect changes between current and new repository configurations
	 */
	private detectRepositoryChanges(newConfig: EdgeWorkerConfig): {
		added: RepositoryConfig[];
		modified: RepositoryConfig[];
		removed: RepositoryConfig[];
	} {
		const currentRepos = new Map(this.repositories);
		const newRepos = new Map(newConfig.repositories.map((r) => [r.id, r]));

		const added: RepositoryConfig[] = [];
		const modified: RepositoryConfig[] = [];
		const removed: RepositoryConfig[] = [];

		// Find added and modified repositories
		for (const [id, repo] of newRepos) {
			if (!currentRepos.has(id)) {
				added.push(repo);
			} else {
				const currentRepo = currentRepos.get(id);
				if (currentRepo && !this.deepEqual(currentRepo, repo)) {
					modified.push(repo);
				}
			}
		}

		// Find removed repositories
		for (const [id, repo] of currentRepos) {
			if (!newRepos.has(id)) {
				removed.push(repo);
			}
		}

		return { added, modified, removed };
	}

	/**
	 * Deep equality check for repository configs
	 */
	private deepEqual(obj1: any, obj2: any): boolean {
		return JSON.stringify(obj1) === JSON.stringify(obj2);
	}

	/**
	 * Add new repositories to the running EdgeWorker
	 */
	private async addNewRepositories(repos: RepositoryConfig[]): Promise<void> {
		for (const repo of repos) {
			if (repo.isActive === false) {
				logger.info("Skipping inactive repository", {
					repository: repo.name,
					repositoryId: repo.id,
				});
				continue;
			}

			try {
				logger.info("Adding repository", {
					repository: repo.name,
					repositoryId: repo.id,
				});

				// Add to internal map
				this.repositories.set(repo.id, repo);

				// Create Linear client
				const linearClient = new LinearClient({
					accessToken: repo.linearToken,
				});
				this.linearClients.set(repo.id, linearClient);

				// Create LinearApiClient with retry logic, rate limiting, and caching
				const linearApiClient = new LinearApiClient({
					linearClient,
					rateLimiter: this.linearRateLimiter,
					repositoryId: repo.id,
					repositoryName: repo.name,
					cache: this.linearCache, // Share cache across all repositories
				});
				this.linearApiClients.set(repo.id, linearApiClient);

				// Create AgentSessionManager with same pattern as constructor
				const agentSessionManager = new AgentSessionManager(
					linearClient,
					(childSessionId: string) => {
						return this.sessionCleanup.getParentSession(childSessionId);
					},
					async (parentSessionId, prompt, childSessionId) => {
						await this.handleResumeParentSession(
							parentSessionId,
							prompt,
							childSessionId,
							repo,
							agentSessionManager,
						);
					},
					undefined, // No resumeNextSubroutine callback for dynamically added repos
					this.procedureRouter,
					this.sharedApplicationServer,
				);
				this.agentSessionManagers.set(repo.id, agentSessionManager);

				// Update token-to-repo mapping
				const repoIds = this.tokenToRepoIds.get(repo.linearToken) || [];
				if (!repoIds.includes(repo.id)) {
					repoIds.push(repo.id);
				}
				this.tokenToRepoIds.set(repo.linearToken, repoIds);

				// Set up webhook listener
				await this.setupWebhookListener(repo);

				logger.info("Repository added successfully", {
					repository: repo.name,
					repositoryId: repo.id,
				});
			} catch (error) {
				logger.error("Failed to add repository", {
					repository: repo.name,
					repositoryId: repo.id,
					error,
				});
			}
		}
	}

	/**
	 * Update existing repositories
	 */
	private async updateModifiedRepositories(
		repos: RepositoryConfig[],
	): Promise<void> {
		for (const repo of repos) {
			try {
				const oldRepo = this.repositories.get(repo.id);
				if (!oldRepo) {
					logger.warn("Repository not found for update, skipping", {
						repositoryId: repo.id,
					});
					continue;
				}

				logger.info("Updating repository", {
					repository: repo.name,
					repositoryId: repo.id,
				});

				// Update stored config
				this.repositories.set(repo.id, repo);

				// If token changed, recreate Linear client
				if (oldRepo.linearToken !== repo.linearToken) {
					logger.info("Token changed, recreating Linear client", {
						repository: repo.name,
						repositoryId: repo.id,
					});
					const linearClient = new LinearClient({
						accessToken: repo.linearToken,
					});
					this.linearClients.set(repo.id, linearClient);

					// Create LinearApiClient with retry logic and rate limiting
					const linearApiClient = new LinearApiClient({
						linearClient,
						rateLimiter: this.linearRateLimiter,
						repositoryId: repo.id,
						repositoryName: repo.name,
					});
					this.linearApiClients.set(repo.id, linearApiClient);

					// Update token mapping
					const oldRepoIds = this.tokenToRepoIds.get(oldRepo.linearToken) || [];
					const filteredOldIds = oldRepoIds.filter((id) => id !== repo.id);
					if (filteredOldIds.length > 0) {
						this.tokenToRepoIds.set(oldRepo.linearToken, filteredOldIds);
					} else {
						this.tokenToRepoIds.delete(oldRepo.linearToken);
					}

					const newRepoIds = this.tokenToRepoIds.get(repo.linearToken) || [];
					if (!newRepoIds.includes(repo.id)) {
						newRepoIds.push(repo.id);
					}
					this.tokenToRepoIds.set(repo.linearToken, newRepoIds);

					// Reconnect webhook if needed
					await this.reconnectWebhook(oldRepo, repo);
				}

				// If active status changed
				if (oldRepo.isActive !== repo.isActive) {
					if (repo.isActive === false) {
						logger.info(
							"Repository set to inactive, existing sessions will continue",
							{
								repository: repo.name,
								repositoryId: repo.id,
							},
						);
					} else {
						logger.info("Repository reactivated", {
							repository: repo.name,
							repositoryId: repo.id,
						});
						await this.setupWebhookListener(repo);
					}
				}

				logger.info("Repository updated successfully", {
					repository: repo.name,
					repositoryId: repo.id,
				});
			} catch (error) {
				logger.error("Failed to update repository", {
					repository: repo.name,
					repositoryId: repo.id,
					error,
				});
			}
		}
	}

	/**
	 * Remove deleted repositories
	 */
	private async removeDeletedRepositories(
		repos: RepositoryConfig[],
	): Promise<void> {
		for (const repo of repos) {
			try {
				logger.info("Removing repository", {
					repository: repo.name,
					repositoryId: repo.id,
				});

				// Check for active sessions
				const manager = this.agentSessionManagers.get(repo.id);
				const activeSessions = manager?.getActiveSessions() || [];

				if (activeSessions.length > 0) {
					logger.warn("Repository has active sessions, stopping them", {
						repository: repo.name,
						repositoryId: repo.id,
						activeSessionCount: activeSessions.length,
					});

					// Stop all active sessions and notify Linear
					for (const session of activeSessions) {
						try {
							logger.info("Stopping session for issue", {
								repository: repo.name,
								issueId: session.issueId,
								sessionId: session.linearAgentActivitySessionId,
							});

							// Get the Claude runner for this session
							const runner = manager?.getClaudeRunner(
								session.linearAgentActivitySessionId,
							);
							if (runner) {
								// Stop the Claude process
								runner.stop();
								logger.info("Stopped Claude runner for session", {
									repository: repo.name,
									sessionId: session.linearAgentActivitySessionId,
								});
							}

							// Post cancellation message to Linear
							const linearClient = this.linearClients.get(repo.id);
							if (linearClient) {
								await linearClient.createAgentActivity({
									agentSessionId: session.linearAgentActivitySessionId,
									content: {
										type: "response",
										body: `**Repository Removed from Configuration**\n\nThis repository (\`${repo.name}\`) has been removed from the Cyrus configuration. All active sessions for this repository have been stopped.\n\nIf you need to continue working on this issue, please contact your administrator to restore the repository configuration.`,
									},
								});
								logger.info("Posted cancellation message to Linear", {
									repository: repo.name,
									issueId: session.issueId,
									sessionId: session.linearAgentActivitySessionId,
								});
							}
						} catch (error) {
							logger.error("Failed to stop session", {
								repository: repo.name,
								sessionId: session.linearAgentActivitySessionId,
								error,
							});
						}
					}
				}

				// Remove repository from all maps
				this.repositories.delete(repo.id);
				this.linearClients.delete(repo.id);
				this.agentSessionManagers.delete(repo.id);

				// Update token mapping
				const repoIds = this.tokenToRepoIds.get(repo.linearToken) || [];
				const filteredIds = repoIds.filter((id) => id !== repo.id);
				if (filteredIds.length > 0) {
					this.tokenToRepoIds.set(repo.linearToken, filteredIds);
				} else {
					this.tokenToRepoIds.delete(repo.linearToken);
				}

				// Clean up webhook listener if no other repos use the same token
				await this.cleanupWebhookIfUnused(repo);

				logger.info("Repository removed successfully", {
					repository: repo.name,
					repositoryId: repo.id,
				});
			} catch (error) {
				logger.error("Failed to remove repository", {
					repository: repo.name,
					repositoryId: repo.id,
					error,
				});
			}
		}
	}

	/**
	 * Set up webhook listener for a repository
	 */
	private async setupWebhookListener(repo: RepositoryConfig): Promise<void> {
		// Check if we already have a client for this token
		const existingRepoIds = this.tokenToRepoIds.get(repo.linearToken) || [];
		const existingClient =
			existingRepoIds.length > 0
				? this.ndjsonClients.get(existingRepoIds[0] || "")
				: null;

		if (existingClient) {
			logger.debug("Reusing existing webhook connection", {
				repository: repo.name,
				tokenSuffix: repo.linearToken.slice(-4),
			});
			return;
		}

		// Create new NDJSON client for this token
		const serverPort =
			this.config.serverPort || this.config.webhookPort || 3456;
		const serverHost = this.config.serverHost || "localhost";
		const useLinearDirectWebhooks =
			this.validatedConfig.useLinearDirectWebhooks;

		const clientConfig = {
			proxyUrl: this.config.proxyUrl,
			token: repo.linearToken,
			name: repo.name,
			transport: "webhook" as const,
			useExternalWebhookServer: true,
			externalWebhookServer: this.sharedApplicationServer,
			webhookPort: serverPort,
			webhookPath: "/webhook",
			webhookHost: serverHost,
			...(this.config.baseUrl && { webhookBaseUrl: this.config.baseUrl }),
			...(!this.config.baseUrl &&
				this.config.webhookBaseUrl && {
					webhookBaseUrl: this.config.webhookBaseUrl,
				}),
			onConnect: () => this.handleConnect(repo.id, [repo]),
			onDisconnect: (reason?: string) =>
				this.handleDisconnect(repo.id, [repo], reason),
			onError: (error: Error) => this.handleError(error),
		};

		const ndjsonClient = useLinearDirectWebhooks
			? new LinearWebhookClient({
					...clientConfig,
					onWebhook: (payload: any) => {
						// Get fresh repositories for this token to avoid stale closures
						const freshRepos = this.getRepositoriesForToken(repo.linearToken);
						this.handleWebhook(payload as unknown as LinearWebhook, freshRepos);
					},
				})
			: new NdjsonClient(clientConfig);

		if (!useLinearDirectWebhooks) {
			(ndjsonClient as NdjsonClient).on("webhook", (data) => {
				// Get fresh repositories for this token to avoid stale closures
				const freshRepos = this.getRepositoriesForToken(repo.linearToken);
				this.handleWebhook(data as LinearWebhook, freshRepos);
			});
		}

		this.ndjsonClients.set(repo.id, ndjsonClient);

		// Connect the client
		try {
			await ndjsonClient.connect();
			logger.info("Webhook listener connected", {
				repository: repo.name,
				repositoryId: repo.id,
			});
		} catch (error) {
			logger.error("Failed to connect webhook listener", {
				repository: repo.name,
				repositoryId: repo.id,
				error,
			});
		}
	}

	/**
	 * Reconnect webhook when token changes
	 */
	private async reconnectWebhook(
		oldRepo: RepositoryConfig,
		newRepo: RepositoryConfig,
	): Promise<void> {
		logger.info("Reconnecting webhook due to token change", {
			repository: newRepo.name,
			repositoryId: newRepo.id,
		});

		// Disconnect old client if no other repos use it
		await this.cleanupWebhookIfUnused(oldRepo);

		// Set up new connection
		await this.setupWebhookListener(newRepo);
	}

	/**
	 * Clean up webhook listener if no other repositories use the token
	 */
	private async cleanupWebhookIfUnused(repo: RepositoryConfig): Promise<void> {
		const repoIds = this.tokenToRepoIds.get(repo.linearToken) || [];
		const otherRepos = repoIds.filter((id) => id !== repo.id);

		if (otherRepos.length === 0) {
			// No other repos use this token, safe to disconnect
			const client = this.ndjsonClients.get(repo.id);
			if (client) {
				logger.info("Disconnecting webhook", {
					repository: repo.name,
					tokenSuffix: repo.linearToken.slice(-4),
				});
				client.disconnect();
				this.ndjsonClients.delete(repo.id);
			}
		} else {
			logger.info(
				"Token still used by other repositories, keeping connection",
				{
					repository: repo.name,
					otherReposCount: otherRepos.length,
				},
			);
		}
	}

	/**
	 * Handle connection established
	 */
	private handleConnect(clientId: string, repos: RepositoryConfig[]): void {
		// Get the token for backward compatibility with events
		const token = repos[0]?.linearToken || clientId;
		this.emit("connected", token);
		// Connection logged by CLI app event handler
	}

	/**
	 * Handle disconnection
	 */
	private handleDisconnect(
		clientId: string,
		repos: RepositoryConfig[],
		reason?: string,
	): void {
		// Get the token for backward compatibility with events
		const token = repos[0]?.linearToken || clientId;
		this.emit("disconnected", token, reason);
	}

	/**
	 * Handle errors
	 */
	private handleError(error: Error): void {
		this.emit("error", error);
		this.config.handlers?.onError?.(error);
	}

	/**
	 * Handle webhook events from proxy - now accepts native webhook payloads
	 */
	private async handleWebhook(
		webhook: LinearWebhook,
		repos: RepositoryConfig[],
	): Promise<void> {
		// Log verbose webhook info if enabled
		if (this.validatedConfig.isWebhookDebugMode) {
			logger.debug("Full webhook payload", {
				webhook: JSON.stringify(webhook, null, 2),
			});
		}

		// Check for duplicate webhooks (10-20% skip rate expected)
		const webhookFingerprint = WebhookDeduplicator.generateFingerprint(webhook);
		if (this.webhookDeduplicator.isDuplicate(webhookFingerprint)) {
			logger.debug("Skipping duplicate webhook", {
				fingerprint: webhookFingerprint,
			});
			return;
		}

		// Find the appropriate repository for this webhook
		const repository = await this.findRepositoryForWebhook(webhook, repos);
		if (!repository) {
			if (this.validatedConfig.isWebhookDebugMode) {
				logger.debug("No repository configured for webhook", {
					workspaceId: webhook.organizationId,
					availableRepos: repos.map((r) => ({
						name: r.name,
						workspaceId: r.linearWorkspaceId,
						teamKeys: r.teamKeys,
						routingLabels: r.routingLabels,
					})),
				});
			}
			return;
		}

		try {
			// DEBUG: Log all incoming webhooks to understand what we're receiving
			logger.info("Processing webhook", {
				repository: repository.name,
				type: webhook.type,
				action: webhook.action,
			});

			// Handle specific webhook types with proper typing
			// RE-ENABLED: Traditional webhooks for issue assignment and comments
			if (isIssueAssignedWebhook(webhook)) {
				await this.handleIssueAssignedWebhook(webhook, repository);
			} else if (isIssueCommentMentionWebhook(webhook)) {
				await this.handleIssueCommentMentionWebhook(webhook, repository);
			} else if (isIssueNewCommentWebhook(webhook)) {
				await this.handleIssueNewCommentWebhook(webhook, repository);
			} else if (isIssueUnassignedWebhook(webhook)) {
				// Keep unassigned webhook active
				await this.handleIssueUnassignedWebhook(webhook, repository);
			} else if (isAgentSessionCreatedWebhook(webhook)) {
				await this.handleAgentSessionCreatedWebhook(webhook, repository);
			} else if (isAgentSessionPromptedWebhook(webhook)) {
				await this.handleUserPostedAgentActivity(webhook, repository);
			} else if (isDataChangeWebhook(webhook)) {
				// Handle data change events (Issue, Comment, etc.)
				await this.handleDataChangeWebhook(webhook, repository);
			} else {
				// TypeScript narrows webhook to never here, so we need to widen it
				const unhandledWebhook = webhook as LinearWebhook;
				logger.warn("Unhandled webhook type", {
					repository: repository.name,
					type: unhandledWebhook.type,
					action: unhandledWebhook.action,
				});
			}
		} catch (error) {
			logger.error("Failed to process webhook", {
				repository: repository.name,
				webhookAction: webhook.action,
				error,
			});
			// Don't re-throw webhook processing errors to prevent application crashes
			// The error has been logged and individual webhook failures shouldn't crash the entire system
		}
	}

	/**
	 * Handle issue unassignment webhook
	 */
	private async handleIssueUnassignedWebhook(
		webhook: LinearIssueUnassignedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		logger.info("Handling issue unassignment", {
			repository: repository.name,
			issueIdentifier: webhook.notification.issue.identifier,
		});

		await this.handleIssueUnassigned(webhook.notification.issue, repository);
	}

	private async handleIssueAssignedWebhook(
		webhook: LinearIssueAssignedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		logger.info("Handling traditional issue assignment", {
			repository: repository.name,
			issueIdentifier: webhook.notification.issue.identifier,
		});

		// Convert traditional webhook to agent session format and process
		const fakeAgentSessionWebhook = this.convertToAgentSessionWebhook(
			webhook,
			undefined,
		);
		await this.handleAgentSessionCreatedWebhook(
			fakeAgentSessionWebhook,
			repository,
		);
	}

	private async handleIssueCommentMentionWebhook(
		webhook: LinearIssueCommentMentionWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		logger.info("Handling traditional comment mention", {
			repository: repository.name,
			issueIdentifier: webhook.notification.issue.identifier,
		});

		// Convert traditional webhook to agent session format and process
		const fakeAgentSessionWebhook = this.convertToAgentSessionWebhook(
			webhook,
			webhook.notification.comment?.body,
		);
		await this.handleAgentSessionCreatedWebhook(
			fakeAgentSessionWebhook,
			repository,
		);
	}

	private async handleIssueNewCommentWebhook(
		webhook: LinearIssueNewCommentWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		logger.info("Handling traditional new comment", {
			repository: repository.name,
			issueIdentifier: webhook.notification.issue.identifier,
		});

		// Convert traditional webhook to agent session format and process
		const fakeAgentSessionWebhook = this.convertToAgentSessionWebhook(
			webhook,
			webhook.notification.comment?.body,
		);
		await this.handleAgentSessionCreatedWebhook(
			fakeAgentSessionWebhook,
			repository,
		);
	}

	/**
	 * Detect and log manual changes to issue (status, priority, assignee, labels, etc.)
	 * Records these changes in active session context for future reference
	 */
	private async recordIssueChanges(
		data: any,
		updatedFrom: any,
		repository: RepositoryConfig,
	): Promise<void> {
		const changes: string[] = [];
		const issueId = data.id;

		// Detect status/state changes
		if (updatedFrom?.state?.id !== data.state?.id) {
			const oldState = updatedFrom?.state?.name || "Unknown";
			const newState = data.state?.name || "Unknown";
			changes.push(`Status: "${oldState}" → "${newState}"`);
		}

		// Detect priority changes
		if (updatedFrom?.priority !== data.priority) {
			const priorityLabels = ["No priority", "Urgent", "High", "Medium", "Low"];
			const oldPriority = priorityLabels[updatedFrom?.priority || 0];
			const newPriority = priorityLabels[data.priority || 0];
			changes.push(`Priority: ${oldPriority} → ${newPriority}`);
		}

		// Detect assignee changes (non-assignment scenarios)
		if (updatedFrom?.assigneeId !== data.assigneeId) {
			if (data.assigneeId === null) {
				changes.push(`Assignee: Unassigned`);
			} else if (updatedFrom?.assigneeId !== null) {
				changes.push(`Assignee: Changed`);
			}
		}

		// Detect label changes
		if (
			JSON.stringify(updatedFrom?.labelIds) !== JSON.stringify(data.labelIds)
		) {
			changes.push(`Labels: Updated`);
		}

		// Detect project changes
		if (updatedFrom?.projectId !== data.projectId) {
			changes.push(`Project: Changed`);
		}

		// Detect title/description changes
		if (updatedFrom?.title && updatedFrom.title !== data.title) {
			changes.push(`Title: Updated`);
		}

		if (
			updatedFrom?.description &&
			updatedFrom.description !== data.description
		) {
			changes.push(`Description: Updated`);
		}

		// If there are changes, log and record them
		if (changes.length > 0) {
			const changesSummary = changes.join(", ");
			logger.info("Issue manual changes detected", {
				repository: repository.name,
				issueId,
				issueIdentifier: data.identifier,
				changes: changesSummary,
			});

			// Find active session for this issue and record changes
			const agentSessionManager = this.agentSessionManagers.get(repository.id);
			if (agentSessionManager) {
				const sessions = agentSessionManager.getSessionsForIssue(issueId);
				for (const session of sessions) {
					if (!session.metadata) {
						session.metadata = {};
					}

					// Store change history
					if (!session.metadata.issueChangeHistory) {
						session.metadata.issueChangeHistory = [];
					}

					session.metadata.issueChangeHistory.push({
						timestamp: Date.now(),
						changes: changesSummary,
						updatedFields: changes,
					});

					logger.info("Recorded changes in session", {
						repository: repository.name,
						sessionId: session.linearAgentActivitySessionId,
						changes: changesSummary,
					});
				}
			}
		}
	}

	/**
	 * Check if a parent comment was created by the bot
	 * Used to determine if we should respond to thread replies
	 */
	private async isParentCommentFromBot(
		parentId: string,
		linearClient?: LinearClient,
	): Promise<boolean> {
		// First check our tracking Set (fast)
		if (this.sessionCleanup.isBotParentComment(parentId)) {
			logger.debug("Parent comment is in bot tracking set", {
				parentId,
			});
			return true;
		}

		// If not in Set and we have Linear client, query the API
		if (linearClient) {
			try {
				const comment = await retryWithBackoff(
					async () => {
						await this.linearRateLimiter.acquire();
						return linearClient.comment({ id: parentId });
					},
					{ maxAttempts: 3, initialDelayMs: 1000 },
				);
				const user = await comment.user;
				const userId = user?.id;

				// Check if user is a known bot user
				if (userId && this.botUserIds.has(userId)) {
					logger.debug("Parent comment is from bot user", {
						parentId,
						userId,
					});
					// Add to Set for future fast lookups
					this.sessionCleanup.addBotParentComment(parentId);
					return true;
				}
			} catch (error) {
				logger.error("Failed to fetch parent comment", {
					parentId,
					error,
				});
			}
		}

		return false;
	}

	/**
	 * Check if the bot should respond to a comment
	 * Responds when:
	 * 1. Comment is a reply (has parentId) to one of OUR comments
	 * 2. Comment mentions the bot (contains @cyrus or @bot)
	 *
	 * NEVER responds to its own comments (prevents infinite loops)
	 */
	private async shouldRespondToComment(
		commentData: any,
		repository?: RepositoryConfig,
	): Promise<boolean> {
		// DEBUG: Log comment details to identify bot comments
		logger.debug("Checking comment for response", {
			repository: repository?.name,
			commentId: commentData.id,
			userId: commentData.userId,
			botActor: commentData.botActor,
			bodyPreview: commentData.body?.substring(0, 100),
			parentId: commentData.parentId,
		});

		// CRITICAL: Never respond to bot's own comments (prevents infinite loop)

		// Check 1: Is this a comment we just created?
		if (this.sessionCleanup.isRecentBotComment(commentData.id)) {
			logger.debug("Comment is recently created bot comment, ignoring", {
				repository: repository?.name,
				commentId: commentData.id,
			});
			return false;
		}

		// Check 2: Is the user ID a known bot user?
		if (commentData.userId && this.botUserIds.has(commentData.userId)) {
			logger.debug("Comment is from known bot user, ignoring", {
				repository: repository?.name,
				commentId: commentData.id,
				userId: commentData.userId,
			});
			return false;
		}

		// Check 3: Traditional bot detection
		const isBotComment =
			!commentData.userId || // No userId means it's from the app
			commentData.userId === "data-change-webhook-user" || // Our fake user
			commentData.botActor === true; // Linear marks bot comments

		if (isBotComment) {
			logger.debug(
				"Comment is from bot (no userId or botActor=true), ignoring",
				{
					repository: repository?.name,
					commentId: commentData.id,
				},
			);
			return false;
		}

		// Check if it's a reply (has parentId)
		if (commentData.parentId) {
			logger.debug("Comment is a reply", {
				repository: repository?.name,
				commentId: commentData.id,
				parentId: commentData.parentId,
			});

			// Check if parent comment is from the bot
			const linearClient = repository
				? this.linearClients.get(repository.id)
				: undefined;
			const isReplyToBot = await this.isParentCommentFromBot(
				commentData.parentId,
				linearClient,
			);

			if (isReplyToBot) {
				logger.info("Comment is a reply to bot comment, will respond", {
					repository: repository?.name,
					commentId: commentData.id,
				});
				return true;
			} else {
				logger.debug(
					"Comment is a reply to non-bot comment, checking for mention",
					{
						repository: repository?.name,
						commentId: commentData.id,
					},
				);
				// Fall through to check for mention
			}
		}

		// Check for bot mention in body (only @cyrus or @bot, not "cyrus" alone)
		const body = (commentData.body || "").toLowerCase();
		const botKeywords = ["@cyrus", "@bot"];
		const hasMention = botKeywords.some((keyword) => body.includes(keyword));

		if (hasMention) {
			logger.info("Comment mentions bot, will respond", {
				repository: repository?.name,
				commentId: commentData.id,
			});
			return true;
		}

		logger.info("Comment is not a reply and doesn't mention bot, skipping", {
			repository: commentData.id,
			commentId: commentData.id,
		});
		return false;
	}

	/**
	 * Handle data change webhooks (type="Issue", "Comment", etc.)
	 */
	private async handleDataChangeWebhook(
		webhook: any,
		repository: RepositoryConfig,
	): Promise<void> {
		const { type, action, data, updatedFrom } = webhook;

		logger.info("Processing data change webhook", {
			repository: repository.name,
			type,
			action,
		});

		// Handle Issue webhooks - check for assignments
		if (type === "Issue" && (action === "create" || action === "update")) {
			// Check if this is a NEW assignment (from unassigned to assigned)
			// Only trigger execution when assignee changes from null/undefined to a value
			// This prevents edits to already-assigned issues from triggering execution
			const wasNewlyAssigned =
				(updatedFrom?.assigneeId == null ||
					updatedFrom?.assigneeId === undefined) &&
				data.assigneeId != null;
			const isAssignedToUser = data.assigneeId != null;

			if (wasNewlyAssigned && isAssignedToUser) {
				// Record any other changes that came with the assignment
				await this.recordIssueChanges(data, updatedFrom, repository);

				// Check issue state - don't auto-process if in backlog, done, or canceled
				const stateType = data.state?.type || updatedFrom?.state?.type;
				const stateName = (
					data.state?.name ||
					updatedFrom?.state?.name ||
					""
				).toLowerCase();

				if (
					stateType === "backlog" ||
					stateType === "completed" ||
					stateType === "canceled"
				) {
					logger.info("Issue in non-active state, skipping auto-processing", {
						repository: repository.name,
						issueIdentifier: data.identifier || data.id,
						stateType,
					});
					return;
				}

				// Also skip if state name suggests backlog/done
				if (
					stateName.includes("backlog") ||
					stateName.includes("done") ||
					stateName.includes("canceled")
				) {
					logger.info(
						"Issue in non-active state by name, skipping auto-processing",
						{
							repository: repository.name,
							issueIdentifier: data.identifier || data.id,
							stateName,
						},
					);
					return;
				}

				logger.info("Issue was assigned, processing", {
					repository: repository.name,
					issueIdentifier: data.identifier || data.id,
				});

				// Convert to webhook format that handleAgentSessionCreatedWebhook expects
				const fakeIssue: LinearWebhookIssue = {
					id: data.id,
					title: data.title,
					teamId: data.teamId,
					team: data.team || { id: data.teamId, key: "", name: "" },
					identifier: data.identifier || `${data.team?.key}-${data.number}`,
					url: data.url || `https://linear.app/issue/${data.identifier}`,
				};

				const fakeAgentSessionWebhook: LinearAgentSessionCreatedWebhook = {
					type: "AgentSessionEvent",
					action: "created",
					createdAt: webhook.createdAt,
					organizationId: webhook.organizationId,
					oauthClientId: "data-change-webhook",
					appUserId: "data-change-webhook-user",
					webhookTimestamp:
						webhook.webhookTimestamp || new Date().toISOString(),
					webhookId: `datachange_${webhook.webhookId}`,
					agentSession: {
						id: crypto.randomUUID(), // Generate valid UUID for Linear API compatibility
						issueId: data.id,
						issue: fakeIssue,
						status: "pending",
					} as LinearWebhookAgentSession,
					guidance: [],
				} as LinearAgentSessionCreatedWebhook;

				await this.handleAgentSessionCreatedWebhook(
					fakeAgentSessionWebhook,
					repository,
				);
			} else {
				// Not an assignment, but record any other changes (status, priority, labels, etc.)
				await this.recordIssueChanges(data, updatedFrom, repository);
			}
		}
		// Handle Comment webhooks - process all new comments on issues
		else if (type === "Comment" && action === "create") {
			logger.info("New comment detected on issue, processing", {
				repository: repository.name,
				issueIdentifier: data.issue?.identifier || data.issueId,
			});

			// Check if we should respond to this comment
			const shouldRespond = await this.shouldRespondToComment(data, repository);

			if (!shouldRespond) {
				logger.debug("Skipping comment - not a reply and no mention", {
					repository: repository.name,
					commentId: data.id,
				});
				return;
			}

			// Fetch issue details from Linear API to get full issue info
			try {
				const issueId = data.issueId || data.issue?.id;
				if (!issueId) {
					logger.warn("Comment webhook missing issueId, cannot process", {
						repository: repository.name,
						commentId: data.id,
					});
					return;
				}

				// Create fake issue from comment data
				const fakeIssue: LinearWebhookIssue = {
					id: issueId,
					title: data.issue?.title || "Unknown",
					teamId: data.issue?.teamId || "",
					team: data.issue?.team || { id: "", key: "", name: "" },
					identifier: data.issue?.identifier || issueId,
					url: data.issue?.url || `https://linear.app/issue/${issueId}`,
				};

				const fakeAgentSessionWebhook: LinearAgentSessionCreatedWebhook = {
					type: "AgentSessionEvent",
					action: "created",
					createdAt: webhook.createdAt,
					organizationId: webhook.organizationId,
					oauthClientId: "data-change-webhook",
					appUserId: "data-change-webhook-user",
					webhookTimestamp:
						webhook.webhookTimestamp || new Date().toISOString(),
					webhookId: `datachange_comment_${webhook.webhookId}`,
					agentSession: {
						id: crypto.randomUUID(), // Generate valid UUID for Linear API compatibility
						createdAt: webhook.createdAt,
						updatedAt: webhook.createdAt,
						archivedAt: null,
						creatorId: "data-change-webhook-user",
						appUserId: "data-change-webhook-user",
						commentId: data.id,
						issueId: issueId,
						status: "pending",
						startedAt: null,
						endedAt: null,
						type: "commentThread",
						summary: null,
						sourceMetadata: null,
						organizationId: webhook.organizationId,
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
							issueId: issueId,
							parentId: data.parentId, // Include parentId for thread replies
						},
						issue: fakeIssue,
						// Store thread reply metadata in agentSession for later use
						metadata: {
							originalCommentId: data.id,
							originalCommentBody: data.body || "",
							shouldReplyInThread: true,
						},
					} as any, // Use 'any' to allow custom metadata field
					guidance: [],
				} as LinearAgentSessionCreatedWebhook;

				await this.handleAgentSessionCreatedWebhook(
					fakeAgentSessionWebhook,
					repository,
				);
			} catch (error) {
				logger.error("Failed to process comment webhook", {
					repository: repository.name,
					error,
				});
			}
		} else {
			logger.debug("Data change webhook not processed", {
				repository: repository.name,
				type,
				action,
			});
		}
	}

	/**
	 * Convert traditional webhook to agent session webhook format
	 * This allows reusing existing agent session processing logic
	 */
	private convertToAgentSessionWebhook(
		webhook:
			| LinearIssueAssignedWebhook
			| LinearIssueCommentMentionWebhook
			| LinearIssueNewCommentWebhook,
		commentBody?: string,
	): LinearAgentSessionCreatedWebhook {
		const { notification, organizationId, createdAt, webhookId } = webhook;
		const { issue } = notification;

		// Create a fake agent session webhook
		return {
			type: "AgentSessionEvent",
			action: "created",
			createdAt,
			organizationId,
			oauthClientId: "traditional-webhook",
			appUserId: "traditional-webhook-user",
			webhookTimestamp: new Date().toISOString(),
			webhookId: `traditional_${webhookId}`,
			agentSession: {
				id: crypto.randomUUID(), // Generate valid UUID for Linear API compatibility
				issueId: issue.id,
				issue: issue,
				status: "pending",
				comment: commentBody
					? {
							id: `comment_${Date.now()}`,
							body: commentBody,
						}
					: undefined,
			} as LinearWebhookAgentSession,
			guidance: [],
		} as LinearAgentSessionCreatedWebhook;
	}

	/**
	 * Find the repository configuration for a webhook
	 * Now supports async operations for label-based and project-based routing
	 * Priority: routingLabels > projectKeys > teamKeys
	 */
	private async findRepositoryForWebhook(
		webhook: LinearWebhook,
		repos: RepositoryConfig[],
	): Promise<RepositoryConfig | null> {
		const workspaceId = webhook.organizationId;
		if (!workspaceId) return repos[0] || null; // Fallback to first repo if no workspace ID

		// Get issue information from webhook
		let issueId: string | undefined;
		let teamKey: string | undefined;
		let issueIdentifier: string | undefined;

		// Handle agent session webhooks which have different structure
		if (
			isAgentSessionCreatedWebhook(webhook) ||
			isAgentSessionPromptedWebhook(webhook)
		) {
			issueId = webhook.agentSession?.issue?.id;
			teamKey = webhook.agentSession?.issue?.team?.key;
			issueIdentifier = webhook.agentSession?.issue?.identifier;
		} else if (isDataChangeWebhook(webhook)) {
			// Data change webhooks have issue data in different location
			if (webhook.type === "Issue") {
				issueId = webhook.data?.id;
				teamKey = webhook.data?.team?.key;
				issueIdentifier = webhook.data?.identifier;
			} else if (webhook.type === "Comment") {
				// For comments, extract issue info from the comment data
				issueId = webhook.data?.issueId || webhook.data?.issue?.id;
				teamKey = webhook.data?.issue?.team?.key;
				issueIdentifier = webhook.data?.issue?.identifier;
			}
		} else {
			issueId = webhook.notification?.issue?.id;
			teamKey = webhook.notification?.issue?.team?.key;
			issueIdentifier = webhook.notification?.issue?.identifier;
		}

		// Filter repos by workspace first
		const workspaceRepos = repos.filter(
			(repo) => repo.linearWorkspaceId === workspaceId,
		);
		if (workspaceRepos.length === 0) return null;

		// Priority 1: Check routing labels (highest priority)
		const reposWithRoutingLabels = workspaceRepos.filter(
			(repo) => repo.routingLabels && repo.routingLabels.length > 0,
		);

		if (reposWithRoutingLabels.length > 0 && issueId && workspaceRepos[0]) {
			// We need a Linear client to fetch labels
			// Use the first workspace repo's client temporarily
			const linearClient = this.linearClients.get(workspaceRepos[0].id);

			if (linearClient) {
				try {
					// Fetch the issue to get labels
					const issue = await retryWithBackoff(
						async () => {
							await this.linearRateLimiter.acquire();
							return linearClient.issue(issueId);
						},
						{ maxAttempts: 3, initialDelayMs: 1000 },
					);
					const labels = await this.fetchIssueLabels(issue);

					// Check each repo with routing labels
					for (const repo of reposWithRoutingLabels) {
						if (
							repo.routingLabels?.some((routingLabel) =>
								labels.includes(routingLabel),
							)
						) {
							logger.info("Repository selected via label-based routing", {
								repository: repo.name,
								issueId,
								matchedLabels: labels.filter((l) =>
									repo.routingLabels?.includes(l),
								),
							});
							return repo;
						}
					}
				} catch (error) {
					logger.error("Failed to fetch labels for routing", {
						issueId,
						error,
					});
					// Continue to project-based routing
				}
			}
		}

		// Priority 2: Check project-based routing
		if (issueId) {
			const projectBasedRepo = await this.findRepositoryByProject(
				issueId,
				workspaceRepos,
			);
			if (projectBasedRepo) {
				logger.info("Repository selected via project-based routing", {
					repository: projectBasedRepo.name,
					issueId,
				});
				return projectBasedRepo;
			}
		}

		// Priority 3: Check team-based routing
		if (teamKey) {
			const repo = workspaceRepos.find((r) => r.teamKeys?.includes(teamKey));
			if (repo) {
				logger.info("Repository selected via team-based routing", {
					repository: repo.name,
					teamKey,
				});
				return repo;
			}
		}

		// Try parsing issue identifier as fallback for team routing
		if (issueIdentifier?.includes("-")) {
			const prefix = issueIdentifier.split("-")[0];
			if (prefix) {
				const repo = workspaceRepos.find((r) => r.teamKeys?.includes(prefix));
				if (repo) {
					logger.info("Repository selected via team prefix routing", {
						repository: repo.name,
						teamPrefix: prefix,
						issueIdentifier,
					});
					return repo;
				}
			}
		}

		// Workspace fallback - find first repo without routing configuration
		const catchAllRepo = workspaceRepos.find(
			(repo) =>
				(!repo.teamKeys || repo.teamKeys.length === 0) &&
				(!repo.routingLabels || repo.routingLabels.length === 0) &&
				(!repo.projectKeys || repo.projectKeys.length === 0),
		);

		if (catchAllRepo) {
			logger.info("Repository selected as workspace catch-all", {
				repository: catchAllRepo.name,
			});
			return catchAllRepo;
		}

		// Final fallback to first workspace repo
		const fallbackRepo = workspaceRepos[0] || null;
		if (fallbackRepo) {
			logger.info("Repository selected by workspace fallback", {
				repository: fallbackRepo.name,
			});
		}
		return fallbackRepo;
	}

	/**
	 * Helper method to find repository by project name
	 */
	private async findRepositoryByProject(
		issueId: string,
		repos: RepositoryConfig[],
	): Promise<RepositoryConfig | null> {
		// Try each repository that has projectKeys configured
		for (const repo of repos) {
			if (!repo.projectKeys || repo.projectKeys.length === 0) continue;

			try {
				const fullIssue = await this.fetchFullIssueDetails(issueId, repo.id);
				const project = await fullIssue?.project;
				if (!project || !project.name) {
					logger.warn("No project name found for issue", {
						repository: repo.name,
						issueId,
					});
					continue;
				}

				const projectName = project.name;
				if (repo.projectKeys.includes(projectName)) {
					logger.info("Matched issue to repository via project", {
						repository: repo.name,
						issueId,
						projectName,
					});
					return repo;
				}
			} catch (error) {
				// Continue to next repository if this one fails
				logger.debug("Failed to fetch project for issue", {
					repository: repo.name,
					issueId,
					error,
				});
			}
		}

		return null;
	}

	/**
	 * Create a new Linear agent session with all necessary setup
	 * @param linearAgentActivitySessionId The Linear agent activity session ID
	 * @param issue Linear issue object
	 * @param repository Repository configuration
	 * @param agentSessionManager Agent session manager instance
	 * @returns Object containing session details and setup information
	 */
	private async createLinearAgentSession(
		linearAgentActivitySessionId: string,
		issue: { id: string; identifier: string },
		repository: RepositoryConfig,
		agentSessionManager: AgentSessionManager,
		shouldSyncToLinear: boolean = true,
	): Promise<LinearAgentSessionData> {
		// Fetch full Linear issue details
		const fullIssue = await this.fetchFullIssueDetails(issue.id, repository.id);
		if (!fullIssue) {
			throw new Error(`Failed to fetch full issue details for ${issue.id}`);
		}

		// NOTE: Never auto-change issue status - only suggest changes
		// User preference: Cyrus should NEVER alter status, assignee, or project automatically

		// Create workspace using full issue data
		const workspace = this.config.handlers?.createWorkspace
			? await this.config.handlers.createWorkspace(fullIssue, repository)
			: {
					path: `${repository.workspaceBaseDir}/${fullIssue.identifier}`,
					isGitWorktree: false,
				};

		logger.info("Workspace created", {
			repository: repository.name,
			issueIdentifier: fullIssue.identifier,
			workspacePath: workspace.path,
		});

		const issueMinimal = this.convertLinearIssueToCore(fullIssue);
		agentSessionManager.createLinearAgentSession(
			linearAgentActivitySessionId,
			issue.id,
			issueMinimal,
			workspace,
			shouldSyncToLinear,
		);

		// Get the newly created session
		const session = agentSessionManager.getSession(
			linearAgentActivitySessionId,
		);
		if (!session) {
			throw new Error(
				`Failed to create session for agent activity session ${linearAgentActivitySessionId}`,
			);
		}

		// Download attachments before creating Claude runner
		const attachmentResult = await this.downloadIssueAttachments(
			fullIssue,
			repository,
			workspace.path,
		);

		// Pre-create attachments directory even if no attachments exist yet
		const workspaceFolderName = basename(workspace.path);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);
		await mkdir(attachmentsDir, { recursive: true });

		// Build allowed directories list - always include attachments directory
		const allowedDirectories: string[] = [attachmentsDir];

		logger.debug("Configured allowed directories", {
			repository: repository.name,
			issueIdentifier: fullIssue.identifier,
			allowedDirectories,
		});

		// Build allowed tools list with Linear MCP tools
		const allowedTools = this.buildAllowedTools(repository);
		const disallowedTools = this.buildDisallowedTools(repository);

		return {
			session,
			fullIssue,
			workspace,
			attachmentResult,
			attachmentsDir,
			allowedDirectories,
			allowedTools,
			disallowedTools,
		};
	}

	/**
	 * Handle agent session created webhook
	 * . Can happen due to being 'delegated' or @ mentioned in a new thread
	 * @param webhook
	 * @param repository Repository configuration
	 */
	private async handleAgentSessionCreatedWebhook(
		webhook: LinearAgentSessionCreatedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		logger.info("Handling agent session created", {
			repository: repository.name,
			issueIdentifier: webhook.agentSession.issue.identifier,
			sessionId: webhook.agentSession.id,
		});
		const { agentSession, guidance } = webhook;
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

		// Log guidance if present
		if (guidance && guidance.length > 0) {
			logger.info("Agent guidance received", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				guidanceCount: guidance.length,
			});
			for (const rule of guidance) {
				let origin = "Unknown";
				if (rule.origin) {
					if (rule.origin.__typename === "TeamOriginWebhookPayload") {
						origin = `Team: ${rule.origin.team.displayName}`;
					} else {
						origin = "Organization";
					}
				}
				logger.debug("Guidance rule", {
					repository: repository.name,
					origin,
					bodyPreview: rule.body.substring(0, 100),
				});
			}
		}

		const commentBody = agentSession.comment?.body;
		/**
		 * Differentiate between mention-triggered and direct agent session creation
		 * The comment body is always populated in the webhook, so we check for Linear's
		 * standard agent session marker text to determine the trigger type
		 */
		const AGENT_SESSION_MARKER = "This thread is for an agent session";
		const isMentionTriggered =
			commentBody && !commentBody.includes(AGENT_SESSION_MARKER);
		// Check if the comment contains the /label-based-prompt command
		const isLabelBasedPromptRequested = commentBody?.includes(
			"/label-based-prompt",
		);

		// Initialize the agent session in AgentSessionManager
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			logger.error("No agentSessionManager found for repository", {
				repository: repository.name,
				repositoryId: repository.id,
			});
			return;
		}

		// Check if this is a fake session created from data change webhooks
		// Real Linear agent sessions don't have these prefixes in their webhookId
		const isFakeSession =
			webhook.webhookId?.startsWith("datachange_") ||
			webhook.webhookId?.startsWith("traditional_");

		if (!isFakeSession) {
			// Only post acknowledgment for real Linear agent sessions
			await this.postInstantAcknowledgment(
				linearAgentActivitySessionId,
				repository.id,
			);
		} else {
			logger.debug("Skipping Linear sync for data change webhook session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});
		}

		// Create the session using the shared method
		const sessionData = await this.createLinearAgentSession(
			linearAgentActivitySessionId,
			issue,
			repository,
			agentSessionManager,
			!isFakeSession, // Disable Linear sync for fake sessions from data change webhooks
		);

		// Destructure the session data (excluding allowedTools which we'll build with promptType)
		const {
			session,
			fullIssue,
			workspace: _workspace,
			attachmentResult,
			attachmentsDir: _attachmentsDir,
			allowedDirectories,
		} = sessionData;

		// Initialize procedure metadata using intelligent routing
		if (!session.metadata) {
			session.metadata = {};
		}

		// Copy thread reply metadata from webhook (if present)
		const webhookMetadata = (webhook.agentSession as any)?.metadata;
		if (webhookMetadata) {
			if (webhookMetadata.originalCommentId) {
				session.metadata.originalCommentId = webhookMetadata.originalCommentId;
			}
			if (webhookMetadata.originalCommentBody) {
				session.metadata.originalCommentBody =
					webhookMetadata.originalCommentBody;
			}
			if (webhookMetadata.shouldReplyInThread !== undefined) {
				session.metadata.shouldReplyInThread =
					webhookMetadata.shouldReplyInThread;
			}
			logger.debug("Thread reply metadata copied to session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				shouldReplyInThread: session.metadata.shouldReplyInThread,
			});
		}

		// Add progress reaction (⏳) to the original comment if this is a thread reply
		if (
			session.metadata?.originalCommentId &&
			session.metadata?.shouldReplyInThread
		) {
			await this.addProgressReaction(
				session.metadata.originalCommentId,
				linearAgentActivitySessionId,
				repository.id,
				session.issueId,
				{
					shouldReplyInThread: session.metadata.shouldReplyInThread,
					originalCommentId: session.metadata.originalCommentId,
				},
			);
		}

		// Post ephemeral "Routing..." thought
		await agentSessionManager.postRoutingThought(linearAgentActivitySessionId);

		// Fetch labels early (needed for label override check)
		const labels = await this.fetchIssueLabels(fullIssue);

		// Check for label overrides BEFORE AI routing
		const debuggerConfig = repository.labelPrompts?.debugger;
		const debuggerLabels = Array.isArray(debuggerConfig)
			? debuggerConfig
			: debuggerConfig?.labels;
		const hasDebuggerLabel = debuggerLabels?.some((label) =>
			labels.includes(label),
		);

		const orchestratorConfig = repository.labelPrompts?.orchestrator;
		const orchestratorLabels = Array.isArray(orchestratorConfig)
			? orchestratorConfig
			: orchestratorConfig?.labels;
		const hasOrchestratorLabel = orchestratorLabels?.some((label) =>
			labels.includes(label),
		);

		let finalProcedure: ProcedureDefinition;
		let finalClassification: RequestClassification;

		// If labels indicate a specific procedure, use that instead of AI routing
		if (hasDebuggerLabel) {
			const debuggerProcedure =
				this.procedureRouter.getProcedure("debugger-full");
			if (!debuggerProcedure) {
				throw new Error("debugger-full procedure not found in registry");
			}
			finalProcedure = debuggerProcedure;
			finalClassification = "debugger";
			logger.info(
				"Using debugger-full procedure due to label (skipping AI routing)",
				{
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					issueIdentifier: fullIssue.identifier,
				},
			);
		} else if (hasOrchestratorLabel) {
			const orchestratorProcedure =
				this.procedureRouter.getProcedure("orchestrator-full");
			if (!orchestratorProcedure) {
				throw new Error("orchestrator-full procedure not found in registry");
			}
			finalProcedure = orchestratorProcedure;
			finalClassification = "orchestrator";
			logger.info(
				"Using orchestrator-full procedure due to label (skipping AI routing)",
				{
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					issueIdentifier: fullIssue.identifier,
				},
			);
		} else {
			// No label override - use AI routing
			const issueDescription =
				`${issue.title}\n\n${fullIssue.description || ""}`.trim();
			const routingDecision =
				await this.procedureRouter.determineRoutine(issueDescription);
			finalProcedure = routingDecision.procedure;
			finalClassification = routingDecision.classification;

			// Log AI routing decision
			logger.info("AI routing decision", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				issueIdentifier: fullIssue.identifier,
				classification: routingDecision.classification,
				procedure: finalProcedure.name,
				reasoning: routingDecision.reasoning,
			});
		}

		// If control mode is enabled, use controlled version of the procedure
		if (this.config.controlMode?.enabled) {
			const controlledProcedureName = `${finalProcedure.name}-controlled`;
			const controlledProcedure = this.procedureRouter.getProcedure(
				controlledProcedureName,
			);

			if (controlledProcedure) {
				logger.info("Control mode enabled, using controlled procedure", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					originalProcedure: finalProcedure.name,
					controlledProcedure: controlledProcedureName,
				});
				finalProcedure = controlledProcedure;
			} else {
				logger.warn("Control mode enabled but controlled procedure not found", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					requestedProcedure: controlledProcedureName,
					fallbackProcedure: finalProcedure.name,
				});
			}
		}

		// Initialize procedure metadata in session with final decision
		this.procedureRouter.initializeProcedureMetadata(session, finalProcedure);

		// Post single procedure selection result (replaces ephemeral routing thought)
		await agentSessionManager.postProcedureSelectionThought(
			linearAgentActivitySessionId,
			finalProcedure.name,
			finalClassification,
		);

		// Only determine system prompt for delegation (not mentions) or when /label-based-prompt is requested
		let systemPrompt: string | undefined;
		let systemPromptVersion: string | undefined;
		let promptType:
			| "debugger"
			| "builder"
			| "scoper"
			| "orchestrator"
			| undefined;

		if (!isMentionTriggered || isLabelBasedPromptRequested) {
			// Determine system prompt based on labels (delegation case or /label-based-prompt command)
			const systemPromptResult = await this.determineSystemPromptFromLabels(
				labels,
				repository,
			);
			systemPrompt = systemPromptResult?.prompt;
			systemPromptVersion = systemPromptResult?.version;
			promptType = systemPromptResult?.type;

			// Post thought about system prompt selection
			if (systemPrompt) {
				await this.postSystemPromptSelectionThought(
					linearAgentActivitySessionId,
					labels,
					repository.id,
				);
			}
		} else {
			logger.debug("Skipping system prompt for mention-triggered session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});
		}

		// Build allowed tools list with Linear MCP tools (now with prompt type context)
		const allowedTools = this.buildAllowedTools(repository, promptType);
		const disallowedTools = this.buildDisallowedTools(repository, promptType);

		// NOTE: We keep mcp__linear even for thread replies because it's needed for:
		// - Editing issue descriptions
		// - Adding/removing labels
		// - Updating issue fields
		// We handle duplicate comment prevention via bot comment tracking instead

		logger.debug("Configured allowed tools", {
			repository: repository.name,
			issueIdentifier: fullIssue.identifier,
			allowedToolsCount: allowedTools.length,
			allowedTools,
		});
		if (disallowedTools.length > 0) {
			logger.debug("Configured disallowed tools", {
				repository: repository.name,
				issueIdentifier: fullIssue.identifier,
				disallowedTools,
			});
		}

		// Create Claude runner with attachment directory access and optional system prompt
		const runnerConfig = this.buildClaudeRunnerConfig(
			session,
			repository,
			linearAgentActivitySessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			undefined, // resumeSessionId
			labels, // Pass labels for model override
		);
		const runner = new ClaudeRunner(runnerConfig);

		// Store runner by comment ID
		agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner);

		// Save state after mapping changes
		await this.savePersistedState();

		// Emit events using full Linear issue
		this.emit("session:started", fullIssue.id, fullIssue, repository.id);
		this.config.handlers?.onSessionStart?.(
			fullIssue.id,
			fullIssue,
			repository.id,
		);

		// Build and start Claude with initial prompt using full issue (streaming mode)
		logger.debug("Building initial prompt for issue", {
			repository: repository.name,
			sessionId: linearAgentActivitySessionId,
			issueIdentifier: fullIssue.identifier,
		});
		try {
			// Choose the appropriate prompt builder based on trigger type and system prompt
			const promptResult =
				isMentionTriggered && isLabelBasedPromptRequested
					? await this.buildLabelBasedPrompt(
							fullIssue,
							repository,
							attachmentResult.manifest,
							guidance,
						)
					: isMentionTriggered
						? await this.buildMentionPrompt(
								fullIssue,
								agentSession,
								attachmentResult.manifest,
								guidance,
							)
						: systemPrompt
							? await this.buildLabelBasedPrompt(
									fullIssue,
									repository,
									attachmentResult.manifest,
									guidance,
								)
							: await this.buildPromptV2(
									fullIssue,
									repository,
									undefined,
									attachmentResult.manifest,
									guidance,
								);

			let { prompt } = promptResult;
			const { version: userPromptVersion } = promptResult;

			// Add thread reply instruction if this is a thread reply session
			if (session.metadata?.shouldReplyInThread) {
				prompt += `\n\n<thread-reply-mode>
IMPORTANT: You are responding in a comment thread.

**DO NOT use mcp__linear to create top-level comments** - I will handle posting your response as a thread reply automatically.

You CAN and SHOULD use mcp__linear for:
- Editing issue descriptions (updateIssue)
- Adding/removing labels
- Updating issue fields (status, priority, etc)

But NEVER use mcp__linear's createComment function - your text response will be posted as a thread reply.
</thread-reply-mode>`;
				logger.debug("Added thread reply mode instruction to prompt", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
				});
			}

			// Update runner with version information
			if (userPromptVersion || systemPromptVersion) {
				runner.updatePromptVersions({
					userPromptVersion,
					systemPromptVersion,
				});
			}

			const promptType =
				isMentionTriggered && isLabelBasedPromptRequested
					? "label-based-prompt-command"
					: isMentionTriggered
						? "mention"
						: systemPrompt
							? "label-based"
							: "fallback";
			logger.info("Initial prompt built successfully", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				promptType,
				promptLength: prompt.length,
			});
			logger.info("Starting Claude streaming session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});
			const sessionInfo = await runner.startStreaming(prompt);
			logger.info("Claude streaming session started", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				claudeSessionId: sessionInfo.sessionId,
			});
			// Note: AgentSessionManager will be initialized automatically when the first system message
			// is received via handleClaudeMessage() callback
		} catch (error) {
			logger.error("Error in prompt building/starting", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				error,
			});
			throw error;
		}
	}

	/**
	 * Handle new comment on issue (updated for comment-based sessions)
	 * @param issue Linear issue object from webhook data
	 * @param comment Linear comment object from webhook data
	 * @param repository Repository configuration
	 */
	private async handleUserPostedAgentActivity(
		webhook: LinearAgentSessionPromptedWebhook,
		repository: RepositoryConfig,
	): Promise<void> {
		// Look for existing session for this comment thread
		const { agentSession } = webhook;
		const linearAgentActivitySessionId = agentSession.id;
		const { issue } = agentSession;

		const commentId = webhook.agentActivity.sourceCommentId;

		// Initialize the agent session in AgentSessionManager
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			logger.error("No agentSessionManager for repository", {
				repository: repository.name,
				repositoryId: repository.id,
			});
			return;
		}

		let session = agentSessionManager.getSession(linearAgentActivitySessionId);
		let isNewSession = false;
		let fullIssue: LinearIssue | null = null;

		if (!session) {
			logger.info("No existing session found, creating new session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});
			isNewSession = true;

			// Post instant acknowledgment for new session creation
			await this.postInstantPromptedAcknowledgment(
				linearAgentActivitySessionId,
				repository.id,
				false,
			);

			// Create the session using the shared method
			const sessionData = await this.createLinearAgentSession(
				linearAgentActivitySessionId,
				issue,
				repository,
				agentSessionManager,
			);

			// Destructure session data for new session
			fullIssue = sessionData.fullIssue;
			session = sessionData.session;

			logger.info("Created new session from prompted webhook", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				issueId: fullIssue.id,
			});

			// Save state and emit events for new session
			await this.savePersistedState();
			this.emit("session:started", fullIssue.id, fullIssue, repository.id);
			this.config.handlers?.onSessionStart?.(
				fullIssue.id,
				fullIssue,
				repository.id,
			);
		} else {
			logger.info("Found existing session for new user prompt", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});

			// Post instant acknowledgment for existing session BEFORE any async work
			// Check streaming status first to determine the message
			const isCurrentlyStreaming =
				session?.claudeRunner?.isStreaming() || false;

			await this.postInstantPromptedAcknowledgment(
				linearAgentActivitySessionId,
				repository.id,
				isCurrentlyStreaming,
			);

			// Need to fetch full issue for routing context
			const linearClient = this.linearClients.get(repository.id);
			if (linearClient) {
				try {
					fullIssue = await retryWithBackoff(
						async () => {
							await this.linearRateLimiter.acquire();
							return linearClient.issue(issue.id);
						},
						{ maxAttempts: 3, initialDelayMs: 1000 },
					);
				} catch (error) {
					logger.warn("Failed to fetch full issue for routing", {
						repository: repository.name,
						issueId: issue.id,
						error,
					});
					// Continue with degraded routing context
				}
			}
		}

		// Check if runner is actively streaming before routing
		const existingRunner = session?.claudeRunner;
		const isStreaming = existingRunner?.isStreaming() || false;

		// Always route procedure for new comments, UNLESS actively streaming
		if (!isStreaming) {
			// Initialize procedure metadata using intelligent routing
			if (!session.metadata) {
				session.metadata = {};
			}

			// Post ephemeral "Routing..." thought
			await agentSessionManager.postRoutingThought(
				linearAgentActivitySessionId,
			);

			// For prompted events, use the actual prompt content from the user
			// Combine with issue context for better routing
			if (!fullIssue) {
				logger.warn("Routing without full issue details", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
				});
			}
			const promptBody = webhook.agentActivity.content.body;
			const routingDecision = await this.procedureRouter.determineRoutine(
				promptBody.trim(),
			);
			const selectedProcedure = routingDecision.procedure;

			// Initialize procedure metadata in session (resets for each new comment)
			this.procedureRouter.initializeProcedureMetadata(
				session,
				selectedProcedure,
			);

			// Post procedure selection result (replaces ephemeral routing thought)
			await agentSessionManager.postProcedureSelectionThought(
				linearAgentActivitySessionId,
				selectedProcedure.name,
				routingDecision.classification,
			);

			// Log routing decision
			logger.info("Routing decision for prompted webhook", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				sessionType: isNewSession ? "new" : "existing",
				classification: routingDecision.classification,
				procedure: selectedProcedure.name,
				reasoning: routingDecision.reasoning,
			});
		} else {
			logger.debug("Skipping routing - runner is actively streaming", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});
		}

		// Ensure session is not null after creation/retrieval
		if (!session) {
			throw new Error(
				`Failed to get or create session for agent activity session ${linearAgentActivitySessionId}`,
			);
		}

		// Acknowledgment already posted above for both new and existing sessions
		// (before any async routing work to ensure instant user feedback)

		// Get Linear client for this repository
		const linearClient = this.linearClients.get(repository.id);
		if (!linearClient) {
			logger.error("No LinearClient found for repository", {
				repository: repository.name,
				repositoryId: repository.id,
			});
			return;
		}

		// Always set up attachments directory, even if no attachments in current comment
		const workspaceFolderName = basename(session.workspace.path);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);
		// Ensure directory exists
		await mkdir(attachmentsDir, { recursive: true });

		let attachmentManifest = "";
		try {
			const result = await linearClient.client.rawRequest(
				`
          query GetComment($id: String!) {
            comment(id: $id) {
              id
              body
              createdAt
              updatedAt
              user {
                name
                id
              }
            }
          }
        `,
				{ id: commentId },
			);

			// Count existing attachments
			const existingFiles = await readdir(attachmentsDir).catch(() => []);
			const existingAttachmentCount = existingFiles.filter(
				(file) => file.startsWith("attachment_") || file.startsWith("image_"),
			).length;

			// Download new attachments from the comment
			const downloadResult = await this.downloadCommentAttachments(
				(result.data as any).comment.body,
				attachmentsDir,
				repository.linearToken,
				existingAttachmentCount,
			);

			if (downloadResult.totalNewAttachments > 0) {
				attachmentManifest = this.generateNewAttachmentManifest(downloadResult);
			}
		} catch (error) {
			logger.error("Failed to fetch comments for attachments", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				error,
			});
		}

		const promptBody = webhook.agentActivity.content.body;
		const stopSignal = webhook.agentActivity.signal === "stop";

		// Handle stop signal
		if (stopSignal) {
			logger.info("Received stop signal for agent activity session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});

			// Stop the existing runner if it's active
			if (existingRunner) {
				existingRunner.stop();
				logger.info("Stopped Claude session", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
				});
			}
			const issueTitle = issue.title || "this issue";
			const stopConfirmation = `I've stopped working on ${issueTitle} as requested.\n\n**Stop Signal:** Received from ${webhook.agentSession.creator?.name || "user"}\n**Action Taken:** All ongoing work has been halted`;

			await agentSessionManager.createResponseActivity(
				linearAgentActivitySessionId,
				stopConfirmation,
			);

			return; // Exit early - stop signal handled
		}

		// Check if there's an existing runner for this comment thread
		if (existingRunner?.isStreaming()) {
			// Add comment with attachment manifest to existing stream
			logger.info("Adding comment to existing stream", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
			});

			// Append attachment manifest to the prompt if we have one
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}

			existingRunner.addStreamMessage(fullPrompt);
			return; // Exit early - comment has been added to stream
		}

		// Use the new resumeClaudeSession function
		try {
			await this.resumeClaudeSession(
				session,
				repository,
				linearAgentActivitySessionId,
				agentSessionManager,
				promptBody,
				attachmentManifest,
				isNewSession,
				[], // No additional allowed directories for regular continuation
			);
		} catch (error) {
			logger.error("Failed to continue conversation", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				error,
			});
			// Remove any partially created session
			// this.sessionManager.removeSession(threadRootCommentId)
			// this.commentToRepo.delete(threadRootCommentId)
			// this.commentToIssue.delete(threadRootCommentId)
			// // Start fresh for root comments, or fall back to issue assignment
			// if (isRootComment) {
			//   await this.handleNewRootComment(issue, comment, repository)
			// } else {
			//   await this.handleIssueAssigned(issue, repository)
			// }
		}
	}

	/**
	 * Handle issue unassignment
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 */
	private async handleIssueUnassigned(
		issue: LinearWebhookIssue,
		repository: RepositoryConfig,
	): Promise<void> {
		const agentSessionManager = this.agentSessionManagers.get(repository.id);
		if (!agentSessionManager) {
			logger.debug("No agentSessionManager for unassigned issue", {
				repository: repository.name,
				issueId: issue.id,
			});
			return;
		}

		// Get all Claude runners for this specific issue
		const claudeRunners = agentSessionManager.getClaudeRunnersForIssue(
			issue.id,
		);

		// Stop all Claude runners for this issue
		const activeThreadCount = claudeRunners.length;
		for (const runner of claudeRunners) {
			logger.info("Stopping Claude runner for unassigned issue", {
				repository: repository.name,
				issueIdentifier: issue.identifier,
			});
			runner.stop();
		}

		// Post ONE farewell comment on the issue (not in any thread) if there were active sessions
		if (activeThreadCount > 0) {
			await this.postComment(
				issue.id,
				"I've been unassigned and am stopping work now.",
				repository.id,
				// No parentId - post as a new comment on the issue
			);
		}

		// Emit events
		logger.info("Stopped sessions for unassigned issue", {
			repository: repository.name,
			issueIdentifier: issue.identifier,
			stoppedSessionCount: activeThreadCount,
		});
	}

	/**
	 * Handle Claude messages
	 */
	private async handleClaudeMessage(
		linearAgentActivitySessionId: string,
		message: SDKMessage,
		repositoryId: string,
	): Promise<void> {
		const repository = this.repositories.get(repositoryId);
		const agentSessionManager = this.agentSessionManagers.get(repositoryId);
		// Integrate with AgentSessionManager to capture streaming messages
		if (agentSessionManager) {
			await agentSessionManager.handleClaudeMessage(
				linearAgentActivitySessionId,
				message,
			);
		}

		// Check if this is the final message indicating session end
		if (message.type === "result") {
			logger.info("Claude session completed, checking if procedure is done", {
				repository: repository?.name || repositoryId,
				sessionId: linearAgentActivitySessionId,
			});

			// Extract response template from select-template subroutine result
			if (agentSessionManager && message.type === "result") {
				const session = agentSessionManager.getSession(
					linearAgentActivitySessionId,
				);
				if (session?.metadata?.procedure) {
					const currentSubroutine =
						session.metadata.procedure.subroutineHistory[
							session.metadata.procedure.subroutineHistory.length - 1
						];
					if (currentSubroutine?.subroutine === "select-template") {
						// Extract JSON from the result message
						try {
							// Get the result string from the message
							const resultContent = (message as any).result || "";
							const jsonMatch = resultContent.match(
								/\{[\s\S]*?"template"[\s\S]*?\}/,
							);
							if (jsonMatch) {
								const selection = JSON.parse(jsonMatch[0]);
								if (selection.template) {
									session.metadata.responseTemplate = selection.template;
									logger.info("Captured response template", {
										repository: repository?.name || repositoryId,
										sessionId: linearAgentActivitySessionId,
										template: selection.template,
										reasoning: selection.reasoning,
									});
								}
							}
						} catch (error) {
							logger.error("Failed to parse select-template result", {
								repository: repository?.name || repositoryId,
								sessionId: linearAgentActivitySessionId,
								error,
							});
						}
					}
				}
			}

			// Check if we already posted thread reply for this session
			if (
				this.sessionCleanup.wasThreadReplyPosted(linearAgentActivitySessionId)
			) {
				logger.info("Thread reply already posted, skipping", {
					repository: repository?.name || repositoryId,
					sessionId: linearAgentActivitySessionId,
				});
				return;
			}

			// Only post thread reply if the ENTIRE procedure is complete (no more subroutines)
			if (agentSessionManager) {
				const session = agentSessionManager.getSession(
					linearAgentActivitySessionId,
				);
				if (session?.metadata?.procedure) {
					// Check if there are more subroutines
					const nextSubroutine =
						this.procedureRouter.getNextSubroutine(session);
					if (nextSubroutine) {
						logger.info("Subroutine completed, more subroutines pending", {
							repository: repository?.name || repositoryId,
							sessionId: linearAgentActivitySessionId,
							nextSubroutine: nextSubroutine.name,
						});
						return; // Don't post thread reply yet, more work to do
					}
				}

				// Log session state before attempting thread reply
				if (session) {
					logger.info("Session completion checkpoint", {
						repository: repository?.name || repositoryId,
						sessionId: linearAgentActivitySessionId,
						issueId: session.issueId,
						shouldReplyInThread: session.metadata?.shouldReplyInThread,
						originalCommentId: session.metadata?.originalCommentId || "NOT SET",
						trackedAsPending: this.unrespondedTracker.isPending(
							linearAgentActivitySessionId,
						),
					});
				}
			}

			logger.info("All subroutines completed, posting thread reply", {
				repository: repository?.name || repositoryId,
				sessionId: linearAgentActivitySessionId,
			});
			// Mark as posted BEFORE posting to prevent race conditions
			this.sessionCleanup.markThreadReplyPosted(linearAgentActivitySessionId);

			// Post thread reply after a short delay to ensure all messages are processed
			this.timeouts.scheduleAnonymous(async () => {
				await this.postThreadReply(linearAgentActivitySessionId, repositoryId);
			}, TIME.TWO_SECONDS);
		}
	}

	/**
	 * Handle Claude session error
	 */
	private async handleClaudeError(error: Error): Promise<void> {
		// Handle AbortError (when Claude Code process is stopped/cancelled)
		if (
			error.name === "AbortError" ||
			error.message?.includes("aborted by user")
		) {
			logger.info(
				"Claude Code session aborted (subroutine transition or user stop)",
				{
					errorName: error.name,
				},
			);
			return; // This is expected behavior when transitioning between subroutines
		}

		// Handle other known error types
		if (error.message?.includes("timeout")) {
			logger.warn("Claude session timeout", {
				error: error.message,
			});
			return;
		}

		// Log unknown errors
		logger.error("Unexpected Claude session error", {
			errorName: error.name,
			errorMessage: error.message,
			stack: error.stack,
		});
	}

	/**
	 * Fetch issue labels for a given issue
	 */
	private async fetchIssueLabels(issue: LinearIssue): Promise<string[]> {
		try {
			const labels = await issue.labels();
			return labels.nodes.map((label) => label.name);
		} catch (error) {
			logger.error("Failed to fetch labels for issue", {
				issueId: issue.id,
				error,
			});
			return [];
		}
	}

	/**
	 * Determine system prompt based on issue labels and repository configuration
	 */
	private async determineSystemPromptFromLabels(
		labels: string[],
		repository: RepositoryConfig,
	): Promise<
		| {
				prompt: string;
				version?: string;
				type?: "debugger" | "builder" | "scoper" | "orchestrator";
		  }
		| undefined
	> {
		if (!repository.labelPrompts || labels.length === 0) {
			return undefined;
		}

		// Check each prompt type for matching labels
		const promptTypes = [
			"debugger",
			"builder",
			"scoper",
			"orchestrator",
		] as const;

		for (const promptType of promptTypes) {
			const promptConfig = repository.labelPrompts[promptType];
			// Handle both old array format and new object format for backward compatibility
			const configuredLabels = Array.isArray(promptConfig)
				? promptConfig
				: promptConfig?.labels;

			if (configuredLabels?.some((label) => labels.includes(label))) {
				try {
					// Load the prompt template from file
					const __filename = fileURLToPath(import.meta.url);
					const __dirname = dirname(__filename);
					const promptPath = join(
						__dirname,
						"..",
						"prompts",
						`${promptType}.md`,
					);
					const promptContent = await readFile(promptPath, "utf-8");
					logger.info("Using label-based system prompt", {
						repository: repository.name,
						promptType,
						labels,
					});

					// Extract and log version tag if present
					const promptVersion = this.extractVersionTag(promptContent);
					if (promptVersion) {
						logger.info("System prompt version detected", {
							repository: repository.name,
							promptType,
							version: promptVersion,
						});
					}

					return {
						prompt: promptContent,
						version: promptVersion,
						type: promptType,
					};
				} catch (error) {
					logger.error("Failed to load prompt template", {
						repository: repository.name,
						promptType,
						error,
					});
					return undefined;
				}
			}
		}

		return undefined;
	}

	/**
	 * Build simplified prompt for label-based workflows
	 * @param issue Full Linear issue
	 * @param repository Repository configuration
	 * @param attachmentManifest Optional attachment manifest
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns Formatted prompt string
	 */
	private async buildLabelBasedPrompt(
		issue: LinearIssue,
		repository: RepositoryConfig,
		attachmentManifest: string = "",
		guidance?: LinearWebhookGuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		logger.info("buildLabelBasedPrompt called", {
			repository: repository.name,
			issueId: issue.id,
			issueIdentifier: issue.identifier,
		});

		try {
			// Load the label-based prompt template
			const __filename = fileURLToPath(import.meta.url);
			const __dirname = dirname(__filename);
			const templatePath = resolve(__dirname, "../label-prompt-template.md");

			logger.debug("Loading label prompt template", {
				repository: repository.name,
				templatePath,
			});
			const template = await readFile(templatePath, "utf-8");
			logger.debug("Template loaded", {
				repository: repository.name,
				templateLength: template.length,
			});

			// Extract and log version tag if present
			const templateVersion = this.extractVersionTag(template);
			if (templateVersion) {
				logger.info("Label prompt template version", {
					repository: repository.name,
					version: templateVersion,
				});
			}

			// Determine the base branch considering parent issues
			const baseBranch = await this.determineBaseBranch(issue, repository);

			// Fetch assignee information
			let assigneeId = "";
			let assigneeName = "";
			try {
				if (issue.assigneeId) {
					assigneeId = issue.assigneeId;
					// Fetch the full assignee object to get the name
					const assignee = await issue.assignee;
					if (assignee) {
						assigneeName = assignee.displayName || assignee.name || "";
					}
				}
			} catch (error) {
				logger.warn("Failed to fetch assignee details", {
					repository: repository.name,
					issueId: issue.id,
					error,
				});
			}

			// Get LinearClient for this repository
			const linearClient = this.linearClients.get(repository.id);
			if (!linearClient) {
				logger.error("No LinearClient found for repository", {
					repository: repository.name,
					repositoryId: repository.id,
				});
				throw new Error(
					`No LinearClient found for repository ${repository.id}`,
				);
			}

			// Fetch workspace teams and labels
			let workspaceTeams = "";
			let workspaceLabels = "";
			try {
				logger.debug("Fetching workspace teams and labels", {
					repository: repository.name,
					repositoryId: repository.id,
				});

				// Fetch teams
				const teamsConnection = await linearClient.teams();
				const teamsArray = [];
				for (const team of teamsConnection.nodes) {
					teamsArray.push({
						id: team.id,
						name: team.name,
						key: team.key,
						description: team.description || "",
						color: team.color,
					});
				}
				workspaceTeams = teamsArray
					.map(
						(team) =>
							`- ${team.name} (${team.key}): ${team.id}${team.description ? ` - ${team.description}` : ""}`,
					)
					.join("\n");

				// Fetch labels
				const labelsConnection = await linearClient.issueLabels();
				const labelsArray = [];
				for (const label of labelsConnection.nodes) {
					labelsArray.push({
						id: label.id,
						name: label.name,
						description: label.description || "",
						color: label.color,
					});
				}
				workspaceLabels = labelsArray
					.map(
						(label) =>
							`- ${label.name}: ${label.id}${label.description ? ` - ${label.description}` : ""}`,
					)
					.join("\n");

				logger.debug("Fetched workspace metadata", {
					repository: repository.name,
					teamsCount: teamsArray.length,
					labelsCount: labelsArray.length,
				});
			} catch (error) {
				logger.warn("Failed to fetch workspace teams and labels", {
					repository: repository.name,
					error,
				});
			}

			// Build the simplified prompt with only essential variables
			let prompt = template
				.replace(/{{repository_name}}/g, repository.name)
				.replace(/{{base_branch}}/g, baseBranch)
				.replace(/{{issue_id}}/g, issue.id || "")
				.replace(/{{issue_identifier}}/g, issue.identifier || "")
				.replace(/{{issue_title}}/g, issue.title || "")
				.replace(
					/{{issue_description}}/g,
					issue.description || "No description provided",
				)
				.replace(/{{issue_url}}/g, issue.url || "")
				.replace(/{{assignee_id}}/g, assigneeId)
				.replace(/{{assignee_name}}/g, assigneeName)
				.replace(/{{workspace_teams}}/g, workspaceTeams)
				.replace(/{{workspace_labels}}/g, workspaceLabels);

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			if (attachmentManifest) {
				logger.debug("Adding attachment manifest to label-based prompt", {
					repository: repository.name,
					manifestLength: attachmentManifest.length,
				});
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			logger.info("Label-based prompt built successfully", {
				repository: repository.name,
				promptLength: prompt.length,
			});
			return { prompt, version: templateVersion };
		} catch (error) {
			logger.error("Error building label-based prompt", {
				repository: repository.name,
				error,
			});
			throw error;
		}
	}

	/**
	 * Build prompt for mention-triggered sessions
	 * @param issue Full Linear issue object
	 * @param repository Repository configuration
	 * @param agentSession The agent session containing the mention
	 * @param attachmentManifest Optional attachment manifest to append
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns The constructed prompt and optional version tag
	 */
	private async buildMentionPrompt(
		issue: LinearIssue,
		agentSession: LinearWebhookAgentSession,
		attachmentManifest: string = "",
		guidance?: LinearWebhookGuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		try {
			logger.info("Building mention prompt", {
				issueId: issue.id,
				issueIdentifier: issue.identifier,
			});

			// Get the mention comment body
			const mentionContent = agentSession.comment?.body || "";

			// Build a simple prompt focused on the mention
			let prompt = `You were mentioned in a Linear comment. Please help with the following request.

<linear_issue>
  <id>${issue.id}</id>
  <identifier>${issue.identifier}</identifier>
  <title>${issue.title}</title>
  <url>${issue.url}</url>
</linear_issue>

<mention_request>
${mentionContent}
</mention_request>

IMPORTANT: You were specifically mentioned in the comment above. Focus on addressing the specific question or request in the mention. You can use the Linear MCP tools to fetch additional context about the issue if needed.`;

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			// Append attachment manifest if any
			if (attachmentManifest) {
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			return { prompt };
		} catch (error) {
			logger.error("Error building mention prompt", {
				issueId: issue.id,
				error,
			});
			throw error;
		}
	}

	/**
	 * Extract version tag from template content
	 * @param templateContent The template content to parse
	 * @returns The version value if found, undefined otherwise
	 */
	private extractVersionTag(templateContent: string): string | undefined {
		// Match the version tag pattern: <version-tag value="..." />
		const versionTagMatch = templateContent.match(
			/<version-tag\s+value="([^"]*)"\s*\/>/i,
		);
		const version = versionTagMatch ? versionTagMatch[1] : undefined;
		// Return undefined for empty strings
		return version?.trim() ? version : undefined;
	}

	/**
	 * Format agent guidance rules as markdown for injection into prompts
	 * @param guidance Array of guidance rules from Linear
	 * @returns Formatted markdown string with guidance, or empty string if no guidance
	 */
	private formatAgentGuidance(guidance?: LinearWebhookGuidanceRule[]): string {
		if (!guidance || guidance.length === 0) {
			return "";
		}

		let formatted =
			"\n\n<agent_guidance>\nThe following guidance has been configured for this workspace/team in Linear. Team-specific guidance takes precedence over workspace-level guidance.\n";

		for (const rule of guidance) {
			let origin = "Global";
			if (rule.origin) {
				if (rule.origin.__typename === "TeamOriginWebhookPayload") {
					origin = `Team (${rule.origin.team.displayName})`;
				} else {
					origin = "Organization";
				}
			}
			formatted += `\n## Guidance from ${origin}\n${rule.body}\n`;
		}

		formatted += "\n</agent_guidance>";
		return formatted;
	}

	/**
	 * Check if a branch exists locally or remotely
	 */
	private async branchExists(
		branchName: string,
		repoPath: string,
	): Promise<boolean> {
		const { execSync } = await import("node:child_process");
		try {
			// Check if branch exists locally
			execSync(`git rev-parse --verify "${branchName}"`, {
				cwd: repoPath,
				stdio: "pipe",
			});
			return true;
		} catch {
			// Branch doesn't exist locally, check remote
			try {
				execSync(`git ls-remote --heads origin "${branchName}"`, {
					cwd: repoPath,
					stdio: "pipe",
				});
				return true;
			} catch {
				// Branch doesn't exist remotely either
				return false;
			}
		}
	}

	/**
	 * Determine the base branch for an issue, considering parent issues
	 */
	private async determineBaseBranch(
		issue: LinearIssue,
		repository: RepositoryConfig,
	): Promise<string> {
		// Start with the repository's default base branch
		let baseBranch = repository.baseBranch;

		// Check if issue has a parent
		try {
			const parent = await issue.parent;
			if (parent) {
				logger.debug("Issue has parent", {
					repository: repository.name,
					issueIdentifier: issue.identifier,
					parentIdentifier: parent.identifier,
				});

				// Get parent's branch name
				const parentRawBranchName =
					parent.branchName ||
					`${parent.identifier}-${parent.title
						?.toLowerCase()
						.replace(/\s+/g, "-")
						.substring(0, 30)}`;
				const parentBranchName = this.sanitizeBranchName(parentRawBranchName);

				// Check if parent branch exists
				const parentBranchExists = await this.branchExists(
					parentBranchName,
					repository.repositoryPath,
				);

				if (parentBranchExists) {
					baseBranch = parentBranchName;
					logger.info("Using parent issue branch as base", {
						repository: repository.name,
						issueIdentifier: issue.identifier,
						parentBranch: parentBranchName,
					});
				} else {
					logger.debug("Parent branch not found, using default", {
						repository: repository.name,
						parentBranch: parentBranchName,
						defaultBranch: repository.baseBranch,
					});
				}
			}
		} catch (_error) {
			// Parent field might not exist or couldn't be fetched, use default base branch
			logger.debug("No parent issue found, using default base branch", {
				repository: repository.name,
				issueIdentifier: issue.identifier,
				defaultBranch: repository.baseBranch,
			});
		}

		return baseBranch;
	}

	/**
	 * Convert full Linear SDK issue to CoreIssue interface for Session creation
	 */
	private convertLinearIssueToCore(issue: LinearIssue): IssueMinimal {
		return {
			id: issue.id,
			identifier: issue.identifier,
			title: issue.title || "",
			description: issue.description || undefined,
			branchName: issue.branchName, // Use the real branchName property!
		};
	}

	/**
	 * Sanitize branch name by removing backticks to prevent command injection
	 */
	private sanitizeBranchName(name: string): string {
		return name ? name.replace(/`/g, "") : name;
	}

	/**
	 * Format Linear comments into a threaded structure that mirrors the Linear UI
	 * @param comments Array of Linear comments
	 * @returns Formatted string showing comment threads
	 */
	private async formatCommentThreads(comments: Comment[]): Promise<string> {
		if (comments.length === 0) {
			return "No comments yet.";
		}

		// Group comments by thread (root comments and their replies)
		const threads = new Map<string, { root: Comment; replies: Comment[] }>();
		const rootComments: Comment[] = [];

		// First pass: identify root comments and create thread structure
		for (const comment of comments) {
			const parent = await comment.parent;
			if (!parent) {
				// This is a root comment
				rootComments.push(comment);
				threads.set(comment.id, { root: comment, replies: [] });
			}
		}

		// Second pass: assign replies to their threads
		for (const comment of comments) {
			const parent = await comment.parent;
			if (parent?.id) {
				const thread = threads.get(parent.id);
				if (thread) {
					thread.replies.push(comment);
				}
			}
		}

		// Format threads in chronological order
		const formattedThreads: string[] = [];

		for (const rootComment of rootComments) {
			const thread = threads.get(rootComment.id);
			if (!thread) continue;

			// Format root comment
			const rootUser = await rootComment.user;
			const rootAuthor =
				rootUser?.displayName || rootUser?.name || rootUser?.email || "Unknown";
			const rootTime = new Date(rootComment.createdAt).toLocaleString();

			let threadText = `<comment_thread>
	<root_comment>
		<author>@${rootAuthor}</author>
		<timestamp>${rootTime}</timestamp>
		<content>
${rootComment.body}
		</content>
	</root_comment>`;

			// Format replies if any
			if (thread.replies.length > 0) {
				threadText += "\n  <replies>";
				for (const reply of thread.replies) {
					const replyUser = await reply.user;
					const replyAuthor =
						replyUser?.displayName ||
						replyUser?.name ||
						replyUser?.email ||
						"Unknown";
					const replyTime = new Date(reply.createdAt).toLocaleString();

					threadText += `
		<reply>
			<author>@${replyAuthor}</author>
			<timestamp>${replyTime}</timestamp>
			<content>
${reply.body}
			</content>
		</reply>`;
				}
				threadText += "\n  </replies>";
			}

			threadText += "\n</comment_thread>";
			formattedThreads.push(threadText);
		}

		return formattedThreads.join("\n\n");
	}

	/**
	 * Build a prompt for Claude using the improved XML-style template
	 * @param issue Full Linear issue
	 * @param repository Repository configuration
	 * @param newComment Optional new comment to focus on (for handleNewRootComment)
	 * @param attachmentManifest Optional attachment manifest
	 * @param guidance Optional agent guidance rules from Linear
	 * @returns Formatted prompt string
	 */
	private async buildPromptV2(
		issue: LinearIssue,
		repository: RepositoryConfig,
		newComment?: LinearWebhookComment,
		attachmentManifest: string = "",
		guidance?: LinearWebhookGuidanceRule[],
	): Promise<{ prompt: string; version?: string }> {
		logger.debug("buildPromptV2 called", {
			repository: repository.name,
			issueIdentifier: issue.identifier,
			hasNewComment: !!newComment,
			hasAttachments: !!attachmentManifest,
			hasGuidance: !!guidance?.length,
		});

		try {
			// Use custom template if provided (repository-specific takes precedence)
			let templatePath =
				repository.promptTemplatePath ||
				this.config.features?.promptTemplatePath;

			// If no custom template, use the v2 template
			if (!templatePath) {
				const __filename = fileURLToPath(import.meta.url);
				const __dirname = dirname(__filename);
				templatePath = resolve(__dirname, "../prompt-template-v2.md");
			}

			// Load the template
			logger.debug("Loading prompt template", {
				repository: repository.name,
				templatePath,
			});
			const template = await readFile(templatePath, "utf-8");
			logger.debug("Template loaded", {
				repository: repository.name,
				templateLength: template.length,
			});

			// Extract and log version tag if present
			const templateVersion = this.extractVersionTag(template);
			if (templateVersion) {
				logger.debug("Prompt template version", {
					repository: repository.name,
					templateVersion,
				});
			}

			// Get state name from Linear API
			const state = await issue.state;
			const stateName = state?.name || "Unknown";

			// Determine the base branch considering parent issues
			const baseBranch = await this.determineBaseBranch(issue, repository);

			// Get formatted comment threads
			const linearClient = this.linearClients.get(repository.id);
			let commentThreads = "No comments yet.";

			if (linearClient && issue.id) {
				try {
					logger.debug("Fetching comments for issue", {
						repository: repository.name,
						issueIdentifier: issue.identifier,
					});
					const comments = await linearClient.comments({
						filter: { issue: { id: { eq: issue.id } } },
					});

					const commentNodes = comments.nodes;
					if (commentNodes.length > 0) {
						commentThreads = await this.formatCommentThreads(commentNodes);
						logger.debug("Formatted comments into threads", {
							repository: repository.name,
							issueId: issue.id,
							commentCount: commentNodes.length,
						});
					}
				} catch (error) {
					logger.error("Failed to fetch comments", {
						repository: repository.name,
						issueId: issue.id,
						error,
					});
				}
			}

			// Build the prompt with all variables
			let prompt = template
				.replace(/{{repository_name}}/g, repository.name)
				.replace(/{{issue_id}}/g, issue.id || "")
				.replace(/{{issue_identifier}}/g, issue.identifier || "")
				.replace(/{{issue_title}}/g, issue.title || "")
				.replace(
					/{{issue_description}}/g,
					issue.description || "No description provided",
				)
				.replace(/{{issue_state}}/g, stateName)
				.replace(/{{issue_priority}}/g, issue.priority?.toString() || "None")
				.replace(/{{issue_url}}/g, issue.url || "")
				.replace(/{{comment_threads}}/g, commentThreads)
				.replace(
					/{{working_directory}}/g,
					this.config.handlers?.createWorkspace
						? "Will be created based on issue"
						: repository.repositoryPath,
				)
				.replace(/{{base_branch}}/g, baseBranch)
				.replace(/{{branch_name}}/g, this.sanitizeBranchName(issue.branchName));

			// Handle the optional new comment section
			if (newComment) {
				// Replace the conditional block
				const newCommentSection = `<new_comment_to_address>
	<author>{{new_comment_author}}</author>
	<timestamp>{{new_comment_timestamp}}</timestamp>
	<content>
{{new_comment_content}}
	</content>
</new_comment_to_address>

IMPORTANT: Focus specifically on addressing the new comment above. This is a new request that requires your attention.`;

				prompt = prompt.replace(
					/{{#if new_comment}}[\s\S]*?{{\/if}}/g,
					newCommentSection,
				);

				// Now replace the new comment variables
				// We'll need to fetch the comment author
				let authorName = "Unknown";
				if (linearClient) {
					try {
						const fullComment = await retryWithBackoff(
							async () => {
								await this.linearRateLimiter.acquire();
								return linearClient.comment({
									id: newComment.id,
								});
							},
							{ maxAttempts: 3, initialDelayMs: 1000 },
						);
						const user = await fullComment.user;
						authorName =
							user?.displayName || user?.name || user?.email || "Unknown";
					} catch (error) {
						logger.error("Failed to fetch comment author", {
							repository: repository.name,
							commentId: newComment.id,
							error,
						});
					}
				}

				prompt = prompt
					.replace(/{{new_comment_author}}/g, authorName)
					.replace(/{{new_comment_timestamp}}/g, new Date().toLocaleString())
					.replace(/{{new_comment_content}}/g, newComment.body || "");
			} else {
				// Remove the new comment section entirely
				prompt = prompt.replace(/{{#if new_comment}}[\s\S]*?{{\/if}}/g, "");
			}

			// Append agent guidance if present
			prompt += this.formatAgentGuidance(guidance);

			// Append attachment manifest if provided
			if (attachmentManifest) {
				logger.debug("Adding attachment manifest", {
					repository: repository.name,
					manifestLength: attachmentManifest.length,
				});
				prompt = `${prompt}\n\n${attachmentManifest}`;
			}

			// Append repository-specific instruction if provided
			if (repository.appendInstruction) {
				logger.debug("Adding repository-specific instruction", {
					repository: repository.name,
				});
				prompt = `${prompt}\n\n<repository-specific-instruction>\n${repository.appendInstruction}\n</repository-specific-instruction>`;
			}

			logger.info("Final prompt built", {
				repository: repository.name,
				promptLength: prompt.length,
			});
			return { prompt, version: templateVersion };
		} catch (error) {
			logger.error("Failed to load prompt template", {
				repository: repository.name,
				error,
			});

			// Fallback to simple prompt
			const state = await issue.state;
			const stateName = state?.name || "Unknown";

			// Determine the base branch considering parent issues
			const baseBranch = await this.determineBaseBranch(issue, repository);

			const fallbackPrompt = `Please help me with the following Linear issue:

Repository: ${repository.name}
Issue: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || "No description provided"}
State: ${stateName}
Priority: ${issue.priority?.toString() || "None"}
Branch: ${issue.branchName}

Working directory: ${repository.repositoryPath}
Base branch: ${baseBranch}

${newComment ? `New comment to address:\n${newComment.body}\n\n` : ""}Please analyze this issue and help implement a solution.`;

			return { prompt: fallbackPrompt, version: undefined };
		}
	}

	/**
	 * Get connection status by repository ID
	 */
	getConnectionStatus(): Map<string, boolean> {
		const status = new Map<string, boolean>();
		for (const [repoId, client] of this.ndjsonClients) {
			status.set(repoId, client.isConnected());
		}
		return status;
	}

	/**
	 * Get NDJSON client by token (for testing purposes)
	 * @internal
	 */
	_getClientByToken(token: string): any {
		for (const [repoId, client] of this.ndjsonClients) {
			const repo = this.repositories.get(repoId);
			if (repo?.linearToken === token) {
				return client;
			}
		}
		return undefined;
	}

	/**
	 * Start OAuth flow using the shared application server
	 */
	async startOAuthFlow(proxyUrl?: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		const oauthProxyUrl = proxyUrl || this.config.proxyUrl;
		return this.sharedApplicationServer.startOAuthFlow(oauthProxyUrl);
	}

	/**
	 * Get the server port
	 */
	getServerPort(): number {
		return this.config.serverPort || this.config.webhookPort || 3456;
	}

	/**
	 * Get the OAuth callback URL
	 */
	getOAuthCallbackUrl(): string {
		return this.sharedApplicationServer.getOAuthCallbackUrl();
	}

	/**
	 * Post initial comment when assigned to issue
	 */
	// private async postInitialComment(issueId: string, repositoryId: string): Promise<void> {
	//   const body = "I'm getting started right away."
	//   // Get the Linear client for this repository
	//   const linearClient = this.linearClients.get(repositoryId)
	//   if (!linearClient) {
	//     throw new Error(`No Linear client found for repository ${repositoryId}`)
	//   }
	//   const commentData = {
	//     issueId,
	//     body
	//   }
	//   await linearClient.createComment(commentData)
	// }

	/**
	 * Post a comment to Linear
	 */
	private async postComment(
		issueId: string,
		body: string,
		repositoryId: string,
		parentId?: string,
	): Promise<void> {
		// Get the Linear client for this repository
		const linearClient = this.linearClients.get(repositoryId);
		if (!linearClient) {
			throw new Error(`No Linear client found for repository ${repositoryId}`);
		}
		const commentData: { issueId: string; body: string; parentId?: string } = {
			issueId,
			body,
		};
		// Add parent ID if provided (for reply)
		if (parentId) {
			commentData.parentId = parentId;
		}
		const result = await retryWithBackoff(
			async () => {
				await this.linearRateLimiter.acquire();
				return linearClient.createComment(commentData);
			},
			{
				maxAttempts: 3,
				initialDelayMs: 1000,
				onRetry: (attempt, error) => {
					logger.warn("Retrying createComment", {
						attempt,
						maxAttempts: 3,
						error: error.message,
					});
				},
			},
		);

		// Track this comment as bot-created to prevent responding to it
		const comment = await result.comment;
		if (comment?.id) {
			// SessionCleanupManager handles TTL-based cleanup automatically
			this.sessionCleanup.addRecentBotComment(comment.id);
			this.sessionCleanup.addBotParentComment(comment.id);
			logger.debug(
				"Tracked bot comment to prevent loop and detect thread replies",
				{
					commentId: comment.id,
				},
			);

			// Also track bot userId if available
			const user = await comment.user;
			if (user?.id) {
				this.botUserIds.add(user.id);
			}
		}
	}

	/**
	 * Add a progress reaction (⏳) to a comment
	 * Returns the reaction ID for later removal
	 */
	private async addProgressReaction(
		commentId: string,
		sessionId: string,
		repositoryId: string,
		issueId: string,
		metadata: {
			shouldReplyInThread: boolean;
			originalCommentId?: string;
		},
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				logger.error("No Linear client found for repository", {
					repositoryId,
				});
				return;
			}

			// Create reaction with ⏳ emoji using GraphQL
			const mutation = `
				mutation ReactionCreate($input: ReactionCreateInput!) {
					reactionCreate(input: $input) {
						reaction {
							id
						}
					}
				}
			`;

			const result = await retryWithBackoff(
				async () => {
					await this.linearRateLimiter.acquire();
					return (linearClient as any).client.request(mutation, {
						input: {
							commentId,
							emoji: "⏳",
						},
					});
				},
				{
					maxAttempts: 3,
					initialDelayMs: 500,
					onRetry: (attempt, error) => {
						logger.warn("Retrying progress reaction", {
							attempt,
							maxAttempts: 3,
							commentId,
							error: error.message,
						});
					},
				},
			);

			const reaction = result?.reactionCreate?.reaction;
			if (reaction?.id) {
				// Store reaction ID for later removal
				this.sessionCleanup.setSessionReaction(sessionId, reaction.id);
				logger.debug("Added progress reaction to comment", {
					commentId,
					reactionId: reaction.id,
					sessionId,
				});

				// Track message as pending response
				this.unrespondedTracker.markPending(
					sessionId,
					commentId,
					issueId,
					repositoryId,
					metadata,
					reaction.id,
				);
			}
		} catch (error) {
			logger.error("Failed to add progress reaction to comment", {
				commentId,
				sessionId,
				error,
			});
		}
	}

	/**
	 * Replace progress reaction with success reaction
	 * Removes ⏳ and adds ✅
	 */
	private async replaceWithSuccessReaction(
		commentId: string,
		sessionId: string,
		repositoryId: string,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				logger.error("No Linear client found for repository", {
					repositoryId,
				});
				return;
			}

			// Remove progress reaction if it exists
			const progressReactionId =
				this.sessionCleanup.getSessionReaction(sessionId);
			if (progressReactionId) {
				try {
					const deleteMutation = `
						mutation ReactionDelete($id: String!) {
							reactionDelete(id: $id) {
								success
							}
						}
					`;

					await (linearClient as any).client.request(deleteMutation, {
						id: progressReactionId,
					});

					logger.debug("Removed progress reaction", {
						reactionId: progressReactionId,
						sessionId,
					});
					this.sessionCleanup.deleteSessionReaction(sessionId);
				} catch (error) {
					logger.error("Failed to remove progress reaction", {
						reactionId: progressReactionId,
						sessionId,
						error,
					});
				}
			}

			// Add success reaction using GraphQL
			const successMutation = `
				mutation ReactionCreate($input: ReactionCreateInput!) {
					reactionCreate(input: $input) {
						reaction {
							id
						}
					}
				}
			`;

			const result = await retryWithBackoff(
				async () => {
					await this.linearRateLimiter.acquire();
					return (linearClient as any).client.request(successMutation, {
						input: {
							commentId,
							emoji: "✅",
						},
					});
				},
				{
					maxAttempts: 3,
					initialDelayMs: 500,
					onRetry: (attempt, error) => {
						logger.warn("Retrying success reaction", {
							attempt,
							maxAttempts: 3,
							commentId,
							error: error.message,
						});
					},
				},
			);

			const reaction = result?.reactionCreate?.reaction;
			if (reaction?.id) {
				logger.debug("Added success reaction to comment", {
					commentId,
					reactionId: reaction.id,
					sessionId,
				});

				// Removed: vestigial setTimeout that did nothing
			}
		} catch (error) {
			logger.error("Failed to add success reaction to comment", {
				commentId,
				sessionId,
				error,
			});
		}
	}

	/**
	 * Post automatic thread reply when session completes
	 * Generates an intelligent summary based on the work done
	 */
	async postThreadReply(
		linearAgentActivitySessionId: string,
		repositoryId: string,
	): Promise<void> {
		const agentSessionManager = this.agentSessionManagers.get(repositoryId);
		if (!agentSessionManager) {
			logger.error("No agent session manager found for repository", {
				repositoryId,
			});
			return;
		}

		const session = agentSessionManager.getSession(
			linearAgentActivitySessionId,
		);
		if (!session) {
			logger.error("Session not found", {
				sessionId: linearAgentActivitySessionId,
			});
			return;
		}

		// Verify session can reply using ResponseVerifier
		const verification = ResponseVerifier.verifySessionCanReply({
			sessionId: linearAgentActivitySessionId,
			issueId: session.issueId,
			metadata: session.metadata,
			status: session.status,
		});

		ResponseVerifier.logVerification(
			linearAgentActivitySessionId,
			verification,
		);

		if (!verification.canReply) {
			logger.error("Session CANNOT reply in thread", {
				sessionId: linearAgentActivitySessionId,
				diagnostics: ResponseVerifier.generateDiagnostics({
					sessionId: linearAgentActivitySessionId,
					issueId: session.issueId,
					metadata: session.metadata,
					status: session.status,
				}),
			});

			// Mark as responded with failure
			this.unrespondedTracker.markResponded(
				linearAgentActivitySessionId,
				false,
			);
			return;
		}

		// Check if should reply in thread
		if (!session.metadata?.shouldReplyInThread) {
			logger.debug("Session doesn't need thread reply, skipping", {
				sessionId: linearAgentActivitySessionId,
			});
			return;
		}

		const originalCommentId = session.metadata.originalCommentId;

		if (!originalCommentId) {
			logger.error("Session missing originalCommentId", {
				sessionId: linearAgentActivitySessionId,
			});
			return;
		}

		logger.debug("Generating thread reply for session", {
			sessionId: linearAgentActivitySessionId,
			repositoryId,
		});

		// Get Linear client to fetch comment details
		const linearClient = this.linearClients.get(repositoryId);
		if (!linearClient) {
			logger.error("No Linear client found for repository", {
				repositoryId,
			});
			return;
		}

		// Determine the correct parentId for the reply
		// Linear requires replies to use the TOP-LEVEL comment ID, not nested reply IDs
		let parentIdForReply = originalCommentId; // Default fallback
		try {
			const originalComment = await retryWithBackoff(
				async () => {
					await this.linearRateLimiter.acquire();
					return linearClient.comment({ id: originalCommentId });
				},
				{ maxAttempts: 3, initialDelayMs: 1000 },
			);
			const parentCommentId = await originalComment.parent;

			if (parentCommentId) {
				// Original comment is already a reply, use its parent (the top-level comment)
				const parentId = parentCommentId.id;
				if (parentId) {
					parentIdForReply = parentId;
					logger.debug(
						"Original comment is nested reply, using top-level parent",
						{
							originalCommentId,
							topLevelParentId: parentIdForReply,
						},
					);
				} else {
					logger.warn("Parent comment ID is null/undefined, using fallback", {
						originalCommentId,
					});
				}
			} else {
				// Original comment is top-level, use it as parent
				logger.debug("Original comment is top-level, using it as parent", {
					originalCommentId,
				});
			}
		} catch (error) {
			logger.error("Failed to fetch parent comment info, using fallback", {
				originalCommentId,
				error,
			});
			// Ensure we still have a valid fallback
			if (!originalCommentId) {
				logger.error(
					"CRITICAL: No valid parentId available! Cannot post thread reply",
				);
				return;
			}
		}

		try {
			// Get all entries from the session to build summary
			const entries =
				agentSessionManager.getEntriesForSession(
					linearAgentActivitySessionId,
				) || [];

			// Extract key information from entries
			const assistantMessages = entries
				.filter(
					(e: CyrusAgentSessionEntry) =>
						e.type === "assistant" && !e.metadata?.toolUseId,
				)
				.map((e: CyrusAgentSessionEntry) => e.content);

			// Get the summary from the last assistant message
			// The concise-summary subroutine will generate a short response (max 200 chars)
			let responseBody: string;

			if (assistantMessages.length > 0) {
				// Use the last assistant message (from concise-summary subroutine)
				responseBody =
					assistantMessages[assistantMessages.length - 1] ||
					"✅ Tarefa concluída.";
			} else {
				responseBody = "✅ Tarefa concluída.";
			}

			// CRITICAL: Validate that we have a parentId before posting
			// This ensures we ALWAYS reply in thread, never create top-level comments
			if (!parentIdForReply) {
				logger.error("ERROR: Cannot post thread reply - no parentId found!", {
					sessionId: linearAgentActivitySessionId,
					originalCommentId,
				});
				return;
			}

			logger.debug("Posting thread reply", {
				sessionId: linearAgentActivitySessionId,
				parentId: parentIdForReply,
			});

			// Post the reply using the correct parent ID (top-level comment)
			await this.postComment(
				session.issueId,
				responseBody,
				repositoryId,
				parentIdForReply,
			);

			logger.info("Posted thread reply for session", {
				sessionId: linearAgentActivitySessionId,
				parentId: parentIdForReply,
			});

			// Replace progress reaction with success reaction (⏳ → ✅)
			if (
				session.metadata?.originalCommentId &&
				session.metadata?.shouldReplyInThread
			) {
				await this.replaceWithSuccessReaction(
					session.metadata.originalCommentId,
					linearAgentActivitySessionId,
					repositoryId,
				);
			}

			// Mark message as responded in tracker
			this.unrespondedTracker.markResponded(linearAgentActivitySessionId, true);

			// Clean up the flag after 5 minutes to prevent memory leak
			this.timeouts.schedule(
				`cleanup-threadreply-${linearAgentActivitySessionId}`,
				() => {
					this.sessionCleanup.deleteThreadReplyPosted(
						linearAgentActivitySessionId,
					);
				},
				TIME.FIVE_MINUTES,
			);
		} catch (error) {
			logger.error("Failed to post thread reply for session", {
				sessionId: linearAgentActivitySessionId,
				error,
			});
			// Remove flag on error so it can be retried if needed
			this.sessionCleanup.deleteThreadReplyPosted(linearAgentActivitySessionId);

			// Mark as responded with failure
			this.unrespondedTracker.markResponded(
				linearAgentActivitySessionId,
				false,
			);
		}
	}

	/**
	 * Format todos as Linear checklist markdown
	 */
	// private formatTodosAsChecklist(todos: Array<{id: string, content: string, status: string, priority: string}>): string {
	//   return todos.map(todo => {
	//     const checkbox = todo.status === 'completed' ? '[x]' : '[ ]'
	//     const statusEmoji = todo.status === 'in_progress' ? ' 🔄' : ''
	//     return `- ${checkbox} ${todo.content}${statusEmoji}`
	//   }).join('\n')
	// }

	/**
	 * Extract attachment URLs from text (issue description or comment)
	 */
	private extractAttachmentUrls(text: string): string[] {
		if (!text) return [];

		// Match URLs that start with https://uploads.linear.app
		// Exclude brackets and parentheses to avoid capturing malformed markdown link syntax
		const regex = /https:\/\/uploads\.linear\.app\/[a-zA-Z0-9/_.-]+/gi;
		const matches = text.match(regex) || [];

		// Remove duplicates
		return [...new Set(matches)];
	}

	/**
	 * Download attachments from Linear issue
	 * @param issue Linear issue object from webhook data
	 * @param repository Repository configuration
	 * @param workspacePath Path to workspace directory
	 */
	private async downloadIssueAttachments(
		issue: LinearIssue,
		repository: RepositoryConfig,
		workspacePath: string,
	): Promise<{ manifest: string; attachmentsDir: string | null }> {
		// Create attachments directory in home directory
		const workspaceFolderName = basename(workspacePath);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);

		try {
			const attachmentMap: Record<string, string> = {};
			const imageMap: Record<string, string> = {};
			let attachmentCount = 0;
			let imageCount = 0;
			let skippedCount = 0;
			let failedCount = 0;
			const maxAttachments = 20;

			// Ensure directory exists
			await mkdir(attachmentsDir, { recursive: true });

			// Extract URLs from issue description
			const descriptionUrls = this.extractAttachmentUrls(
				issue.description || "",
			);

			// Extract URLs from comments if available
			const commentUrls: string[] = [];
			const linearClient = this.linearClients.get(repository.id);

			// Fetch native Linear attachments (e.g., Sentry links)
			const nativeAttachments: Array<{ title: string; url: string }> = [];
			if (linearClient && issue.id) {
				// OPTIMIZATION: Fetch attachments and comments in parallel (2x faster)
				logger.debug("Fetching native attachments and comments in parallel", {
					repository: repository.name,
					issueIdentifier: issue.identifier,
				});

				const [attachmentsResult, commentsResult] = await Promise.allSettled([
					issue.attachments(),
					linearClient.comments({
						filter: { issue: { id: { eq: issue.id } } },
					}),
				]);

				// Process attachments result
				if (attachmentsResult.status === "fulfilled") {
					const attachments = attachmentsResult.value;
					if (attachments?.nodes) {
						for (const attachment of attachments.nodes) {
							nativeAttachments.push({
								title: attachment.title || "Untitled attachment",
								url: attachment.url,
							});
						}
						logger.debug("Found native attachments", {
							repository: repository.name,
							count: nativeAttachments.length,
						});
					}
				} else {
					logger.error("Failed to fetch native attachments", {
						repository: repository.name,
						error: attachmentsResult.reason,
					});
				}

				// Process comments result
				if (commentsResult.status === "fulfilled") {
					const comments = commentsResult.value;
					const commentNodes = comments.nodes;
					for (const comment of commentNodes) {
						const urls = this.extractAttachmentUrls(comment.body);
						commentUrls.push(...urls);
					}
				} else {
					logger.error("Failed to fetch comments for attachments", {
						repository: repository.name,
						error: commentsResult.reason,
					});
				}
			}

			// Combine and deduplicate all URLs
			const allUrls = [...new Set([...descriptionUrls, ...commentUrls])];

			logger.debug("Found unique attachment URLs", {
				repository: repository.name,
				issueIdentifier: issue.identifier,
				count: allUrls.length,
			});

			if (allUrls.length > maxAttachments) {
				logger.warn("Limiting attachments to maximum", {
					repository: repository.name,
					found: allUrls.length,
					maxAttachments,
					skipping: allUrls.length - maxAttachments,
				});
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

				const result = await this.downloadAttachment(
					url,
					tempPath,
					repository.linearToken,
				);

				if (result.success) {
					// Determine the final filename based on type
					let finalFilename: string;
					if (result.isImage) {
						imageCount++;
						finalFilename = `image_${imageCount}${result.fileType || ".png"}`;
					} else {
						finalFilename = `attachment_${attachmentCount + 1}${result.fileType || ""}`;
					}

					const finalPath = join(attachmentsDir, finalFilename);

					// Rename the file to include the correct extension
					await rename(tempPath, finalPath);

					// Store in appropriate map
					if (result.isImage) {
						imageMap[url] = finalPath;
					} else {
						attachmentMap[url] = finalPath;
					}
					attachmentCount++;
				} else {
					failedCount++;
					logger.warn("Failed to download attachment", {
						repository: repository.name,
						url,
					});
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
				failed: failedCount,
				nativeAttachments,
			});

			// Always return the attachments directory path (it's pre-created)
			return {
				manifest,
				attachmentsDir: attachmentsDir,
			};
		} catch (error) {
			logger.error("Error downloading attachments", {
				repository: repository.name,
				error,
			});
			// Still return the attachments directory even on error
			return { manifest: "", attachmentsDir: attachmentsDir };
		}
	}

	/**
	 * Download a single attachment from Linear
	 */
	private async downloadAttachment(
		attachmentUrl: string,
		destinationPath: string,
		linearToken: string,
	): Promise<{ success: boolean; fileType?: string; isImage?: boolean }> {
		try {
			logger.debug("Downloading attachment", {
				url: attachmentUrl,
			});

			const response = await fetch(attachmentUrl, {
				headers: {
					Authorization: `Bearer ${linearToken}`,
				},
			});

			if (!response.ok) {
				logger.error("Attachment download failed", {
					url: attachmentUrl,
					status: response.status,
					statusText: response.statusText,
				});
				return { success: false };
			}

			const buffer = Buffer.from(await response.arrayBuffer());

			// Detect the file type from the buffer
			const fileType = await fileTypeFromBuffer(buffer);
			let detectedExtension: string | undefined;
			let isImage = false;

			if (fileType) {
				detectedExtension = `.${fileType.ext}`;
				isImage = fileType.mime.startsWith("image/");
				logger.debug("Detected file type", {
					mime: fileType.mime,
					extension: fileType.ext,
					isImage,
				});
			} else {
				// Try to get extension from URL
				const urlPath = new URL(attachmentUrl).pathname;
				const urlExt = extname(urlPath);
				if (urlExt) {
					detectedExtension = urlExt;
					logger.debug("Using extension from URL", {
						extension: detectedExtension,
					});
				}
			}

			// Write the attachment to disk
			await writeFile(destinationPath, buffer);

			logger.debug("Successfully downloaded attachment", {
				destinationPath,
			});
			return { success: true, fileType: detectedExtension, isImage };
		} catch (error) {
			logger.error("Error downloading attachment", {
				url: attachmentUrl,
				error,
			});
			return { success: false };
		}
	}

	/**
	 * Download attachments from a specific comment
	 * @param commentBody The body text of the comment
	 * @param attachmentsDir Directory where attachments should be saved
	 * @param linearToken Linear API token
	 * @param existingAttachmentCount Current number of attachments already downloaded
	 */
	private async downloadCommentAttachments(
		commentBody: string,
		attachmentsDir: string,
		linearToken: string,
		existingAttachmentCount: number,
	): Promise<{
		newAttachmentMap: Record<string, string>;
		newImageMap: Record<string, string>;
		totalNewAttachments: number;
		failedCount: number;
	}> {
		const newAttachmentMap: Record<string, string> = {};
		const newImageMap: Record<string, string> = {};
		let newAttachmentCount = 0;
		let newImageCount = 0;
		let failedCount = 0;
		const maxAttachments = 20;

		// Extract URLs from the comment
		const urls = this.extractAttachmentUrls(commentBody);

		if (urls.length === 0) {
			return {
				newAttachmentMap,
				newImageMap,
				totalNewAttachments: 0,
				failedCount: 0,
			};
		}

		logger.debug("Found attachment URLs in new comment", {
			count: urls.length,
		});

		// Download new attachments
		for (const url of urls) {
			// Skip if we've already reached the total attachment limit
			if (existingAttachmentCount + newAttachmentCount >= maxAttachments) {
				logger.warn("Skipping attachment due to limit", {
					maxAttachments,
					current: existingAttachmentCount + newAttachmentCount,
				});
				break;
			}

			// Generate filename based on total attachment count
			const attachmentNumber = existingAttachmentCount + newAttachmentCount + 1;
			const tempFilename = `attachment_${attachmentNumber}.tmp`;
			const tempPath = join(attachmentsDir, tempFilename);

			const result = await this.downloadAttachment(url, tempPath, linearToken);

			if (result.success) {
				// Determine the final filename based on type
				let finalFilename: string;
				if (result.isImage) {
					newImageCount++;
					// Count existing images to get correct numbering
					const existingImageCount =
						await this.countExistingImages(attachmentsDir);
					finalFilename = `image_${existingImageCount + newImageCount}${result.fileType || ".png"}`;
				} else {
					finalFilename = `attachment_${attachmentNumber}${result.fileType || ""}`;
				}

				const finalPath = join(attachmentsDir, finalFilename);

				// Rename the file to include the correct extension
				await rename(tempPath, finalPath);

				// Store in appropriate map
				if (result.isImage) {
					newImageMap[url] = finalPath;
				} else {
					newAttachmentMap[url] = finalPath;
				}
				newAttachmentCount++;
			} else {
				failedCount++;
				logger.warn("Failed to download attachment", {
					url,
				});
			}
		}

		return {
			newAttachmentMap,
			newImageMap,
			totalNewAttachments: newAttachmentCount,
			failedCount,
		};
	}

	/**
	 * Count existing images in the attachments directory
	 */
	private async countExistingImages(attachmentsDir: string): Promise<number> {
		try {
			const files = await readdir(attachmentsDir);
			return files.filter((file) => file.startsWith("image_")).length;
		} catch {
			return 0;
		}
	}

	/**
	 * Generate attachment manifest for new comment attachments
	 */
	private generateNewAttachmentManifest(result: {
		newAttachmentMap: Record<string, string>;
		newImageMap: Record<string, string>;
		totalNewAttachments: number;
		failedCount: number;
	}): string {
		const { newAttachmentMap, newImageMap, totalNewAttachments, failedCount } =
			result;

		if (totalNewAttachments === 0) {
			return "";
		}

		let manifest = "\n## New Attachments from Comment\n\n";

		manifest += `Downloaded ${totalNewAttachments} new attachment${totalNewAttachments > 1 ? "s" : ""}`;
		if (failedCount > 0) {
			manifest += ` (${failedCount} failed)`;
		}
		manifest += ".\n\n";

		// List new images
		if (Object.keys(newImageMap).length > 0) {
			manifest += "### New Images\n";
			Object.entries(newImageMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these images.\n\n";
		}

		// List new other attachments
		if (Object.keys(newAttachmentMap).length > 0) {
			manifest += "### New Attachments\n";
			Object.entries(newAttachmentMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these files.\n\n";
		}

		return manifest;
	}

	/**
	 * Generate a markdown section describing downloaded attachments
	 */
	private generateAttachmentManifest(downloadResult: {
		attachmentMap: Record<string, string>;
		imageMap: Record<string, string>;
		totalFound: number;
		downloaded: number;
		imagesDownloaded: number;
		skipped: number;
		failed: number;
		nativeAttachments?: Array<{ title: string; url: string }>;
	}): string {
		const {
			attachmentMap,
			imageMap,
			totalFound,
			downloaded,
			imagesDownloaded,
			skipped,
			failed,
			nativeAttachments = [],
		} = downloadResult;

		let manifest = "\n## Downloaded Attachments\n\n";

		// Add native Linear attachments section if available
		if (nativeAttachments.length > 0) {
			manifest += "### Linear Issue Links\n";
			nativeAttachments.forEach((attachment, index) => {
				manifest += `${index + 1}. ${attachment.title}\n`;
				manifest += `   URL: ${attachment.url}\n\n`;
			});
		}

		if (totalFound === 0 && nativeAttachments.length === 0) {
			manifest += "No attachments were found in this issue.\n\n";
			manifest +=
				"The attachments directory `~/.cyrus/<workspace>/attachments` has been created and is available for any future attachments that may be added to this issue.\n";
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
		manifest += ".\n\n";

		if (failed > 0) {
			manifest +=
				"**Note**: Some attachments failed to download. This may be due to authentication issues or the files being unavailable. The agent will continue processing the issue with the available information.\n\n";
		}

		manifest +=
			"Attachments have been downloaded to the `~/.cyrus/<workspace>/attachments` directory:\n\n";

		// List images first
		if (Object.keys(imageMap).length > 0) {
			manifest += "### Images\n";
			Object.entries(imageMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these images.\n\n";
		}

		// List other attachments
		if (Object.keys(attachmentMap).length > 0) {
			manifest += "### Other Attachments\n";
			Object.entries(attachmentMap).forEach(([url, localPath], index) => {
				const filename = basename(localPath);
				manifest += `${index + 1}. ${filename} - Original URL: ${url}\n`;
				manifest += `   Local path: ${localPath}\n\n`;
			});
			manifest += "You can use the Read tool to view these files.\n\n";
		}

		return manifest;
	}

	/**
	 * Build MCP configuration with automatic Linear server injection and inline cyrus tools
	 */
	private buildMcpConfig(
		repository: RepositoryConfig,
		parentSessionId?: string,
	): Record<string, McpServerConfig> {
		// Always inject the Linear MCP servers with the repository's token
		// https://linear.app/docs/mcp
		const mcpConfig: Record<string, McpServerConfig> = {
			linear: {
				type: "http",
				url: "https://mcp.linear.app/mcp",
				headers: {
					Authorization: `Bearer ${repository.linearToken}`,
				},
			},
			"cyrus-tools": createCyrusToolsServer(repository.linearToken, {
				parentSessionId,
				onSessionCreated: (childSessionId, parentId) => {
					logger.info("Agent session created, mapping to parent", {
						repository: repository.name,
						childSessionId,
						parentSessionId: parentId,
					});
					// Map child to parent session
					this.sessionCleanup.setChildToParent(childSessionId, parentId);
					logger.debug("Parent-child mapping updated", {
						childSessionId,
						parentSessionId: parentId,
					});
				},
				onFeedbackDelivery: async (childSessionId, message) => {
					logger.debug("Processing feedback delivery to child session", {
						childSessionId,
					});

					// Find the repository containing the child session
					// We need to search all repositories for this child session
					let childRepo: RepositoryConfig | undefined;
					let childAgentSessionManager: AgentSessionManager | undefined;

					for (const [repoId, manager] of this.agentSessionManagers) {
						if (manager.hasClaudeRunner(childSessionId)) {
							childRepo = this.repositories.get(repoId);
							childAgentSessionManager = manager;
							break;
						}
					}

					if (!childRepo || !childAgentSessionManager) {
						logger.error("Child session not found in any repository", {
							childSessionId,
						});
						return false;
					}

					// Get the child session
					const childSession =
						childAgentSessionManager.getSession(childSessionId);
					if (!childSession) {
						logger.error("Child session not found", {
							childSessionId,
						});
						return false;
					}

					logger.debug("Found child session", {
						childSessionId,
						issueId: childSession.issueId,
					});

					// Format the feedback as a prompt for the child session with enhanced markdown formatting
					const feedbackPrompt = `## Received feedback from orchestrator\n\n---\n\n${message}\n\n---`;

					// Resume the CHILD session with the feedback from the parent
					// Important: We don't await the full session completion to avoid timeouts.
					// The feedback is delivered immediately when the session starts, so we can
					// return success right away while the session continues in the background.
					this.resumeClaudeSession(
						childSession,
						childRepo,
						childSessionId,
						childAgentSessionManager,
						feedbackPrompt,
						"", // No attachment manifest for feedback
						false, // Not a new session
						[], // No additional allowed directories for feedback
					)
						.then(() => {
							logger.debug("Child session completed processing feedback", {
								childSessionId,
							});
						})
						.catch((error) => {
							logger.error("Failed to complete child session with feedback", {
								childSessionId,
								error,
							});
						});

					// Return success immediately after initiating the session
					logger.info("Feedback delivered successfully to child session", {
						childSessionId,
					});
					return true;
				},
			}),
		};

		// Add OpenAI-based MCP servers if API key is configured
		if (repository.openaiApiKey) {
			// Sora video generation tools
			mcpConfig["sora-tools"] = createSoraToolsServer({
				apiKey: repository.openaiApiKey,
				outputDirectory: repository.openaiOutputDirectory,
			});

			// GPT Image generation tools
			mcpConfig["image-tools"] = createImageToolsServer({
				apiKey: repository.openaiApiKey,
				outputDirectory: repository.openaiOutputDirectory,
			});

			logger.info("Configured OpenAI MCP servers", {
				repository: repository.name,
				servers: ["Sora", "GPT Image"],
			});
		}

		return mcpConfig;
	}

	/**
	 * Resolve tool preset names to actual tool lists
	 */
	private resolveToolPreset(preset: string | string[]): string[] {
		if (Array.isArray(preset)) {
			return preset;
		}

		switch (preset) {
			case "readOnly":
				return getReadOnlyTools();
			case "safe":
				return getSafeTools();
			case "all":
				return getAllTools();
			case "coordinator":
				return getCoordinatorTools();
			default:
				// If it's a string but not a preset, treat it as a single tool
				return [preset];
		}
	}

	/**
	 * Build prompt for a session - handles both new and existing sessions
	 */
	private async buildSessionPrompt(
		isNewSession: boolean,
		fullIssue: LinearIssue,
		repository: RepositoryConfig,
		promptBody: string,
		attachmentManifest?: string,
	): Promise<string> {
		if (isNewSession) {
			// For completely new sessions, create a complete initial prompt
			const promptResult = await this.buildPromptV2(
				fullIssue,
				repository,
				undefined,
				attachmentManifest,
			);
			// Add the user's comment to the initial prompt
			return `${promptResult.prompt}\n\nUser comment: ${promptBody}`;
		} else {
			// For existing sessions, just use the comment with attachment manifest
			const manifestSuffix = attachmentManifest
				? `\n\n${attachmentManifest}`
				: "";
			return `${promptBody}${manifestSuffix}`;
		}
	}

	/**
	 * Build Claude runner configuration with common settings
	 */
	private buildClaudeRunnerConfig(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		linearAgentActivitySessionId: string,
		systemPrompt: string | undefined,
		allowedTools: string[],
		allowedDirectories: string[],
		disallowedTools: string[],
		resumeSessionId?: string,
		labels?: string[],
		maxTurns?: number,
	): ClaudeRunnerConfig {
		// Configure PostToolUse hook for playwright screenshots
		const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = {
			PostToolUse: [
				{
					matcher: "playwright_screenshot",
					hooks: [
						async (input: any, _toolUseID: any, { signal: _signal }: any) => {
							const postToolUseInput = input as PostToolUseHookInput;
							logger.debug("Tool completed", {
								repository: repository.name,
								sessionId: linearAgentActivitySessionId,
								toolName: postToolUseInput.tool_name,
								response: postToolUseInput.tool_response,
							});
							return {
								continue: true,
								additionalContext:
									"Screenshot taken successfully. You should use the Read tool to view the screenshot file to analyze the visual content.",
							};
						},
					],
				},
			],
		};

		// Check for model override labels (case-insensitive)
		let modelOverride: string | undefined;
		let fallbackModelOverride: string | undefined;

		if (labels && labels.length > 0) {
			const lowercaseLabels = labels.map((label) => label.toLowerCase());

			// Check for model override labels: opus, sonnet, haiku
			if (lowercaseLabels.includes("opus")) {
				modelOverride = "opus";
				logger.info("Model override via label", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					model: "opus",
				});
			} else if (lowercaseLabels.includes("sonnet")) {
				modelOverride = "sonnet";
				logger.info("Model override via label", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					model: "sonnet",
				});
			} else if (lowercaseLabels.includes("haiku")) {
				modelOverride = "haiku";
				logger.info("Model override via label", {
					repository: repository.name,
					sessionId: linearAgentActivitySessionId,
					model: "haiku",
				});
			}

			// If a model override is found, also set a reasonable fallback
			if (modelOverride) {
				// Set fallback to the next lower tier: opus->sonnet, sonnet->haiku, haiku->sonnet
				if (modelOverride === "opus") {
					fallbackModelOverride = "sonnet";
				} else if (modelOverride === "sonnet") {
					fallbackModelOverride = "haiku";
				} else {
					fallbackModelOverride = "sonnet"; // haiku falls back to sonnet since same model retry doesn't help
				}
			}
		}

		const config = {
			workingDirectory: session.workspace.path,
			allowedTools,
			disallowedTools,
			allowedDirectories,
			workspaceName: session.issue?.identifier || session.issueId,
			cyrusHome: this.cyrusHome,
			mcpConfigPath: repository.mcpConfigPath,
			mcpConfig: this.buildMcpConfig(repository, linearAgentActivitySessionId),
			appendSystemPrompt: systemPrompt || "",
			// Priority order: label override > repository config > global default
			model: modelOverride || repository.model || this.config.defaultModel,
			fallbackModel:
				fallbackModelOverride ||
				repository.fallbackModel ||
				this.config.defaultFallbackModel,
			hooks,
			onMessage: (message: SDKMessage) => {
				this.handleClaudeMessage(
					linearAgentActivitySessionId,
					message,
					repository.id,
				);
			},
			onError: (error: Error) => this.handleClaudeError(error),
		};

		if (resumeSessionId) {
			(config as any).resumeSessionId = resumeSessionId;
		}

		if (maxTurns !== undefined) {
			(config as any).maxTurns = maxTurns;
		}

		return config;
	}

	/**
	 * Build disallowed tools list following the same hierarchy as allowed tools
	 */
	private buildDisallowedTools(
		repository: RepositoryConfig,
		promptType?: "debugger" | "builder" | "scoper" | "orchestrator",
	): string[] {
		let disallowedTools: string[] = [];
		let toolSource = "";

		// Priority order (same as allowedTools):
		// 1. Repository-specific prompt type configuration
		if (promptType && repository.labelPrompts?.[promptType]?.disallowedTools) {
			disallowedTools = repository.labelPrompts[promptType].disallowedTools;
			toolSource = `repository label prompt (${promptType})`;
		}
		// 2. Global prompt type defaults
		else if (
			promptType &&
			this.config.promptDefaults?.[promptType]?.disallowedTools
		) {
			disallowedTools = this.config.promptDefaults[promptType].disallowedTools;
			toolSource = `global prompt defaults (${promptType})`;
		}
		// 3. Repository-level disallowed tools
		else if (repository.disallowedTools) {
			disallowedTools = repository.disallowedTools;
			toolSource = "repository configuration";
		}
		// 4. Global default disallowed tools
		else if (this.config.defaultDisallowedTools) {
			disallowedTools = this.config.defaultDisallowedTools;
			toolSource = "global defaults";
		}
		// 5. No defaults for disallowedTools (as per requirements)
		else {
			disallowedTools = [];
			toolSource = "none (no defaults)";
		}

		if (disallowedTools.length > 0) {
			logger.debug("Disallowed tools configured", {
				repository: repository.name,
				disallowedToolsCount: disallowedTools.length,
				toolSource,
			});
		}

		return disallowedTools;
	}

	/**
	 * Build allowed tools list with Linear MCP tools automatically included
	 */
	private buildAllowedTools(
		repository: RepositoryConfig,
		promptType?: "debugger" | "builder" | "scoper" | "orchestrator",
	): string[] {
		let baseTools: string[] = [];
		let toolSource = "";

		// Priority order:
		// 1. Repository-specific prompt type configuration
		if (promptType && repository.labelPrompts?.[promptType]?.allowedTools) {
			baseTools = this.resolveToolPreset(
				repository.labelPrompts[promptType].allowedTools,
			);
			toolSource = `repository label prompt (${promptType})`;
		}
		// 2. Global prompt type defaults
		else if (
			promptType &&
			this.config.promptDefaults?.[promptType]?.allowedTools
		) {
			baseTools = this.resolveToolPreset(
				this.config.promptDefaults[promptType].allowedTools,
			);
			toolSource = `global prompt defaults (${promptType})`;
		}
		// 3. Repository-level allowed tools
		else if (repository.allowedTools) {
			baseTools = repository.allowedTools;
			toolSource = "repository configuration";
		}
		// 4. Global default allowed tools
		else if (this.config.defaultAllowedTools) {
			baseTools = this.config.defaultAllowedTools;
			toolSource = "global defaults";
		}
		// 5. Fall back to safe tools
		else {
			baseTools = getSafeTools();
			toolSource = "safe tools fallback";
		}

		// Linear MCP tools that should always be available
		// See: https://docs.anthropic.com/en/docs/claude-code/iam#tool-specific-permission-rules
		const linearMcpTools = ["mcp__linear", "mcp__cyrus-tools"];

		// Combine and deduplicate
		const allTools = [...new Set([...baseTools, ...linearMcpTools])];

		logger.debug("Tool selection configured", {
			repository: repository.name,
			toolCount: allTools.length,
			toolSource,
		});

		return allTools;
	}

	/**
	 * Get Agent Sessions for an issue
	 */
	public getAgentSessionsForIssue(
		issueId: string,
		repositoryId: string,
	): any[] {
		const agentSessionManager = this.agentSessionManagers.get(repositoryId);
		if (!agentSessionManager) {
			return [];
		}

		return agentSessionManager.getSessionsByIssueId(issueId);
	}

	/**
	 * Load persisted EdgeWorker state for all repositories
	 */
	private async loadPersistedState(): Promise<void> {
		try {
			const state = await this.persistenceManager.loadEdgeWorkerState();
			if (state) {
				this.restoreMappings(state);
				logger.info("Loaded persisted EdgeWorker state", {
					repositoryCount: Object.keys(state.agentSessions || {}).length,
				});
			}
		} catch (error) {
			logger.error("Failed to load persisted EdgeWorker state", {
				error,
			});
		}
	}

	/**
	 * Save current EdgeWorker state for all repositories
	 */
	private async savePersistedState(): Promise<void> {
		try {
			const state = this.serializeMappings();
			await this.persistenceManager.saveEdgeWorkerState(state);
			logger.debug("Saved EdgeWorker state", {
				repositoryCount: Object.keys(state.agentSessions || {}).length,
			});
		} catch (error) {
			logger.error("Failed to save persisted EdgeWorker state", {
				error,
			});
		}
	}

	/**
	 * Serialize EdgeWorker mappings to a serializable format
	 */
	public serializeMappings(): SerializableEdgeWorkerState {
		// Serialize Agent Session state for all repositories
		const agentSessions: Record<
			string,
			Record<string, SerializedCyrusAgentSession>
		> = {};
		const agentSessionEntries: Record<
			string,
			Record<string, SerializedCyrusAgentSessionEntry[]>
		> = {};
		for (const [
			repositoryId,
			agentSessionManager,
		] of this.agentSessionManagers.entries()) {
			const serializedState = agentSessionManager.serializeState();
			agentSessions[repositoryId] = serializedState.sessions;
			agentSessionEntries[repositoryId] = serializedState.entries;
		}
		// NOTE: child-to-parent mappings are now managed by SessionCleanupManager
		// with TTL-based cleanup, so they don't persist across restarts

		return {
			agentSessions,
			agentSessionEntries,
		};
	}

	/**
	 * Restore EdgeWorker mappings from serialized state
	 */
	public restoreMappings(state: SerializableEdgeWorkerState): void {
		// Restore Agent Session state for all repositories
		if (state.agentSessions && state.agentSessionEntries) {
			for (const [
				repositoryId,
				agentSessionManager,
			] of this.agentSessionManagers.entries()) {
				const repositorySessions = state.agentSessions[repositoryId] || {};
				const repositoryEntries = state.agentSessionEntries[repositoryId] || {};

				if (
					Object.keys(repositorySessions).length > 0 ||
					Object.keys(repositoryEntries).length > 0
				) {
					agentSessionManager.restoreState(
						repositorySessions,
						repositoryEntries,
					);
					logger.info("Restored Agent Session state for repository", {
						repositoryId,
						sessionCount: Object.keys(repositorySessions).length,
						entryCount: Object.keys(repositoryEntries).length,
					});
				}
			}
		}

		// NOTE: child-to-parent mappings are now managed by SessionCleanupManager
		// with TTL-based cleanup, so they don't persist across restarts
	}

	/**
	 * Post instant acknowledgment thought when agent session is created
	 */
	private async postInstantAcknowledgment(
		linearAgentActivitySessionId: string,
		repositoryId: string,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				logger.warn("No Linear client found for repository", {
					repositoryId,
				});
				return;
			}

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: "I've received your request and I'm starting to work on it. Let me analyze the issue and prepare my approach.",
				},
			};

			const result = await linearClient.createAgentActivity(activityInput);
			if (result.success) {
				logger.debug("Posted instant acknowledgment thought", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
				});
			} else {
				logger.error("Failed to post instant acknowledgment", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
					result,
				});
			}
		} catch (error) {
			logger.error("Error posting instant acknowledgment", {
				repositoryId,
				sessionId: linearAgentActivitySessionId,
				error,
			});
		}
	}

	/**
	 * Post parent resume acknowledgment thought when parent session is resumed from child
	 */
	private async postParentResumeAcknowledgment(
		linearAgentActivitySessionId: string,
		repositoryId: string,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				logger.warn("No Linear client found for repository", {
					repositoryId,
				});
				return;
			}

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: "Resuming from child session",
				},
			};

			const result = await linearClient.createAgentActivity(activityInput);
			if (result.success) {
				logger.debug("Posted parent resumption acknowledgment thought", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
				});
			} else {
				logger.error("Failed to post parent resumption acknowledgment", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
					result,
				});
			}
		} catch (error) {
			logger.error("Error posting parent resumption acknowledgment", {
				repositoryId,
				sessionId: linearAgentActivitySessionId,
				error,
			});
		}
	}

	/**
	 * Post thought about system prompt selection based on labels
	 */
	private async postSystemPromptSelectionThought(
		linearAgentActivitySessionId: string,
		labels: string[],
		repositoryId: string,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				logger.warn("No Linear client found for repository", {
					repositoryId,
				});
				return;
			}

			// Determine which prompt type was selected and which label triggered it
			let selectedPromptType: string | null = null;
			let triggerLabel: string | null = null;
			const repository = Array.from(this.repositories.values()).find(
				(r) => r.id === repositoryId,
			);

			if (repository?.labelPrompts) {
				// Check debugger labels
				const debuggerConfig = repository.labelPrompts.debugger;
				const debuggerLabels = Array.isArray(debuggerConfig)
					? debuggerConfig
					: debuggerConfig?.labels;
				const debuggerLabel = debuggerLabels?.find((label) =>
					labels.includes(label),
				);
				if (debuggerLabel) {
					selectedPromptType = "debugger";
					triggerLabel = debuggerLabel;
				} else {
					// Check builder labels
					const builderConfig = repository.labelPrompts.builder;
					const builderLabels = Array.isArray(builderConfig)
						? builderConfig
						: builderConfig?.labels;
					const builderLabel = builderLabels?.find((label) =>
						labels.includes(label),
					);
					if (builderLabel) {
						selectedPromptType = "builder";
						triggerLabel = builderLabel;
					} else {
						// Check scoper labels
						const scoperConfig = repository.labelPrompts.scoper;
						const scoperLabels = Array.isArray(scoperConfig)
							? scoperConfig
							: scoperConfig?.labels;
						const scoperLabel = scoperLabels?.find((label) =>
							labels.includes(label),
						);
						if (scoperLabel) {
							selectedPromptType = "scoper";
							triggerLabel = scoperLabel;
						} else {
							// Check orchestrator labels
							const orchestratorConfig = repository.labelPrompts.orchestrator;
							const orchestratorLabels = Array.isArray(orchestratorConfig)
								? orchestratorConfig
								: orchestratorConfig?.labels;
							const orchestratorLabel = orchestratorLabels?.find((label) =>
								labels.includes(label),
							);
							if (orchestratorLabel) {
								selectedPromptType = "orchestrator";
								triggerLabel = orchestratorLabel;
							}
						}
					}
				}
			}

			// Only post if a role was actually triggered
			if (!selectedPromptType || !triggerLabel) {
				return;
			}

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: `Entering '${selectedPromptType}' mode because of the '${triggerLabel}' label. I'll follow the ${selectedPromptType} process...`,
				},
			};

			const result = await linearClient.createAgentActivity(activityInput);
			if (result.success) {
				logger.debug("Posted system prompt selection thought", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
					selectedPromptType,
					triggerLabel,
				});
			} else {
				logger.error("Failed to post system prompt selection thought", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
					selectedPromptType,
					result,
				});
			}
		} catch (error) {
			logger.error("Error posting system prompt selection thought", {
				repositoryId,
				sessionId: linearAgentActivitySessionId,
				error,
			});
		}
	}

	/**
	 * Resume or create a Claude session with the given prompt
	 * This is the core logic for handling prompted agent activities
	 * @param session The Cyrus agent session
	 * @param repository The repository configuration
	 * @param linearAgentActivitySessionId The Linear agent session ID
	 * @param agentSessionManager The agent session manager
	 * @param promptBody The prompt text to send
	 * @param attachmentManifest Optional attachment manifest
	 * @param isNewSession Whether this is a new session
	 */
	async resumeClaudeSession(
		session: CyrusAgentSession,
		repository: RepositoryConfig,
		linearAgentActivitySessionId: string,
		agentSessionManager: AgentSessionManager,
		promptBody: string,
		attachmentManifest: string = "",
		isNewSession: boolean = false,
		additionalAllowedDirectories: string[] = [],
		maxTurns?: number,
	): Promise<void> {
		// Check for existing runner
		const existingRunner = session.claudeRunner;

		// If there's an existing streaming runner, add to it
		if (existingRunner?.isStreaming()) {
			let fullPrompt = promptBody;
			if (attachmentManifest) {
				fullPrompt = `${promptBody}\n\n${attachmentManifest}`;
			}

			existingRunner.addStreamMessage(fullPrompt);
			return;
		}

		// Stop existing runner if it's not streaming
		if (existingRunner) {
			existingRunner.stop();
		}

		// Determine if we need a new Claude session
		const needsNewClaudeSession = isNewSession || !session.claudeSessionId;

		// Fetch full issue details
		const fullIssue = await this.fetchFullIssueDetails(
			session.issueId,
			repository.id,
		);
		if (!fullIssue) {
			logger.error("Failed to fetch full issue details", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				issueId: session.issueId,
			});
			throw new Error(
				`Failed to fetch full issue details for ${session.issueId}`,
			);
		}

		// Fetch issue labels and determine system prompt
		const labels = await this.fetchIssueLabels(fullIssue);

		const systemPromptResult = await this.determineSystemPromptFromLabels(
			labels,
			repository,
		);
		const systemPrompt = systemPromptResult?.prompt;
		const promptType = systemPromptResult?.type;

		// Build allowed tools list
		const allowedTools = this.buildAllowedTools(repository, promptType);
		const disallowedTools = this.buildDisallowedTools(repository, promptType);

		// Set up attachments directory
		const workspaceFolderName = basename(session.workspace.path);
		const attachmentsDir = join(
			this.cyrusHome,
			workspaceFolderName,
			"attachments",
		);
		await mkdir(attachmentsDir, { recursive: true });

		const allowedDirectories = [
			attachmentsDir,
			...additionalAllowedDirectories,
		];

		// Create runner configuration
		const resumeSessionId = needsNewClaudeSession
			? undefined
			: session.claudeSessionId;

		const runnerConfig = this.buildClaudeRunnerConfig(
			session,
			repository,
			linearAgentActivitySessionId,
			systemPrompt,
			allowedTools,
			allowedDirectories,
			disallowedTools,
			resumeSessionId,
			labels, // Pass labels for model override
			maxTurns, // Pass maxTurns if specified
		);

		const runner = new ClaudeRunner(runnerConfig);

		// Store runner
		agentSessionManager.addClaudeRunner(linearAgentActivitySessionId, runner);

		// Save state
		await this.savePersistedState();

		// Prepare the full prompt
		const fullPrompt = await this.buildSessionPrompt(
			isNewSession,
			fullIssue,
			repository,
			promptBody,
			attachmentManifest,
		);

		// Start streaming session
		try {
			await runner.startStreaming(fullPrompt);
		} catch (error) {
			logger.error("Failed to start streaming session", {
				repository: repository.name,
				sessionId: linearAgentActivitySessionId,
				issueId: session.issueId,
				error,
			});
			throw error;
		}
	}

	/**
	 * Post instant acknowledgment thought when receiving prompted webhook
	 */
	private async postInstantPromptedAcknowledgment(
		linearAgentActivitySessionId: string,
		repositoryId: string,
		isStreaming: boolean,
	): Promise<void> {
		try {
			const linearClient = this.linearClients.get(repositoryId);
			if (!linearClient) {
				logger.warn("No Linear client found for repository", {
					repositoryId,
				});
				return;
			}

			const message = isStreaming
				? "I've queued up your message as guidance"
				: "Getting started on that...";

			const activityInput = {
				agentSessionId: linearAgentActivitySessionId,
				content: {
					type: "thought",
					body: message,
				},
			};

			const result = await linearClient.createAgentActivity(activityInput);
			if (result.success) {
				logger.debug("Posted instant prompted acknowledgment thought", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
					isStreaming,
				});
			} else {
				logger.error("Failed to post instant prompted acknowledgment", {
					repositoryId,
					sessionId: linearAgentActivitySessionId,
					result,
				});
			}
		} catch (error) {
			logger.error("Error posting instant prompted acknowledgment", {
				repositoryId,
				sessionId: linearAgentActivitySessionId,
				error,
			});
		}
	}

	/**
	 * Fetch complete issue details from Linear API
	 */
	public async fetchFullIssueDetails(
		issueId: string,
		repositoryId: string,
	): Promise<LinearIssue | null> {
		const linearClient = this.linearClients.get(repositoryId);
		if (!linearClient) {
			logger.warn("No Linear client found for repository", {
				repositoryId,
			});
			return null;
		}

		try {
			logger.debug("Fetching full issue details", {
				repositoryId,
				issueId,
			});
			const fullIssue = await linearClient.issue(issueId);
			logger.debug("Successfully fetched issue details", {
				repositoryId,
				issueId,
			});

			// Check if issue has a parent
			try {
				const parent = await fullIssue.parent;
				if (parent) {
					logger.debug("Issue has parent", {
						repositoryId,
						issueId,
						parentIdentifier: parent.identifier,
					});
				}
			} catch (_error) {
				// Parent field might not exist, ignore error
			}

			return fullIssue;
		} catch (error) {
			logger.error("Failed to fetch issue details", {
				repositoryId,
				issueId,
				error,
			});
			return null;
		}
	}
}
