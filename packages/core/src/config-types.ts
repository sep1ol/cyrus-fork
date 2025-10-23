import type { Issue as LinearIssue } from "@linear/sdk";
import type { SDKMessage } from "cyrus-claude-runner";
import type { Workspace } from "./CyrusAgentSession.js";

/**
 * OAuth callback handler type
 */
export type OAuthCallbackHandler = (
	token: string,
	workspaceId: string,
	workspaceName: string,
) => Promise<void>;

/**
 * Configuration for a single repository/workspace pair
 */
export interface RepositoryConfig {
	// Repository identification
	id: string; // Unique identifier for this repo config
	name: string; // Display name (e.g., "Frontend App")

	// Git configuration
	repositoryPath: string; // Local git repository path
	baseBranch: string; // Branch to create worktrees from (main, master, etc.)

	// Linear configuration
	linearWorkspaceId: string; // Linear workspace/team ID
	linearWorkspaceName?: string; // Linear workspace display name (optional, for UI)
	linearToken: string; // OAuth token for this Linear workspace
	teamKeys?: string[]; // Linear team keys for routing (e.g., ["CEE", "BOOK"])
	routingLabels?: string[]; // Linear labels for routing issues to this repository (e.g., ["backend", "api"])
	projectKeys?: string[]; // Linear project names for routing (e.g., ["Mobile App", "API"])

	// Workspace configuration
	workspaceBaseDir: string; // Where to create issue workspaces for this repo

	// Optional settings
	isActive?: boolean; // Whether to process webhooks for this repo (default: true)
	promptTemplatePath?: string; // Custom prompt template for this repo
	allowedTools?: string[]; // Override Claude tools for this repository (overrides defaultAllowedTools)
	disallowedTools?: string[]; // Tools to explicitly disallow for this repository (no defaults)
	mcpConfigPath?: string | string[]; // Path(s) to MCP configuration JSON file(s) (format: {"mcpServers": {...}})
	appendInstruction?: string; // Additional instruction to append to the prompt in XML-style wrappers
	model?: string; // Claude model to use for this repository (e.g., "opus", "sonnet", "haiku")
	fallbackModel?: string; // Fallback model if primary model is unavailable

	// OpenAI configuration (for Sora video generation and DALL-E image generation)
	openaiApiKey?: string; // OpenAI API key for Sora and DALL-E
	openaiOutputDirectory?: string; // Directory to save generated media (defaults to workspace path)

	// Label-based system prompt configuration
	labelPrompts?: {
		debugger?: {
			labels: string[]; // Labels that trigger debugger mode (e.g., ["Bug"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for debugger mode
			disallowedTools?: string[]; // Tools to explicitly disallow in debugger mode
		};
		builder?: {
			labels: string[]; // Labels that trigger builder mode (e.g., ["Feature", "Improvement"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for builder mode
			disallowedTools?: string[]; // Tools to explicitly disallow in builder mode
		};
		scoper?: {
			labels: string[]; // Labels that trigger scoper mode (e.g., ["PRD"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for scoper mode
			disallowedTools?: string[]; // Tools to explicitly disallow in scoper mode
		};
		orchestrator?: {
			labels: string[]; // Labels that trigger orchestrator mode (e.g., ["Orchestrator"])
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator"; // Tool restrictions for orchestrator mode
			disallowedTools?: string[]; // Tools to explicitly disallow in orchestrator mode
		};
	};
}

/**
 * Configuration for the EdgeWorker supporting multiple repositories
 */
export interface EdgeWorkerConfig {
	// Proxy connection config
	proxyUrl: string;
	baseUrl?: string;
	webhookBaseUrl?: string; // Legacy support - use baseUrl instead
	webhookPort?: number; // Legacy support - now uses serverPort
	serverPort?: number; // Unified server port for both webhooks and OAuth callbacks (default: 3456)
	serverHost?: string; // Server host address ('localhost' or '0.0.0.0', default: 'localhost')
	ngrokAuthToken?: string; // Ngrok auth token for tunnel creation

	// Claude config (shared across all repos)
	defaultAllowedTools?: string[];
	defaultDisallowedTools?: string[]; // Tools to explicitly disallow across all repositories (no defaults)
	defaultModel?: string; // Default Claude model to use across all repositories (e.g., "opus", "sonnet", "haiku")
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable

	// Control mode configuration
	controlMode?: {
		enabled: boolean; // Enable controlled mode (requires explicit commands and approval)
	};

	// Global defaults for prompt types
	promptDefaults?: {
		debugger?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		builder?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		scoper?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
		orchestrator?: {
			allowedTools?: string[] | "readOnly" | "safe" | "all" | "coordinator";
			disallowedTools?: string[];
		};
	};

	// Repository configurations
	repositories: RepositoryConfig[];

	// Cyrus home directory
	cyrusHome: string;

	// Optional handlers that apps can implement
	handlers?: {
		// Called when workspace needs to be created
		// Now includes repository context
		createWorkspace?: (
			issue: LinearIssue,
			repository: RepositoryConfig,
		) => Promise<Workspace>;

		// Called with Claude messages (for UI updates, logging, etc)
		// Now includes repository ID
		onClaudeMessage?: (
			issueId: string,
			message: SDKMessage,
			repositoryId: string,
		) => void;

		// Called when session starts/ends
		// Now includes repository ID
		onSessionStart?: (
			issueId: string,
			issue: LinearIssue,
			repositoryId: string,
		) => void;
		onSessionEnd?: (
			issueId: string,
			exitCode: number | null,
			repositoryId: string,
		) => void;

		// Called on errors
		onError?: (error: Error, context?: any) => void;

		// Called when OAuth callback is received
		onOAuthCallback?: OAuthCallbackHandler;
	};

	// Optional features (can be overridden per repository)
	features?: {
		enableContinuation?: boolean; // Support --continue flag (default: true)
		enableTokenLimitHandling?: boolean; // Auto-handle token limits (default: true)
		enableAttachmentDownload?: boolean; // Download issue attachments (default: false)
		promptTemplatePath?: string; // Path to custom prompt template
	};
}

/**
 * Edge configuration containing all repositories and global settings
 */
export interface EdgeConfig {
	repositories: RepositoryConfig[];
	ngrokAuthToken?: string;
	stripeCustomerId?: string;
	defaultModel?: string; // Default Claude model to use across all repositories
	defaultFallbackModel?: string; // Default fallback model if primary model is unavailable
	global_setup_script?: string; // Optional path to global setup script that runs for all repositories
}
