/**
 * Structured logger using Pino
 * Provides correlation ID tracking and structured logging for better observability
 */

import pino from "pino";

export type LogContext = Record<string, unknown>;

export interface LoggerOptions {
	name?: string;
	level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
	prettyPrint?: boolean;
	correlationId?: string;
}

/**
 * Logger class wrapping Pino with additional features
 */
export class Logger {
	private logger: pino.Logger;
	private correlationId?: string;

	constructor(options: LoggerOptions = {}) {
		const {
			name = "cyrus-edge-worker",
			level = process.env.LOG_LEVEL || "info",
			prettyPrint = process.env.NODE_ENV !== "production",
			correlationId,
		} = options;

		this.correlationId = correlationId;

		this.logger = pino({
			name,
			level,
			...(prettyPrint && {
				transport: {
					target: "pino-pretty",
					options: {
						colorize: true,
						translateTime: "SYS:standard",
						ignore: "pid,hostname",
					},
				},
			}),
		});
	}

	/**
	 * Create a child logger with additional context
	 */
	child(context: LogContext): Logger {
		const childLogger = new Logger({
			name: this.logger.bindings().name as string,
			correlationId: this.correlationId,
		});
		childLogger.logger = this.logger.child(context);
		return childLogger;
	}

	/**
	 * Set correlation ID for request tracing
	 */
	setCorrelationId(correlationId: string): void {
		this.correlationId = correlationId;
	}

	/**
	 * Get current correlation ID
	 */
	getCorrelationId(): string | undefined {
		return this.correlationId;
	}

	/**
	 * Add correlation ID to context if available
	 */
	private withCorrelationId(context?: LogContext): LogContext {
		if (!this.correlationId) return context || {};
		return { ...context, correlationId: this.correlationId };
	}

	/**
	 * Trace level logging
	 */
	trace(message: string, context?: LogContext): void {
		this.logger.trace(this.withCorrelationId(context), message);
	}

	/**
	 * Debug level logging
	 */
	debug(message: string, context?: LogContext): void {
		this.logger.debug(this.withCorrelationId(context), message);
	}

	/**
	 * Info level logging
	 */
	info(message: string, context?: LogContext): void {
		this.logger.info(this.withCorrelationId(context), message);
	}

	/**
	 * Warn level logging
	 */
	warn(message: string, context?: LogContext): void {
		this.logger.warn(this.withCorrelationId(context), message);
	}

	/**
	 * Error level logging
	 */
	error(message: string, error?: Error | unknown, context?: LogContext): void {
		const errorContext = {
			...this.withCorrelationId(context),
			...(error instanceof Error && {
				error: {
					message: error.message,
					stack: error.stack,
					name: error.name,
				},
			}),
			...(typeof error === "string" && { errorMessage: error }),
		};
		this.logger.error(errorContext, message);
	}

	/**
	 * Fatal level logging
	 */
	fatal(message: string, error?: Error | unknown, context?: LogContext): void {
		const errorContext = {
			...this.withCorrelationId(context),
			...(error instanceof Error && {
				error: {
					message: error.message,
					stack: error.stack,
					name: error.name,
				},
			}),
		};
		this.logger.fatal(errorContext, message);
	}

	/**
	 * Log with custom level
	 */
	log(
		level: "trace" | "debug" | "info" | "warn" | "error" | "fatal",
		message: string,
		context?: LogContext,
	): void {
		this.logger[level](this.withCorrelationId(context), message);
	}
}

/**
 * Create a singleton logger instance for the application
 */
export const createLogger = (options?: LoggerOptions): Logger => {
	return new Logger(options);
};

/**
 * Default logger instance
 */
export const logger = createLogger();
