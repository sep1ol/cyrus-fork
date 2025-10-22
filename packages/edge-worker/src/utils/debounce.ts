/**
 * Debounce utility to prevent rapid-fire function calls
 * Useful for file watchers, API rate limiting, etc.
 */

/**
 * Debounce a function call
 * @param fn Function to debounce
 * @param delayMs Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
	fn: T,
	delayMs: number,
): (...args: Parameters<T>) => void {
	let timeoutId: NodeJS.Timeout | null = null;

	return function debounced(...args: Parameters<T>): void {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		timeoutId = setTimeout(() => {
			fn(...args);
			timeoutId = null;
		}, delayMs);
	};
}

/**
 * Debounce an async function call
 * @param fn Async function to debounce
 * @param delayMs Delay in milliseconds
 * @returns Debounced async function
 */
export function debounceAsync<T extends (...args: any[]) => Promise<any>>(
	fn: T,
	delayMs: number,
): (...args: Parameters<T>) => Promise<void> {
	let timeoutId: NodeJS.Timeout | null = null;
	let pendingPromise: Promise<void> | null = null;

	return async function debounced(...args: Parameters<T>): Promise<void> {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}

		// Return existing pending promise if one exists
		if (pendingPromise) {
			return pendingPromise;
		}

		pendingPromise = new Promise<void>((resolve) => {
			timeoutId = setTimeout(async () => {
				try {
					await fn(...args);
				} finally {
					timeoutId = null;
					pendingPromise = null;
					resolve();
				}
			}, delayMs);
		});

		return pendingPromise;
	};
}

/**
 * Throttle a function call (execute at most once per period)
 * Unlike debounce, this executes immediately and then blocks subsequent calls
 * @param fn Function to throttle
 * @param delayMs Minimum delay between executions
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
	fn: T,
	delayMs: number,
): (...args: Parameters<T>) => void {
	let lastCallTime = 0;
	let timeoutId: NodeJS.Timeout | null = null;

	return function throttled(...args: Parameters<T>): void {
		const now = Date.now();
		const timeSinceLastCall = now - lastCallTime;

		if (timeSinceLastCall >= delayMs) {
			// Execute immediately if enough time has passed
			lastCallTime = now;
			fn(...args);
		} else if (!timeoutId) {
			// Schedule next execution
			const remainingTime = delayMs - timeSinceLastCall;
			timeoutId = setTimeout(() => {
				lastCallTime = Date.now();
				fn(...args);
				timeoutId = null;
			}, remainingTime);
		}
	};
}
