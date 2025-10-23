/**
 * UnrespondedMessageTracker
 *
 * Tracks messages that have been marked with ⏳ (in progress) but haven't received
 * a thread reply yet. Helps identify and debug cases where:
 * - Session completes but doesn't reply
 * - ⏳ is added but never replaced with ✅
 * - Response flow is broken
 */

import { TIME } from "./constants.js";
import { Logger } from "./Logger.js";

const logger = new Logger({ name: "UnrespondedMessageTracker" });

interface PendingMessage {
	sessionId: string;
	commentId: string;
	issueId: string;
	repositoryId: string;
	startedAt: number;
	progressReactionId?: string;
	metadata: {
		shouldReplyInThread: boolean;
		originalCommentId?: string;
	};
}

interface ResponseStatus {
	sessionId: string;
	commentId: string;
	respondedAt: number;
	success: boolean;
}

export class UnrespondedMessageTracker {
	// Messages waiting for response (sessionId → PendingMessage)
	private pendingMessages: Map<string, PendingMessage> = new Map();

	// Messages that have been responded to (sessionId → ResponseStatus)
	private respondedMessages: Map<string, ResponseStatus> = new Map();

	// Cleanup interval
	private cleanupIntervalId?: NodeJS.Timeout;

	// Alert threshold (messages older than this without response trigger alerts)
	private alertThresholdMs: number;

	constructor(alertThresholdMs: number = TIME.FIVE_MINUTES * 6) {
		// Default: alert if no response after 30 minutes
		this.alertThresholdMs = alertThresholdMs;
		this.startCleanup();
	}

	/**
	 * Mark a message as pending response
	 * Called when ⏳ is added to a comment
	 */
	markPending(
		sessionId: string,
		commentId: string,
		issueId: string,
		repositoryId: string,
		metadata: {
			shouldReplyInThread: boolean;
			originalCommentId?: string;
		},
		progressReactionId?: string,
	): void {
		this.pendingMessages.set(sessionId, {
			sessionId,
			commentId,
			issueId,
			repositoryId,
			startedAt: Date.now(),
			progressReactionId,
			metadata,
		});

		logger.info("Tracking pending message", { sessionId, commentId });
	}

	/**
	 * Mark a message as responded
	 * Called when thread reply is posted successfully
	 */
	markResponded(sessionId: string, success: boolean = true): void {
		const pending = this.pendingMessages.get(sessionId);

		if (!pending) {
			logger.warn("Attempted to mark unknown session as responded", {
				sessionId,
			});
			return;
		}

		this.respondedMessages.set(sessionId, {
			sessionId,
			commentId: pending.commentId,
			respondedAt: Date.now(),
			success,
		});

		this.pendingMessages.delete(sessionId);

		const duration = Date.now() - pending.startedAt;
		logger.info("Message responded", {
			sessionId,
			durationSeconds: Math.round(duration / 1000),
		});
	}

	/**
	 * Check for unresponded messages that are overdue
	 * Returns list of sessions that need attention
	 */
	getUnrespondedMessages(): PendingMessage[] {
		const now = Date.now();
		const overdue: PendingMessage[] = [];

		for (const pending of this.pendingMessages.values()) {
			const age = now - pending.startedAt;
			if (age > this.alertThresholdMs) {
				overdue.push(pending);
			}
		}

		return overdue;
	}

	/**
	 * Get statistics about message tracking
	 */
	getStats(): {
		pending: number;
		responded: number;
		overdue: number;
		avgResponseTime: number;
	} {
		const now = Date.now();
		const overdue = Array.from(this.pendingMessages.values()).filter(
			(p) => now - p.startedAt > this.alertThresholdMs,
		).length;

		// Calculate average response time from recent responses
		const recentResponses = Array.from(this.respondedMessages.values()).filter(
			(r) => now - r.respondedAt < TIME.FIVE_MINUTES * 12,
		); // Last hour

		let avgResponseTime = 0;
		if (recentResponses.length > 0) {
			const durations = recentResponses.map((r) => {
				const pending = this.pendingMessages.get(r.sessionId);
				return pending ? r.respondedAt - pending.startedAt : 0;
			});
			avgResponseTime =
				durations.reduce((sum, d) => sum + d, 0) / durations.length;
		}

		return {
			pending: this.pendingMessages.size,
			responded: this.respondedMessages.size,
			overdue,
			avgResponseTime: Math.round(avgResponseTime / 1000), // Convert to seconds
		};
	}

	/**
	 * Verify if a session has proper metadata for replying
	 */
	verifyMetadata(sessionId: string): {
		isValid: boolean;
		issues: string[];
	} {
		const pending = this.pendingMessages.get(sessionId);
		if (!pending) {
			return {
				isValid: false,
				issues: ["Session not found in tracking"],
			};
		}

		const issues: string[] = [];

		if (!pending.metadata.shouldReplyInThread) {
			issues.push("shouldReplyInThread is false or missing");
		}

		if (!pending.metadata.originalCommentId) {
			issues.push("originalCommentId is missing");
		}

		if (!pending.progressReactionId) {
			issues.push("progressReactionId (⏳) was not recorded");
		}

		return {
			isValid: issues.length === 0,
			issues,
		};
	}

	/**
	 * Alert about overdue messages
	 */
	checkAndAlertOverdue(): void {
		const overdue = this.getUnrespondedMessages();

		if (overdue.length > 0) {
			logger.warn("OVERDUE MESSAGES WITHOUT RESPONSE", {
				overdueCount: overdue.length,
			});

			for (const msg of overdue) {
				const ageMinutes = Math.round((Date.now() - msg.startedAt) / 60000);
				const verification = this.verifyMetadata(msg.sessionId);

				logger.warn("Overdue message details", {
					sessionId: msg.sessionId,
					commentId: msg.commentId,
					issueId: msg.issueId,
					repositoryId: msg.repositoryId,
					ageMinutes,
					metadataValid: verification.isValid,
					issues:
						verification.issues.length > 0 ? verification.issues : undefined,
				});
			}
		}
	}

	/**
	 * Periodic cleanup and alerting
	 */
	private startCleanup(): void {
		this.cleanupIntervalId = setInterval(() => {
			this.performCleanup();
			this.checkAndAlertOverdue();
		}, TIME.FIVE_MINUTES);
	}

	/**
	 * Clean up old tracked messages
	 */
	private performCleanup(): void {
		const now = Date.now();
		const maxAge = TIME.FIVE_MINUTES * 24; // 2 hours
		let cleaned = 0;

		// Clean old pending messages (keep them for debugging, but warn if very old)
		for (const [sessionId, pending] of this.pendingMessages.entries()) {
			const age = now - pending.startedAt;
			if (age > maxAge) {
				logger.error("Removing very old pending message", {
					sessionId,
					ageMinutes: Math.round(age / 60000),
				});
				this.pendingMessages.delete(sessionId);
				cleaned++;
			}
		}

		// Clean old responded messages
		for (const [sessionId, response] of this.respondedMessages.entries()) {
			const age = now - response.respondedAt;
			if (age > maxAge) {
				this.respondedMessages.delete(sessionId);
				cleaned++;
			}
		}

		if (cleaned > 0) {
			logger.info("Cleaned old entries", {
				cleaned,
				pendingCount: this.pendingMessages.size,
				respondedCount: this.respondedMessages.size,
			});
		}
	}

	/**
	 * Stop cleanup interval (for graceful shutdown)
	 */
	stop(): void {
		if (this.cleanupIntervalId) {
			clearInterval(this.cleanupIntervalId);
			this.cleanupIntervalId = undefined;
		}

		// Final report before shutdown
		const stats = this.getStats();
		logger.info("Shutdown - Final stats", stats);

		if (stats.overdue > 0) {
			this.checkAndAlertOverdue();
		}
	}

	/**
	 * Get pending message details for debugging
	 */
	getPendingMessage(sessionId: string): PendingMessage | undefined {
		return this.pendingMessages.get(sessionId);
	}

	/**
	 * Check if a session is being tracked
	 */
	isPending(sessionId: string): boolean {
		return this.pendingMessages.has(sessionId);
	}

	/**
	 * Check if a session was responded to
	 */
	wasResponded(sessionId: string): boolean {
		return this.respondedMessages.has(sessionId);
	}
}
