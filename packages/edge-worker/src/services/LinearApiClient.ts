/**
 * Linear API Client
 * Wraps all Linear SDK calls with retry logic, rate limiting, and structured error handling
 */

import type { Comment, LinearClient, Issue as LinearIssue } from "@linear/sdk";
import { LINEAR_API } from "../utils/constants.js";
import { LinearCache } from "../utils/LinearCache.js";
import { Logger } from "../utils/Logger.js";
import { type RateLimiter, retryWithBackoff } from "../utils/retry.js";

const logger = new Logger({ name: "LinearApiClient" });

export interface LinearApiClientOptions {
	linearClient: LinearClient;
	rateLimiter: RateLimiter;
	repositoryId: string;
	repositoryName: string;
	cache?: LinearCache; // Optional cache for reducing API calls
}

/**
 * Centralized Linear API client with retry and rate limiting
 */
export class LinearApiClient {
	private client: LinearClient;
	private rateLimiter: RateLimiter;
	private repositoryId: string;
	private repositoryName: string;
	private cache?: LinearCache;

	constructor(options: LinearApiClientOptions) {
		this.client = options.linearClient;
		this.rateLimiter = options.rateLimiter;
		this.repositoryId = options.repositoryId;
		this.repositoryName = options.repositoryName;
		this.cache = options.cache;
	}

	/**
	 * Fetch issue by ID (with optional caching)
	 */
	async getIssue(issueId: string): Promise<LinearIssue> {
		// Check cache first
		if (this.cache) {
			const cacheKey = LinearCache.issueKey(issueId);
			const cached = this.cache.get<LinearIssue>(cacheKey);
			if (cached) {
				logger.debug("Cache HIT for issue", {
					repository: this.repositoryName,
					issueId,
					cacheKey,
				});
				return cached;
			}
		}

		// Cache miss - fetch from API
		const issue = await retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return this.client.issue(issueId);
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying getIssue", {
						repository: this.repositoryName,
						issueId,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);

		// Cache the result
		if (this.cache) {
			const cacheKey = LinearCache.issueKey(issueId);
			this.cache.set(cacheKey, issue);
		}

		return issue;
	}

	/**
	 * Fetch comment by ID (with optional caching)
	 */
	async getComment(commentId: string): Promise<Comment> {
		// Check cache first
		if (this.cache) {
			const cacheKey = LinearCache.commentKey(commentId);
			const cached = this.cache.get<Comment>(cacheKey);
			if (cached) {
				logger.debug("Cache HIT for comment", {
					repository: this.repositoryName,
					commentId,
					cacheKey,
				});
				return cached;
			}
		}

		// Cache miss - fetch from API
		const comment = await retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return this.client.comment({ id: commentId });
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying getComment", {
						repository: this.repositoryName,
						commentId,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);

		// Cache the result
		if (this.cache) {
			const cacheKey = LinearCache.commentKey(commentId);
			this.cache.set(cacheKey, comment);
		}

		return comment;
	}

	/**
	 * Fetch comments for an issue (with optional caching)
	 */
	async getIssueComments(issueId: string) {
		// Check cache first
		if (this.cache) {
			const cacheKey = LinearCache.issueCommentsKey(issueId);
			const cached = this.cache.get<any>(cacheKey);
			if (cached) {
				logger.debug("Cache HIT for issue comments", {
					repository: this.repositoryName,
					issueId,
					cacheKey,
				});
				return cached;
			}
		}

		// Cache miss - fetch from API
		const comments = await retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return this.client.comments({
					filter: { issue: { id: { eq: issueId } } },
				});
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying getIssueComments", {
						repository: this.repositoryName,
						issueId,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);

		// Cache the result
		if (this.cache) {
			const cacheKey = LinearCache.issueCommentsKey(issueId);
			this.cache.set(cacheKey, comments);
		}

		return comments;
	}

	/**
	 * Fetch all issue labels
	 */
	async getIssueLabels() {
		return retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return this.client.issueLabels();
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying getIssueLabels", {
						repository: this.repositoryName,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);
	}

	/**
	 * Create a comment
	 */
	async createComment(commentData: {
		issueId: string;
		body: string;
		parentId?: string;
	}) {
		return retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return this.client.createComment(commentData);
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying createComment", {
						repository: this.repositoryName,
						issueId: commentData.issueId,
						hasParent: !!commentData.parentId,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);
	}

	/**
	 * Create agent activity
	 */
	async createAgentActivity(activityInput: any) {
		return retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return this.client.createAgentActivity(activityInput);
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying createAgentActivity", {
						repository: this.repositoryName,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);
	}

	/**
	 * Execute GraphQL mutation with retry
	 */
	async executeMutation<T>(mutation: string, variables: any): Promise<T> {
		return retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return (this.client as any).client.request(mutation, variables);
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.REACTION_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying GraphQL mutation", {
						repository: this.repositoryName,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);
	}

	/**
	 * Execute raw GraphQL request with retry
	 */
	async executeRawRequest<T>(query: string, variables?: any): Promise<T> {
		return retryWithBackoff(
			async () => {
				await this.rateLimiter.acquire();
				return (this.client as any).client.rawRequest(query, variables);
			},
			{
				maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
				initialDelayMs: LINEAR_API.INITIAL_RETRY_DELAY_MS,
				onRetry: (attempt, error) => {
					logger.warn("Retrying rawRequest", {
						repository: this.repositoryName,
						attempt,
						maxAttempts: LINEAR_API.DEFAULT_RETRY_ATTEMPTS,
						error: error.message,
					});
				},
			},
		);
	}

	/**
	 * Add reaction to comment (⏳ progress indicator)
	 */
	async addProgressReaction(commentId: string): Promise<string | null> {
		const mutation = `
			mutation ReactionCreate($input: ReactionCreateInput!) {
				reactionCreate(input: $input) {
					reaction {
						id
					}
				}
			}
		`;

		try {
			const result = await this.executeMutation<any>(mutation, {
				input: {
					commentId,
					emoji: "⏳",
				},
			});

			return result?.reactionCreate?.reaction?.id || null;
		} catch (error) {
			logger.error("Failed to add progress reaction", {
				repository: this.repositoryName,
				commentId,
				error,
			});
			return null;
		}
	}

	/**
	 * Add reaction to comment (✅ success indicator)
	 */
	async addSuccessReaction(commentId: string): Promise<string | null> {
		const mutation = `
			mutation ReactionCreate($input: ReactionCreateInput!) {
				reactionCreate(input: $input) {
					reaction {
						id
					}
				}
			}
		`;

		try {
			const result = await this.executeMutation<any>(mutation, {
				input: {
					commentId,
					emoji: "✅",
				},
			});

			return result?.reactionCreate?.reaction?.id || null;
		} catch (error) {
			logger.error("Failed to add success reaction", {
				repository: this.repositoryName,
				commentId,
				error,
			});
			return null;
		}
	}

	/**
	 * Remove reaction by ID
	 */
	async removeReaction(reactionId: string): Promise<boolean> {
		const mutation = `
			mutation ReactionDelete($id: String!) {
				reactionDelete(id: $id) {
					success
				}
			}
		`;

		try {
			await this.executeMutation(mutation, { id: reactionId });
			return true;
		} catch (error) {
			logger.error("Failed to remove reaction", {
				repository: this.repositoryName,
				reactionId,
				error,
			});
			return false;
		}
	}

	/**
	 * Get the underlying LinearClient (for methods not yet wrapped)
	 */
	getRawClient(): LinearClient {
		return this.client;
	}

	/**
	 * Get repository information
	 */
	getRepositoryInfo(): { id: string; name: string } {
		return {
			id: this.repositoryId,
			name: this.repositoryName,
		};
	}
}
