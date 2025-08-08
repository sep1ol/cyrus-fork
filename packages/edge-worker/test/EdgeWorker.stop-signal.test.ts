import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker";
import type { EdgeWorkerConfig } from "../src/types";
import type { LinearAgentSessionPromptedWebhook } from "cyrus-core/webhook-types";
import { AgentSessionManager } from "../src/AgentSessionManager";
import { SharedApplicationServer } from "../src/SharedApplicationServer";
import { ClaudeRunner } from "cyrus-claude-runner";
import { LinearClient } from "@linear/sdk";

// Mock external dependencies
vi.mock("cyrus-claude-runner");
vi.mock("../src/AgentSessionManager");
vi.mock("../src/SharedApplicationServer");
vi.mock("fs/promises");
vi.mock("@linear/sdk");

describe("EdgeWorker - Stop Signal Handling", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockSessionManager: any;
	let mockClaudeRunner: any;
	let mockLinearClient: any;

	beforeEach(() => {
		// Setup mock config
		mockConfig = {
			getServerUrl: vi.fn().mockReturnValue("http://localhost:3000"),
			LINEAR_API_TOKEN: "test-token",
			LINEAR_WORKSPACE_ID: "test-workspace",
			LINEAR_ASSIGNED_USER_ID: "test-user",
			MODELS: {
				planning: "claude-3-5-sonnet",
				command: "claude-3-5-sonnet",
			},
			ALLOWED_TOOLS: ["*"],
			getApiKey: vi.fn().mockReturnValue("test-api-key"),
			LOG_CLAUDE_RUNNER_OUTPUT: false,
			INTERNAL_API_TOKEN: "test-internal-token",
			GITHUB_OAUTH_PROXY_URL: null,
			LINEAR_OAUTH_TOKEN_URL: null,
			getLinearApiKey: vi.fn().mockReturnValue("test-linear-key"),
			getGithubApiKey: vi.fn().mockReturnValue(null),
			LOG_PREFIX: "test",
			githubApp: null,
			linearApp: null,
			repositories: [],
		};

		// Setup mock session manager
		mockSessionManager = {
			createResponseActivity: vi.fn().mockResolvedValue(undefined),
			getSession: vi.fn(),
			createAgentSession: vi.fn(),
		};
		vi.mocked(AgentSessionManager).mockImplementation(() => mockSessionManager);

		// Setup mock Claude runner
		mockClaudeRunner = {
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(false),
			addStreamMessage: vi.fn(),
		};
		vi.mocked(ClaudeRunner).mockImplementation(() => mockClaudeRunner);

		// Setup mock Linear client
		mockLinearClient = {
			client: {
				rawRequest: vi.fn().mockResolvedValue({
					comment: {
						id: "comment-id",
						body: "Test comment",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
						user: {
							name: "Test User",
							id: "user-id",
						},
					},
				}),
			},
		};
		vi.mocked(LinearClient).mockImplementation(() => mockLinearClient);

		// Setup mock shared application server
		const mockSharedServer = {
			getRepositoryById: vi.fn().mockReturnValue({
				id: "test-repo",
				githubName: "test-repo",
				linearTeamId: "test-team",
			}),
		};
		vi.mocked(SharedApplicationServer).mockImplementation(() => mockSharedServer);

		// Create EdgeWorker instance
		edgeWorker = new EdgeWorker(mockConfig);
		
		// Setup agentSessionManagers map
		(edgeWorker as any).agentSessionManagers = new Map();
		(edgeWorker as any).agentSessionManagers.set("test-repo", mockSessionManager);

		// Setup linearClients map
		(edgeWorker as any).linearClients = new Map();
		(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

		// Mock mkdir
		vi.mock("fs/promises", () => ({
			mkdir: vi.fn().mockResolvedValue(undefined),
		}));

		// Mock postInstantPromptedAcknowledgment
		(edgeWorker as any).postInstantPromptedAcknowledgment = vi.fn().mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("handleUserPostedAgentActivity with stop signal", () => {
		it("should stop an active streaming session when stop signal is received", async () => {
			// Mock repository
			const repository = {
				id: "test-repo",
				githubName: "test-repo",
				linearTeamId: "test-team",
				linearToken: "test-token",
			};

			// Mock an existing streaming session
			mockClaudeRunner.isStreaming.mockReturnValue(true);
			mockSessionManager.getSession.mockReturnValue({
				linearAgentActivitySessionId: "test-session-id",
				claudeSessionId: "claude-session-id",
				claudeRunner: mockClaudeRunner,
				workspace: { path: "/test/workspace" },
			});

			// Create webhook with stop signal
			const webhook: LinearAgentSessionPromptedWebhook = {
				type: "AgentSessionEvent",
				action: "prompted",
				createdAt: new Date().toISOString(),
				organizationId: "test-org",
				oauthClientId: "test-client",
				appUserId: "test-user",
				agentSession: {
					id: "session-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					status: "active",
					startedAt: new Date().toISOString(),
					endedAt: null,
					type: "commentThread",
					summary: null,
					creator: {
						id: "creator-id",
						name: "Test User",
						email: "test@example.com",
						avatarUrl: "https://example.com/avatar.png",
						url: "https://linear.app/user/creator-id",
					},
					creatorId: "creator-id",
					appUserId: "test-user",
					comment: {
						id: "comment-id",
						body: "Test comment",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					commentId: "comment-id",
					issue: {
						id: "issue-id",
						title: "Test Issue",
						identifier: "TEST-123",
						url: "https://linear.app/test/issue/TEST-123",
					},
					issueId: "issue-id",
					organizationId: "test-org",
					sourceMetadata: null,
				},
				agentActivity: {
					id: "activity-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					agentContextId: null,
					agentSessionId: "session-id",
					sourceCommentId: "comment-id",
					content: {
						type: "prompt",
						body: "stop",
					},
					signal: "stop", // This is the key field
				},
				webhookTimestamp: Date.now().toString(),
				webhookId: "webhook-id",
			};

			// Call the method
			await (edgeWorker as any).handleUserPostedAgentActivity(webhook, repository);

			// Verify Claude runner was stopped
			expect(mockClaudeRunner.stop).toHaveBeenCalledTimes(1);

			// Verify response was sent to Linear
			expect(mockSessionManager.createResponseActivity).toHaveBeenCalledWith(
				"session-id",
				expect.stringContaining("I've stopped working on Test Issue as requested"),
			);

			// Verify the response contains the expected elements
			const responseCall = mockSessionManager.createResponseActivity.mock.calls[0];
			const responseMessage = responseCall[1];
			expect(responseMessage).toContain("Session Status:** active session terminated");
			expect(responseMessage).toContain("Stop Signal:** Received from Test User");
			expect(responseMessage).toContain("Action Taken:** All ongoing work has been halted");
		});

		it("should handle stop signal when no active session exists", async () => {
			// Mock repository
			const repository = {
				id: "test-repo",
				githubName: "test-repo",
				linearTeamId: "test-team",
				linearToken: "test-token",
			};

			// Mock no existing session
			mockSessionManager.getSession.mockReturnValue({
				linearAgentActivitySessionId: "test-session-id",
				claudeSessionId: "claude-session-id",
				claudeRunner: null, // No runner
				workspace: { path: "/test/workspace" },
			});

			// Create webhook with stop signal
			const webhook: LinearAgentSessionPromptedWebhook = {
				type: "AgentSessionEvent",
				action: "prompted",
				createdAt: new Date().toISOString(),
				organizationId: "test-org",
				oauthClientId: "test-client",
				appUserId: "test-user",
				agentSession: {
					id: "session-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					status: "active",
					startedAt: new Date().toISOString(),
					endedAt: null,
					type: "commentThread",
					summary: null,
					creator: {
						id: "creator-id",
						name: "Test User",
						email: "test@example.com",
						avatarUrl: "https://example.com/avatar.png",
						url: "https://linear.app/user/creator-id",
					},
					creatorId: "creator-id",
					appUserId: "test-user",
					comment: {
						id: "comment-id",
						body: "Test comment",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					commentId: "comment-id",
					issue: {
						id: "issue-id",
						title: "Test Issue",
						identifier: "TEST-123",
						url: "https://linear.app/test/issue/TEST-123",
					},
					issueId: "issue-id",
					organizationId: "test-org",
					sourceMetadata: null,
				},
				agentActivity: {
					id: "activity-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					agentContextId: null,
					agentSessionId: "session-id",
					sourceCommentId: "comment-id",
					content: {
						type: "prompt",
						body: "stop",
					},
					signal: "stop",
				},
				webhookTimestamp: Date.now().toString(),
				webhookId: "webhook-id",
			};

			// Call the method
			await (edgeWorker as any).handleUserPostedAgentActivity(webhook, repository);

			// Verify Claude runner was NOT called (no runner exists)
			expect(mockClaudeRunner.stop).not.toHaveBeenCalled();

			// Verify response was still sent to Linear
			expect(mockSessionManager.createResponseActivity).toHaveBeenCalledWith(
				"session-id",
				expect.stringContaining("I've stopped working on Test Issue as requested"),
			);

			// Verify the response indicates idle session
			const responseCall = mockSessionManager.createResponseActivity.mock.calls[0];
			const responseMessage = responseCall[1];
			expect(responseMessage).toContain("Session Status:** idle session terminated");
		});

		it("should continue normal processing when no stop signal is present", async () => {
			// Mock repository
			const repository = {
				id: "test-repo",
				githubName: "test-repo",
				linearTeamId: "test-team",
				linearToken: "test-token",
			};

			// Mock global fetch
			global.fetch = vi.fn();

			// Mock an existing non-streaming session
			mockClaudeRunner.isStreaming.mockReturnValue(false);
			mockSessionManager.getSession.mockReturnValue({
				linearAgentActivitySessionId: "test-session-id",
				claudeSessionId: "claude-session-id",
				claudeRunner: mockClaudeRunner,
				workspace: { path: "/test/workspace" },
			});

			// Create webhook WITHOUT stop signal
			const webhook: LinearAgentSessionPromptedWebhook = {
				type: "AgentSessionEvent",
				action: "prompted",
				createdAt: new Date().toISOString(),
				organizationId: "test-org",
				oauthClientId: "test-client",
				appUserId: "test-user",
				agentSession: {
					id: "session-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					status: "active",
					startedAt: new Date().toISOString(),
					endedAt: null,
					type: "commentThread",
					summary: null,
					creator: {
						id: "creator-id",
						name: "Test User",
						email: "test@example.com",
						avatarUrl: "https://example.com/avatar.png",
						url: "https://linear.app/user/creator-id",
					},
					creatorId: "creator-id",
					appUserId: "test-user",
					comment: {
						id: "comment-id",
						body: "Test comment",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					commentId: "comment-id",
					issue: {
						id: "issue-id",
						title: "Test Issue",
						identifier: "TEST-123",
						url: "https://linear.app/test/issue/TEST-123",
					},
					issueId: "issue-id",
					organizationId: "test-org",
					sourceMetadata: null,
				},
				agentActivity: {
					id: "activity-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					agentContextId: null,
					agentSessionId: "session-id",
					sourceCommentId: "comment-id",
					content: {
						type: "prompt",
						body: "Please help me with this issue",
					},
					// No signal field
				},
				webhookTimestamp: Date.now().toString(),
				webhookId: "webhook-id",
			};

			// Mock fetch for full issue details
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: {
						issue: {
							id: "issue-id",
							labels: { nodes: [] },
						},
					},
				}),
			});

			// Call the method
			await (edgeWorker as any).handleUserPostedAgentActivity(webhook, repository);

			// Verify stop response was NOT sent
			expect(mockSessionManager.createResponseActivity).not.toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining("I've stopped working"),
			);

			// Verify normal flow continues (runner is stopped because it's not streaming)
			expect(mockClaudeRunner.stop).toHaveBeenCalledTimes(1);
		});

		it("should handle stop signal with undefined signal field gracefully", async () => {
			// Mock repository
			const repository = {
				id: "test-repo",
				githubName: "test-repo",
				linearTeamId: "test-team",
				linearToken: "test-token",
			};

			// Mock global fetch
			global.fetch = vi.fn();

			// Mock an existing session
			mockSessionManager.getSession.mockReturnValue({
				linearAgentActivitySessionId: "test-session-id",
				claudeSessionId: "claude-session-id",
				claudeRunner: mockClaudeRunner,
				workspace: { path: "/test/workspace" },
			});

			// Create webhook with stop body text but no signal field
			const webhook: LinearAgentSessionPromptedWebhook = {
				type: "AgentSessionEvent",
				action: "prompted",
				createdAt: new Date().toISOString(),
				organizationId: "test-org",
				oauthClientId: "test-client",
				appUserId: "test-user",
				agentSession: {
					id: "session-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					status: "active",
					startedAt: new Date().toISOString(),
					endedAt: null,
					type: "commentThread",
					summary: null,
					creator: null, // Test null creator
					creatorId: "creator-id",
					appUserId: "test-user",
					comment: {
						id: "comment-id",
						body: "Test comment",
						createdAt: new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					},
					commentId: "comment-id",
					issue: {
						id: "issue-id",
						title: "", // Test empty title
						identifier: "TEST-123",
						url: "https://linear.app/test/issue/TEST-123",
					},
					issueId: "issue-id",
					organizationId: "test-org",
					sourceMetadata: null,
				},
				agentActivity: {
					id: "activity-id",
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
					archivedAt: null,
					agentContextId: null,
					agentSessionId: "session-id",
					sourceCommentId: "comment-id",
					content: {
						type: "prompt",
						body: "stop", // User typed "stop" but no signal field
					},
					signal: undefined, // Explicitly undefined
				},
				webhookTimestamp: Date.now().toString(),
				webhookId: "webhook-id",
			};

			// Mock fetch for full issue details
			(global.fetch as any).mockResolvedValueOnce({
				ok: true,
				json: vi.fn().mockResolvedValue({
					data: {
						issue: {
							id: "issue-id",
							labels: { nodes: [] },
						},
					},
				}),
			});

			// Call the method
			await (edgeWorker as any).handleUserPostedAgentActivity(webhook, repository);

			// Verify stop response was NOT sent (no signal, just text)
			expect(mockSessionManager.createResponseActivity).not.toHaveBeenCalledWith(
				expect.any(String),
				expect.stringContaining("I've stopped working"),
			);
		});
	});
});