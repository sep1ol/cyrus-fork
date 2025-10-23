/**
 * ResponseVerifier
 *
 * Verifies that the thread reply + emoji check flow is working correctly.
 * Helps debug issues where:
 * - Session completes but doesn't post thread reply
 * - Metadata is missing or incorrect
 * - ⏳ → ✅ transition doesn't happen
 */

import { Logger } from "./Logger.js";

const logger = new Logger({ name: "ResponseVerifier" });

export interface SessionMetadata {
	shouldReplyInThread?: boolean;
	originalCommentId?: string;
	procedure?: any;
	[key: string]: any;
}

export interface SessionInfo {
	sessionId: string;
	issueId: string;
	metadata?: SessionMetadata;
	status?: string;
}

export interface VerificationResult {
	canReply: boolean;
	issues: string[];
	warnings: string[];
	metadata: {
		hasShouldReplyInThread: boolean;
		hasOriginalCommentId: boolean;
		shouldReplyInThreadValue?: boolean;
		originalCommentId?: string;
	};
}

/**
 * Verifies session state for thread reply capability
 */
export class ResponseVerifier {
	/**
	 * Verify if a session has all required data to post a thread reply
	 */
	static verifySessionCanReply(session: SessionInfo): VerificationResult {
		const issues: string[] = [];
		const warnings: string[] = [];

		// Check metadata existence
		if (!session.metadata) {
			issues.push("Session metadata is completely missing");
			return {
				canReply: false,
				issues,
				warnings,
				metadata: {
					hasShouldReplyInThread: false,
					hasOriginalCommentId: false,
				},
			};
		}

		const metadata = session.metadata;

		// Check shouldReplyInThread
		const hasShouldReplyInThread = "shouldReplyInThread" in metadata;
		if (!hasShouldReplyInThread) {
			issues.push("metadata.shouldReplyInThread is undefined (not set)");
		} else if (metadata.shouldReplyInThread === false) {
			warnings.push(
				"metadata.shouldReplyInThread is explicitly false (reply disabled)",
			);
		}

		// Check originalCommentId
		const hasOriginalCommentId = Boolean(metadata.originalCommentId);
		if (!hasOriginalCommentId) {
			issues.push("metadata.originalCommentId is missing");
		}

		// Check if session status indicates completion
		if (session.status && session.status !== "complete") {
			warnings.push(`Session status is "${session.status}" (not "complete")`);
		}

		const canReply =
			hasShouldReplyInThread &&
			metadata.shouldReplyInThread === true &&
			hasOriginalCommentId;

		return {
			canReply,
			issues,
			warnings,
			metadata: {
				hasShouldReplyInThread,
				hasOriginalCommentId,
				shouldReplyInThreadValue: metadata.shouldReplyInThread,
				originalCommentId: metadata.originalCommentId,
			},
		};
	}

	/**
	 * Log verification results for debugging
	 */
	static logVerification(sessionId: string, result: VerificationResult): void {
		if (result.canReply) {
			logger.info("Session CAN reply in thread", { sessionId });
		} else {
			logger.error("Session CANNOT reply in thread", {
				sessionId,
				issues: result.issues,
			});
		}

		if (result.warnings.length > 0) {
			logger.warn("Session verification warnings", {
				sessionId,
				warnings: result.warnings,
			});
		}

		logger.info("Session metadata state", {
			sessionId,
			shouldReplyInThread: result.metadata.hasShouldReplyInThread
				? result.metadata.shouldReplyInThreadValue
				: "NOT SET",
			originalCommentId: result.metadata.hasOriginalCommentId
				? result.metadata.originalCommentId
				: "NOT SET",
		});
	}

	/**
	 * Verify and log session reply capability
	 * Convenience method that combines verify + log
	 */
	static verifyAndLog(session: SessionInfo): boolean {
		const result = ResponseVerifier.verifySessionCanReply(session);
		ResponseVerifier.logVerification(session.sessionId, result);
		return result.canReply;
	}

	/**
	 * Check if metadata was likely lost during session lifecycle
	 */
	static detectMetadataLoss(
		initialMetadata?: SessionMetadata,
		currentMetadata?: SessionMetadata,
	): {
		lost: boolean;
		lostFields: string[];
	} {
		const lostFields: string[] = [];

		if (!initialMetadata || !currentMetadata) {
			return { lost: false, lostFields };
		}

		// Check critical fields
		if (
			initialMetadata.shouldReplyInThread &&
			!currentMetadata.shouldReplyInThread
		) {
			lostFields.push("shouldReplyInThread");
		}

		if (
			initialMetadata.originalCommentId &&
			!currentMetadata.originalCommentId
		) {
			lostFields.push("originalCommentId");
		}

		return {
			lost: lostFields.length > 0,
			lostFields,
		};
	}

	/**
	 * Generate diagnostic report for a session
	 */
	static generateDiagnostics(session: SessionInfo): string {
		const result = ResponseVerifier.verifySessionCanReply(session);

		let report = `\n📋 Session Diagnostics Report - ${session.sessionId}\n`;
		report += `${"=".repeat(60)}\n\n`;

		report += `Issue ID: ${session.issueId}\n`;
		report += `Session Status: ${session.status || "unknown"}\n`;
		report += `Can Reply: ${result.canReply ? "✅ YES" : "❌ NO"}\n\n`;

		if (result.issues.length > 0) {
			report += `🚨 ISSUES (${result.issues.length}):\n`;
			for (const issue of result.issues) {
				report += `  • ${issue}\n`;
			}
			report += `\n`;
		}

		if (result.warnings.length > 0) {
			report += `⚠️  WARNINGS (${result.warnings.length}):\n`;
			for (const warning of result.warnings) {
				report += `  • ${warning}\n`;
			}
			report += `\n`;
		}

		report += `📌 Metadata State:\n`;
		report += `  shouldReplyInThread: ${result.metadata.hasShouldReplyInThread ? result.metadata.shouldReplyInThreadValue : "NOT SET"}\n`;
		report += `  originalCommentId: ${result.metadata.hasOriginalCommentId ? result.metadata.originalCommentId : "NOT SET"}\n`;

		if (session.metadata?.procedure) {
			report += `  Has Procedure: Yes\n`;
			if (session.metadata.procedure.subroutineHistory) {
				report += `  Subroutines: ${session.metadata.procedure.subroutineHistory.length}\n`;
			}
		}

		report += `\n${"=".repeat(60)}\n`;

		return report;
	}
}
