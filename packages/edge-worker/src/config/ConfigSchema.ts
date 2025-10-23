import { z } from "zod";

/**
 * Zod schema for repository configuration
 * Validates all required and optional fields with proper types
 */
export const RepositoryConfigSchema = z.object({
	// Required fields
	id: z.string().min(1, "Repository ID is required"),
	name: z.string().min(1, "Repository name is required"),
	repositoryPath: z.string().min(1, "Repository path is required"),
	baseBranch: z.string().default("main"),
	linearWorkspaceId: z.string().min(1, "Linear workspace ID is required"),
	linearToken: z.string().min(1, "Linear token is required"),
	workspaceBaseDir: z.string().min(1, "Workspace base directory is required"),

	// Optional fields
	linearWorkspaceName: z.string().optional(),
	teamKeys: z.array(z.string()).optional(),
	routingLabels: z.array(z.string()).optional(),
	projectKeys: z.array(z.string()).optional(),
	isActive: z.boolean().default(true),
	promptTemplatePath: z.string().optional(),
	allowedTools: z.array(z.string()).optional(),
	disallowedTools: z.array(z.string()).optional(),
	mcpConfigPath: z.union([z.string(), z.array(z.string())]).optional(),
	appendInstruction: z.string().optional(),
	model: z.string().optional(),
	fallbackModel: z.string().optional(),
	openaiApiKey: z.string().optional(),
	openaiOutputDirectory: z.string().optional(),

	// Label-based prompt configuration
	labelPrompts: z
		.object({
			debugger: z
				.object({
					labels: z.array(z.string()),
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
			builder: z
				.object({
					labels: z.array(z.string()),
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
			scoper: z
				.object({
					labels: z.array(z.string()),
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
			orchestrator: z
				.object({
					labels: z.array(z.string()),
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
		})
		.optional(),
});

/**
 * Zod schema for EdgeWorker configuration
 * Validates all configuration fields including repositories
 */
export const EdgeWorkerConfigSchema = z.object({
	// Required fields
	proxyUrl: z.string().url("Proxy URL must be a valid URL"),
	repositories: z
		.array(RepositoryConfigSchema)
		.min(1, "At least one repository is required"),
	cyrusHome: z.string().min(1, "Cyrus home directory is required"),

	// Optional server config
	baseUrl: z.string().url().optional(),
	webhookBaseUrl: z.string().url().optional(), // Legacy
	webhookPort: z.number().int().min(1).max(65535).optional(), // Legacy
	serverPort: z.number().int().min(1).max(65535).default(3456),
	serverHost: z.string().default("localhost"),
	ngrokAuthToken: z.string().optional(),

	// Claude configuration
	defaultAllowedTools: z.array(z.string()).optional(),
	defaultDisallowedTools: z.array(z.string()).optional(),
	defaultModel: z.string().optional(),
	defaultFallbackModel: z.string().optional(),

	// Control mode
	controlMode: z
		.object({
			enabled: z.boolean(),
		})
		.optional(),

	// Prompt defaults
	promptDefaults: z
		.object({
			debugger: z
				.object({
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
			builder: z
				.object({
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
			scoper: z
				.object({
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
			orchestrator: z
				.object({
					allowedTools: z
						.union([
							z.array(z.string()),
							z.literal("readOnly"),
							z.literal("safe"),
							z.literal("all"),
							z.literal("coordinator"),
						])
						.optional(),
					disallowedTools: z.array(z.string()).optional(),
				})
				.optional(),
		})
		.optional(),

	// Features
	features: z
		.object({
			enableContinuation: z.boolean().default(true),
			enableTokenLimitHandling: z.boolean().default(true),
			enableAttachmentDownload: z.boolean().default(false),
			promptTemplatePath: z.string().optional(),
		})
		.optional(),

	// Handlers - não validamos funções, mas permitimos que existam
	handlers: z.any().optional(),
});

/**
 * Schema for environment variables
 * Validates all process.env.* usage centrally
 */
export const EnvSchema = z.object({
	// Proxy/Server config
	PROXY_URL: z.string().url().optional(),
	CYRUS_BASE_URL: z.string().url().optional(),
	CYRUS_HOST_EXTERNAL: z
		.string()
		.transform((v) => v?.toLowerCase().trim() === "true")
		.optional(),

	// Linear config
	LINEAR_CLIENT_ID: z.string().optional(),
	LINEAR_CLIENT_SECRET: z.string().optional(),
	LINEAR_DIRECT_WEBHOOKS: z
		.string()
		.transform((v) => v?.toLowerCase().trim() === "true")
		.optional(),

	// Debug flags
	DEBUG_EDGE: z
		.string()
		.transform((v) => v === "true")
		.optional(),
	CYRUS_WEBHOOK_DEBUG: z
		.string()
		.transform((v) => v === "true")
		.optional(),

	// Node environment
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development"),
});

// Type exports
export type ValidatedRepositoryConfig = z.infer<typeof RepositoryConfigSchema>;
export type ValidatedEdgeWorkerConfig = z.infer<typeof EdgeWorkerConfigSchema>;
export type ValidatedEnv = z.infer<typeof EnvSchema>;
