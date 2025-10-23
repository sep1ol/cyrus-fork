/**
 * Retry utilities with exponential backoff and rate limiting
 */

import { Logger } from "./Logger.js";

const logger = new Logger({ name: "Retry" });

export interface RetryOptions {
	maxAttempts?: number; // Default: 3
	initialDelayMs?: number; // Default: 1000
	maxDelayMs?: number; // Default: 10000
	backoffMultiplier?: number; // Default: 2
	jitter?: boolean; // Add randomness to delays (default: true)
	onRetry?: (attempt: number, error: Error) => void;
}

export class RetryableError extends Error {
	constructor(
		message: string,
		public readonly cause?: Error,
	) {
		super(message);
		this.name = "RetryableError";
	}
}

/**
 * Retry a function with exponential backoff
 * @param fn Function to retry
 * @param options Retry configuration
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {
		maxAttempts = 3,
		initialDelayMs = 1000,
		maxDelayMs = 10000,
		backoffMultiplier = 2,
		jitter = true,
		onRetry,
	} = options;

	let lastError: Error | undefined;
	let attempt = 0;

	while (attempt < maxAttempts) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			attempt++;

			// If this was the last attempt, throw
			if (attempt >= maxAttempts) {
				throw new RetryableError(
					`Failed after ${maxAttempts} attempts: ${lastError.message}`,
					lastError,
				);
			}

			// Calculate delay with exponential backoff
			const baseDelay = Math.min(
				initialDelayMs * backoffMultiplier ** (attempt - 1),
				maxDelayMs,
			);

			// Add jitter (random variation) to avoid thundering herd
			const delay = jitter
				? baseDelay * (0.5 + Math.random() * 0.5)
				: baseDelay;

			// Call retry callback if provided
			if (onRetry) {
				onRetry(attempt, lastError);
			}

			logger.warn("Attempt failed, retrying", {
				attempt,
				maxAttempts,
				delayMs: Math.round(delay),
				error: lastError.message,
			});

			// Wait before retrying
			await sleep(delay);
		}
	}

	// This should never be reached due to the throw above, but TypeScript needs it
	throw new RetryableError(`Failed after ${maxAttempts} attempts`, lastError);
}

/**
 * Token bucket rate limiter
 * Limits number of operations per time window
 */
export class RateLimiter {
	private tokens: number;
	private lastRefillTime: number;
	private readonly maxTokens: number;
	private readonly refillRate: number; // tokens per millisecond

	constructor(maxRequestsPerSecond: number, burstSize?: number) {
		this.maxTokens = burstSize || maxRequestsPerSecond;
		this.tokens = this.maxTokens;
		this.refillRate = maxRequestsPerSecond / 1000; // Convert to per millisecond
		this.lastRefillTime = Date.now();
	}

	/**
	 * Acquire a token (wait if necessary)
	 * Returns when a token is available
	 */
	async acquire(tokensNeeded = 1): Promise<void> {
		// Refill tokens based on time passed
		this.refill();

		// If we have enough tokens, consume and return
		if (this.tokens >= tokensNeeded) {
			this.tokens -= tokensNeeded;
			return;
		}

		// Calculate wait time
		const tokensShort = tokensNeeded - this.tokens;
		const waitTimeMs = tokensShort / this.refillRate;

		// Wait
		await sleep(waitTimeMs);

		// Refill and consume
		this.refill();
		this.tokens -= tokensNeeded;
	}

	/**
	 * Try to acquire without waiting
	 * Returns true if token was acquired, false otherwise
	 */
	tryAcquire(tokensNeeded = 1): boolean {
		this.refill();

		if (this.tokens >= tokensNeeded) {
			this.tokens -= tokensNeeded;
			return true;
		}

		return false;
	}

	private refill(): void {
		const now = Date.now();
		const timePassed = now - this.lastRefillTime;
		const tokensToAdd = timePassed * this.refillRate;

		this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
		this.lastRefillTime = now;
	}
}

/**
 * Simple sleep utility
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wrap an async function with retry logic
 * Creates a new function that automatically retries on failure
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	options?: RetryOptions,
): T {
	return ((...args: Parameters<T>) =>
		retryWithBackoff(() => fn(...args), options)) as T;
}

/**
 * Wrap an async function with rate limiting
 * Creates a new function that respects rate limits
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	rateLimiter: RateLimiter,
): T {
	return (async (...args: Parameters<T>) => {
		await rateLimiter.acquire();
		return fn(...args);
	}) as T;
}
