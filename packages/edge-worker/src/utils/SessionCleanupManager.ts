/**
 * Session Cleanup Manager
 * Handles TTL-based cleanup of session tracking data to prevent memory leaks
 */

import { SESSION_CLEANUP } from "./constants.js";
import { Logger } from "./Logger.js";

const logger = new Logger({ name: "SessionCleanupManager" });

export interface CleanupEntry<T> {
	value: T;
	timestamp: number;
}

/**
 * Manages TTL-based cleanup for session tracking Maps and Sets
 */
export class SessionCleanupManager {
	private cleanupInterval: NodeJS.Timeout | null = null;
	private isShutdown = false;

	// Session reaction tracking with TTL
	private sessionReactionsData: Map<string, CleanupEntry<string>> = new Map();

	// Child-to-parent session mapping with TTL
	private childToParentData: Map<string, CleanupEntry<string>> = new Map();

	// Bot comment tracking with TTL
	private recentBotCommentsData: Map<string, CleanupEntry<true>> = new Map();

	// Bot parent comment tracking with TTL
	private botParentCommentsData: Map<string, CleanupEntry<true>> = new Map();

	// Thread reply tracking with TTL
	private threadRepliesPostedData: Map<string, CleanupEntry<true>> = new Map();

	constructor(cleanupIntervalMs: number = SESSION_CLEANUP.CLEANUP_INTERVAL) {
		// Start periodic cleanup
		this.cleanupInterval = setInterval(() => {
			this.performCleanup();
		}, cleanupIntervalMs);
	}

	/**
	 * Add session reaction mapping with TTL
	 */
	setSessionReaction(sessionId: string, reactionId: string): void {
		this.sessionReactionsData.set(sessionId, {
			value: reactionId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Get session reaction ID
	 */
	getSessionReaction(sessionId: string): string | undefined {
		return this.sessionReactionsData.get(sessionId)?.value;
	}

	/**
	 * Delete session reaction
	 */
	deleteSessionReaction(sessionId: string): boolean {
		return this.sessionReactionsData.delete(sessionId);
	}

	/**
	 * Check if session has reaction
	 */
	hasSessionReaction(sessionId: string): boolean {
		return this.sessionReactionsData.has(sessionId);
	}

	/**
	 * Add child-to-parent session mapping with TTL
	 */
	setChildToParent(childSessionId: string, parentSessionId: string): void {
		this.childToParentData.set(childSessionId, {
			value: parentSessionId,
			timestamp: Date.now(),
		});
	}

	/**
	 * Get parent session ID for a child session
	 */
	getParentSession(childSessionId: string): string | undefined {
		return this.childToParentData.get(childSessionId)?.value;
	}

	/**
	 * Delete child-to-parent mapping
	 */
	deleteChildToParent(childSessionId: string): boolean {
		return this.childToParentData.delete(childSessionId);
	}

	/**
	 * Add bot comment to tracking
	 */
	addRecentBotComment(commentId: string): void {
		this.recentBotCommentsData.set(commentId, {
			value: true,
			timestamp: Date.now(),
		});
	}

	/**
	 * Check if comment is a recent bot comment
	 */
	isRecentBotComment(commentId: string): boolean {
		return this.recentBotCommentsData.has(commentId);
	}

	/**
	 * Delete bot comment from tracking
	 */
	deleteRecentBotComment(commentId: string): boolean {
		return this.recentBotCommentsData.delete(commentId);
	}

	/**
	 * Add bot parent comment to tracking
	 */
	addBotParentComment(commentId: string): void {
		this.botParentCommentsData.set(commentId, {
			value: true,
			timestamp: Date.now(),
		});
	}

	/**
	 * Check if comment is a bot parent comment
	 */
	isBotParentComment(commentId: string): boolean {
		return this.botParentCommentsData.has(commentId);
	}

	/**
	 * Delete bot parent comment from tracking
	 */
	deleteBotParentComment(commentId: string): boolean {
		return this.botParentCommentsData.delete(commentId);
	}

	/**
	 * Mark thread reply as posted
	 */
	markThreadReplyPosted(sessionId: string): void {
		this.threadRepliesPostedData.set(sessionId, {
			value: true,
			timestamp: Date.now(),
		});
	}

	/**
	 * Check if thread reply was posted
	 */
	wasThreadReplyPosted(sessionId: string): boolean {
		return this.threadRepliesPostedData.has(sessionId);
	}

	/**
	 * Delete thread reply tracking
	 */
	deleteThreadReplyPosted(sessionId: string): boolean {
		return this.threadRepliesPostedData.delete(sessionId);
	}

	/**
	 * Perform periodic cleanup of expired entries
	 */
	private performCleanup(): void {
		if (this.isShutdown) return;

		const now = Date.now();
		let totalCleaned = 0;

		// Cleanup session reactions
		totalCleaned += this.cleanupMap(
			this.sessionReactionsData,
			now,
			SESSION_CLEANUP.SESSION_REACTION_TTL,
			"session reactions",
		);

		// Cleanup child-to-parent mappings (use longer TTL - only clean very old ones)
		totalCleaned += this.cleanupMap(
			this.childToParentData,
			now,
			SESSION_CLEANUP.COMPLETED_SESSION_TTL,
			"child-to-parent mappings",
		);

		// Cleanup bot comments
		totalCleaned += this.cleanupMap(
			this.recentBotCommentsData,
			now,
			SESSION_CLEANUP.BOT_COMMENT_TTL,
			"recent bot comments",
		);

		// Cleanup bot parent comments
		totalCleaned += this.cleanupMap(
			this.botParentCommentsData,
			now,
			SESSION_CLEANUP.BOT_PARENT_COMMENT_TTL,
			"bot parent comments",
		);

		// Cleanup thread replies
		totalCleaned += this.cleanupMap(
			this.threadRepliesPostedData,
			now,
			SESSION_CLEANUP.THREAD_REPLY_TTL,
			"thread replies",
		);

		if (totalCleaned > 0) {
			logger.info("Cleaned up expired entries", { totalCleaned });
		}
	}

	/**
	 * Clean up a specific map based on TTL
	 */
	private cleanupMap<T>(
		map: Map<string, CleanupEntry<T>>,
		now: number,
		ttl: number,
		name: string,
	): number {
		let cleaned = 0;
		const cutoff = now - ttl;

		for (const [key, entry] of map.entries()) {
			if (entry.timestamp < cutoff) {
				map.delete(key);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info("Cleaned expired entries", { cleaned, category: name });
		}

		return cleaned;
	}

	/**
	 * Get statistics about tracked data
	 */
	getStats(): {
		sessionReactions: number;
		childToParent: number;
		recentBotComments: number;
		botParentComments: number;
		threadRepliesPosted: number;
		total: number;
	} {
		return {
			sessionReactions: this.sessionReactionsData.size,
			childToParent: this.childToParentData.size,
			recentBotComments: this.recentBotCommentsData.size,
			botParentComments: this.botParentCommentsData.size,
			threadRepliesPosted: this.threadRepliesPostedData.size,
			total:
				this.sessionReactionsData.size +
				this.childToParentData.size +
				this.recentBotCommentsData.size +
				this.botParentCommentsData.size +
				this.threadRepliesPostedData.size,
		};
	}

	/**
	 * Force immediate cleanup (useful for testing or shutdown)
	 */
	forceCleanup(): void {
		this.performCleanup();
	}

	/**
	 * Shutdown and cleanup all data
	 */
	shutdown(): void {
		if (this.isShutdown) return;

		logger.info("Shutting down");

		// Stop periodic cleanup
		if (this.cleanupInterval) {
			clearInterval(this.cleanupInterval);
			this.cleanupInterval = null;
		}

		// Clear all data
		this.sessionReactionsData.clear();
		this.childToParentData.clear();
		this.recentBotCommentsData.clear();
		this.botParentCommentsData.clear();
		this.threadRepliesPostedData.clear();

		this.isShutdown = true;
		logger.info("Shutdown complete");
	}

	/**
	 * Check if manager is shutdown
	 */
	get isShutdownComplete(): boolean {
		return this.isShutdown;
	}
}
