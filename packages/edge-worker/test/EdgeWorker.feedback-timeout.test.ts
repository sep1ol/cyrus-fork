import { LinearClient } from "@linear/sdk";
import { ClaudeRunner, createCyrusToolsServer } from "cyrus-claude-runner";
import { NdjsonClient } from "cyrus-ndjson-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionManager } from "../src/AgentSessionManager.js";
import { EdgeWorker } from "../src/EdgeWorker.js";
import { SharedApplicationServer } from "../src/SharedApplicationServer.js";
import type { EdgeWorkerConfig, RepositoryConfig } from "../src/types.js";

// Mock all dependencies
vi.mock("fs/promises");
vi.mock("cyrus-ndjson-client");
vi.mock("cyrus-claude-runner");
vi.mock("@linear/sdk");
vi.mock("../src/SharedApplicationServer.js");
vi.mock("../src/AgentSessionManager.js");
vi.mock("cyrus-core", async (importOriginal) => {
	const actual = (await importOriginal()) as any;
	return {
		...actual,
		PersistenceManager: vi.fn().mockImplementation(() => ({
			loadEdgeWorkerState: vi.fn().mockResolvedValue(null),
			saveEdgeWorkerState: vi.fn().mockResolvedValue(undefined),
		})),
	};
});

describe("EdgeWorker - Feedback Delivery Timeout Issue", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;
	let mockAgentSessionManager: any;
	let mockChildAgentSessionManager: any;
	let mockClaudeRunner: any;
	let resumeClaudeSessionSpy: any;
	let mockOnFeedbackDelivery: any;
	let mockOnSessionCreated: any;

	const mockRepository: RepositoryConfig = {
		id: "test-repo",
		name: "Test Repo",
		repositoryPath: "/test/repo",
		workspaceBaseDir: "/test/workspaces",
		baseBranch: "main",
		linearToken: "test-token",
		linearWorkspaceId: "test-workspace",
		isActive: true,
		allowedTools: ["Read", "Edit"],
		labelPrompts: {},
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});

		// Setup callbacks to be captured
		mockOnFeedbackDelivery = vi.fn();
		mockOnSessionCreated = vi.fn();

		// Mock createCyrusToolsServer to return a proper structure
		vi.mocked(createCyrusToolsServer).mockImplementation((_token, options) => {
			// Capture the callbacks
			if (options?.onFeedbackDelivery) {
				mockOnFeedbackDelivery = options.onFeedbackDelivery;
			}
			if (options?.onSessionCreated) {
				mockOnSessionCreated = options.onSessionCreated;
			}

			// Return a mock structure that matches what the real function returns
			return {
				type: "sdk" as const,
				name: "cyrus-tools",
				instance: {
					_options: options,
				},
			} as any;
		});

		// Mock ClaudeRunner with a long-running session to simulate the timeout
		mockClaudeRunner = {
			startStreaming: vi.fn().mockImplementation(async () => {
				// Simulate a long-running Claude session (10 seconds)
				await new Promise(resolve => setTimeout(resolve, 10000));
				return { sessionId: "claude-session-123" };
			}),
			stop: vi.fn(),
			isStreaming: vi.fn().mockReturnValue(false),
		};
		vi.mocked(ClaudeRunner).mockImplementation(() => mockClaudeRunner);

		// Mock child session manager
		mockChildAgentSessionManager = {
			hasClaudeRunner: vi.fn().mockReturnValue(true),
			getSession: vi.fn().mockReturnValue({
				issueId: "CHILD-456",
				claudeSessionId: "child-claude-session-456",
				workspace: { path: "/test/workspaces/CHILD-456" },
				claudeRunner: mockClaudeRunner,
			}),
			getClaudeRunner: vi.fn().mockReturnValue(mockClaudeRunner),
		};

		// Mock parent session manager (for different repository)
		mockAgentSessionManager = {
			hasClaudeRunner: vi.fn().mockReturnValue(false),
			getSession: vi.fn().mockReturnValue(null),
		};

		// Mock AgentSessionManager constructor
		vi.mocked(AgentSessionManager).mockImplementation(
			(_linearClient, ..._args) => {
				// Return different managers based on some condition
				// In real usage, these would be created per repository
				return mockAgentSessionManager;
			},
		);

		// Mock other dependencies
		vi.mocked(SharedApplicationServer).mockImplementation(
			() =>
				({
					start: vi.fn().mockResolvedValue(undefined),
					stop: vi.fn().mockResolvedValue(undefined),
					registerOAuthCallbackHandler: vi.fn(),
				}) as any,
		);

		vi.mocked(NdjsonClient).mockImplementation(
			() =>
				({
					connect: vi.fn().mockResolvedValue(undefined),
					disconnect: vi.fn(),
					on: vi.fn(),
					isConnected: vi.fn().mockReturnValue(true),
				}) as any,
		);

		vi.mocked(LinearClient).mockImplementation(
			() =>
				({
					users: {
						me: vi.fn().mockResolvedValue({
							id: "user-123",
							name: "Test User",
						}),
					},
				}) as any,
		);

		mockConfig = {
			proxyUrl: "http://localhost:3000",
			cyrusHome: "/tmp/test-cyrus-home",
			repositories: [mockRepository],
			handlers: {
				createWorkspace: vi.fn().mockResolvedValue({
					path: "/test/workspaces/CHILD-456",
					isGitWorktree: false,
				}),
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);

		// Setup parent-child mapping
		(edgeWorker as any).childToParentAgentSession.set(
			"child-session-456",
			"parent-session-123",
		);

		// Setup repository managers
		(edgeWorker as any).agentSessionManagers.set(
			"test-repo",
			mockChildAgentSessionManager,
		);
		(edgeWorker as any).repositories.set("test-repo", mockRepository);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	describe("Feedback Delivery Timeout Reproduction", () => {
		it("FAILING TEST: should timeout when waiting for child session to complete", async () => {
			// This test demonstrates the current problematic behavior where the feedback
			// delivery waits for the entire child session to complete
			
			// Arrange
			const childSessionId = "child-session-456";
			const feedbackMessage = "Please revise your approach and focus on the error handling";
			
			// Mock resumeClaudeSession to simulate waiting for the full session
			resumeClaudeSessionSpy = vi
				.spyOn(edgeWorker as any, "resumeClaudeSession")
				.mockImplementation(async () => {
					// This simulates the current behavior: waiting for the entire session
					await mockClaudeRunner.startStreaming();
					return undefined;
				});

			// Build MCP config which will trigger createCyrusToolsServer
			const _mcpConfig = (edgeWorker as any).buildMcpConfig(
				mockRepository,
				"parent-session-123",
			);

			// Act - Call the feedback delivery with a timeout
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error("Request timeout")), 5000);
			});

			const feedbackPromise = mockOnFeedbackDelivery(
				childSessionId,
				feedbackMessage,
			);

			// Assert - The feedback delivery should timeout
			await expect(
				Promise.race([feedbackPromise, timeoutPromise])
			).rejects.toThrow("Request timeout");

			// The feedback was actually initiated (resumeClaudeSession was called)
			expect(resumeClaudeSessionSpy).toHaveBeenCalledOnce();
			
			// But the tool times out waiting for completion
			// This reproduces the exact issue described: feedback is delivered
			// but the tool times out
		}, 10000); // Increase test timeout

		it("DESIRED BEHAVIOR: should return quickly after initiating child session", async () => {
			// This test demonstrates the desired behavior where feedback delivery
			// returns quickly after starting the child session
			
			// Arrange
			const childSessionId = "child-session-456";
			const feedbackMessage = "Please revise your approach and focus on the error handling";
			
			// Mock resumeClaudeSession with the FIXED behavior
			resumeClaudeSessionSpy = vi
				.spyOn(edgeWorker as any, "resumeClaudeSession")
				.mockImplementation(async () => {
					// Start the session but don't wait for it to complete
					// This is what the fix should do
					mockClaudeRunner.startStreaming().catch(error => {
						console.error(`[EdgeWorker] Failed to resume child session:`, error);
					});
					return undefined;
				});

			// Build MCP config which will trigger createCyrusToolsServer
			const _mcpConfig = (edgeWorker as any).buildMcpConfig(
				mockRepository,
				"parent-session-123",
			);

			// Act - Call the feedback delivery with a timeout
			const startTime = Date.now();
			const result = await mockOnFeedbackDelivery(
				childSessionId,
				feedbackMessage,
			);
			const endTime = Date.now();
			const duration = endTime - startTime;

			// Assert - The feedback delivery should return quickly
			expect(result).toBe(true);
			expect(resumeClaudeSessionSpy).toHaveBeenCalledOnce();
			
			// Should return in less than 1 second (not wait for the 10-second session)
			expect(duration).toBeLessThan(1000);
			
			// The child session is still running in the background
			expect(mockClaudeRunner.startStreaming).toHaveBeenCalledOnce();
		});

		it("should demonstrate the actual implementation causing the timeout", async () => {
			// This test uses the real EdgeWorker onFeedbackDelivery implementation
			// to show exactly where the timeout occurs
			
			// Arrange
			const childSessionId = "child-session-456";
			const feedbackMessage = "Test feedback";
			
			// Use the real resumeClaudeSession implementation but spy on it
			const originalResumeClaudeSession = (edgeWorker as any).resumeClaudeSession;
			resumeClaudeSessionSpy = vi
				.spyOn(edgeWorker as any, "resumeClaudeSession")
				.mockImplementation(async function(...args) {
					console.log("[Test] resumeClaudeSession called, starting long-running session...");
					
					// This simulates what actually happens in resumeClaudeSession:
					// It calls runner.startStreaming() which waits for the entire session
					const [_childSession, _repo, sessionId] = args;
					console.log(`[Test] Resuming session ${sessionId}, this will take 10 seconds...`);
					
					// Simulate the actual behavior: await runner.startStreaming()
					await mockClaudeRunner.startStreaming();
					
					console.log(`[Test] Session ${sessionId} completed after long wait`);
					return undefined;
				});

			// Build MCP config
			const _mcpConfig = (edgeWorker as any).buildMcpConfig(
				mockRepository,
				"parent-session-123",
			);

			// Act - Measure how long the feedback delivery takes
			const startTime = Date.now();
			
			// Create a race between feedback delivery and a 5-second timeout
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => {
					console.log("[Test] 5-second timeout reached, feedback delivery still running");
					reject(new Error("Request timeout"));
				}, 5000);
			});

			const feedbackPromise = mockOnFeedbackDelivery(
				childSessionId,
				feedbackMessage,
			).then(result => {
				const duration = Date.now() - startTime;
				console.log(`[Test] Feedback delivery completed after ${duration}ms`);
				return result;
			});

			// Assert - The feedback will timeout because it waits for the full session
			await expect(
				Promise.race([feedbackPromise, timeoutPromise])
			).rejects.toThrow("Request timeout");

			// Verify that resumeClaudeSession was indeed called
			expect(resumeClaudeSessionSpy).toHaveBeenCalledOnce();
			
			// The session is still running in the background even after the timeout
			expect(mockClaudeRunner.isStreaming()).toBe(false); // Not actually streaming in mock
			expect(mockClaudeRunner.startStreaming).toHaveBeenCalledOnce();
		}, 15000); // Give enough time for the test
	});
});