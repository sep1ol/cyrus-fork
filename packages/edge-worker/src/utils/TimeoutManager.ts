/**
 * Centralized timeout management
 * Prevents memory leaks by tracking all timeouts and allowing bulk cleanup
 */

import { Logger } from "./Logger.js";

const logger = new Logger({ name: "TimeoutManager" });

export class TimeoutManager {
	private timeouts: Map<string, NodeJS.Timeout> = new Map();
	private anonymousTimeouts: Set<NodeJS.Timeout> = new Set();
	private _isShutdown = false;

	/**
	 * Schedule a timeout with an ID for later reference
	 * @param id Unique identifier for this timeout
	 * @param callback Function to call when timeout expires
	 * @param delayMs Delay in milliseconds
	 */
	schedule(id: string, callback: () => void, delayMs: number): void {
		if (this._isShutdown) {
			logger.warn("Cannot schedule timeout - manager is shutdown", { id });
			return;
		}

		// Clear existing timeout with same ID if any
		this.clear(id);

		const timeout = setTimeout(() => {
			callback();
			this.timeouts.delete(id);
		}, delayMs);

		this.timeouts.set(id, timeout);
	}

	/**
	 * Schedule an anonymous timeout (no ID)
	 * Use this for one-off timeouts that don't need to be referenced later
	 */
	scheduleAnonymous(callback: () => void, delayMs: number): void {
		if (this._isShutdown) {
			logger.warn("Cannot schedule anonymous timeout - manager is shutdown");
			return;
		}

		const timeout = setTimeout(() => {
			callback();
			this.anonymousTimeouts.delete(timeout);
		}, delayMs);

		this.anonymousTimeouts.add(timeout);
	}

	/**
	 * Clear a specific timeout by ID
	 */
	clear(id: string): boolean {
		const timeout = this.timeouts.get(id);
		if (timeout) {
			clearTimeout(timeout);
			this.timeouts.delete(id);
			return true;
		}
		return false;
	}

	/**
	 * Clear all scheduled timeouts
	 * Useful for cleanup and testing
	 */
	clearAll(): void {
		// Clear named timeouts
		for (const [id, timeout] of this.timeouts.entries()) {
			clearTimeout(timeout);
			logger.debug("Cleared timeout", { id });
		}
		this.timeouts.clear();

		// Clear anonymous timeouts
		for (const timeout of this.anonymousTimeouts) {
			clearTimeout(timeout);
		}
		this.anonymousTimeouts.clear();

		logger.info("All timeouts cleared");
	}

	/**
	 * Get number of active timeouts
	 */
	get activeCount(): number {
		return this.timeouts.size + this.anonymousTimeouts.size;
	}

	/**
	 * Get all timeout IDs
	 */
	get timeoutIds(): string[] {
		return Array.from(this.timeouts.keys());
	}

	/**
	 * Check if a timeout exists
	 */
	has(id: string): boolean {
		return this.timeouts.has(id);
	}

	/**
	 * Shutdown the timeout manager
	 * Clears all timeouts and prevents new ones from being scheduled
	 */
	shutdown(): void {
		if (this._isShutdown) {
			return;
		}

		logger.info("Shutting down");
		this.clearAll();
		this._isShutdown = true;
	}

	/**
	 * Check if manager is shutdown
	 */
	get isShutdown(): boolean {
		return this._isShutdown;
	}
}
