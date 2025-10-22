/**
 * Application-wide constants
 * Eliminates magic numbers and centralizes configuration values
 */

// Time constants (in milliseconds)
export const TIME = {
	/** 5 minutes in milliseconds */
	FIVE_MINUTES: 5 * 60 * 1000,
	/** 30 minutes in milliseconds */
	THIRTY_MINUTES: 30 * 60 * 1000,
	/** 2 seconds in milliseconds */
	TWO_SECONDS: 2000,
	/** 300 milliseconds (for debouncing) */
	DEBOUNCE_DELAY: 300,
	/** 30 seconds graceful shutdown timeout */
	GRACEFUL_SHUTDOWN_TIMEOUT: 30 * 1000,
	/** 24 hours in milliseconds */
	ONE_DAY: 24 * 60 * 60 * 1000,
} as const;

// Linear API constants
export const LINEAR_API = {
	/** Linear API rate limit: 10 requests per second */
	RATE_LIMIT_REQUESTS_PER_SECOND: 10,
	/** Default retry attempts for API calls */
	DEFAULT_RETRY_ATTEMPTS: 3,
	/** Initial retry delay in milliseconds */
	INITIAL_RETRY_DELAY_MS: 1000,
	/** Retry delay for reactions (faster) */
	REACTION_RETRY_DELAY_MS: 500,
	/** Maximum retry delay in milliseconds */
	MAX_RETRY_DELAY_MS: 10000,
} as const;

// Webhook constants
export const WEBHOOK = {
	/** Maximum webhook request body size (10MB) */
	MAX_BODY_SIZE_BYTES: 10 * 1024 * 1024,
	/** Default webhook server port */
	DEFAULT_PORT: 3456,
	/** Default webhook server host */
	DEFAULT_HOST: "localhost",
} as const;

// Session cleanup constants
export const SESSION_CLEANUP = {
	/** Time to keep completed sessions before cleanup */
	COMPLETED_SESSION_TTL: TIME.ONE_DAY,
	/** Time to keep session reactions before cleanup */
	SESSION_REACTION_TTL: TIME.FIVE_MINUTES,
	/** Time to keep bot comment tracking */
	BOT_COMMENT_TTL: TIME.FIVE_MINUTES,
	/** Time to keep bot parent comment tracking */
	BOT_PARENT_COMMENT_TTL: TIME.THIRTY_MINUTES,
	/** Time to keep thread reply tracking */
	THREAD_REPLY_TTL: TIME.FIVE_MINUTES,
	/** Cleanup interval for periodic cleanup */
	CLEANUP_INTERVAL: TIME.FIVE_MINUTES,
} as const;

// Procedure routing constants
export const PROCEDURE_ROUTING = {
	/** Default routing classification timeout */
	CLASSIFICATION_TIMEOUT_MS: 10000,
	/** Default routing model */
	DEFAULT_MODEL: "haiku",
	/** Fallback model */
	FALLBACK_MODEL: "sonnet",
} as const;

// OAuth constants
export const OAUTH = {
	/** OAuth flow timeout */
	FLOW_TIMEOUT: TIME.FIVE_MINUTES,
} as const;

// Approval workflow constants
export const APPROVAL = {
	/** Approval request timeout */
	TIMEOUT: TIME.THIRTY_MINUTES,
} as const;
