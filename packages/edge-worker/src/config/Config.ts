import type { EdgeWorkerConfig } from "cyrus-core";
import { z } from "zod";
import {
	EdgeWorkerConfigSchema,
	EnvSchema,
	type ValidatedEdgeWorkerConfig,
	type ValidatedEnv,
} from "./ConfigSchema.js";

/**
 * Centralized configuration class
 * Validates all config and env vars on construction
 */
export class Config {
	readonly edgeWorkerConfig: ValidatedEdgeWorkerConfig;
	readonly env: ValidatedEnv;

	private constructor(
		edgeWorkerConfig: ValidatedEdgeWorkerConfig,
		env: ValidatedEnv,
	) {
		this.edgeWorkerConfig = edgeWorkerConfig;
		this.env = env;
	}

	/**
	 * Create Config from EdgeWorkerConfig object
	 * Validates the config and throws if invalid
	 */
	static fromConfig(config: EdgeWorkerConfig): Config {
		try {
			const validatedConfig = EdgeWorkerConfigSchema.parse(config);
			const validatedEnv = EnvSchema.parse(process.env);

			return new Config(validatedConfig, validatedEnv);
		} catch (error) {
			if (error instanceof z.ZodError) {
				const issues = error.issues
					.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
					.join("\n");
				throw new Error(
					`Configuration validation failed:\n${issues}\n\nPlease check your config.json or environment variables.`,
				);
			}
			throw error;
		}
	}

	/**
	 * Create Config from environment variables only
	 * Useful for testing or minimal setups
	 */
	static fromEnv(): Config {
		try {
			const validatedEnv = EnvSchema.parse(process.env);

			// Create minimal config from env vars
			const minimalConfig: EdgeWorkerConfig = {
				proxyUrl: validatedEnv.PROXY_URL || "https://default-proxy.com",
				repositories: [],
				cyrusHome: process.env.HOME || "/tmp",
			};

			const validatedConfig = EdgeWorkerConfigSchema.parse(minimalConfig);
			return new Config(validatedConfig, validatedEnv);
		} catch (error) {
			if (error instanceof z.ZodError) {
				const issues = error.issues
					.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
					.join("\n");
				throw new Error(
					`Environment validation failed:\n${issues}\n\nPlease check your environment variables.`,
				);
			}
			throw error;
		}
	}

	// Convenience getters for common env vars
	get proxyUrl(): string {
		return this.env.PROXY_URL || this.edgeWorkerConfig.proxyUrl;
	}

	get cyrusBaseUrl(): string | undefined {
		return this.env.CYRUS_BASE_URL || this.edgeWorkerConfig.baseUrl;
	}

	get isExternalHost(): boolean {
		return this.env.CYRUS_HOST_EXTERNAL || false;
	}

	get linearClientId(): string | undefined {
		return this.env.LINEAR_CLIENT_ID;
	}

	get linearClientSecret(): string | undefined {
		return this.env.LINEAR_CLIENT_SECRET;
	}

	get useLinearDirectWebhooks(): boolean {
		return this.env.LINEAR_DIRECT_WEBHOOKS || false;
	}

	get isDebugMode(): boolean {
		return this.env.DEBUG_EDGE || false;
	}

	get isWebhookDebugMode(): boolean {
		return this.env.CYRUS_WEBHOOK_DEBUG || false;
	}

	get nodeEnv(): "development" | "production" | "test" {
		return this.env.NODE_ENV || "development";
	}
}
