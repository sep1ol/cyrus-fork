import type {
	Attachment,
	AttachmentConnection,
	LinearIssue,
} from "@linear/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EdgeWorker } from "../src/EdgeWorker";
import type { EdgeWorkerConfig } from "../src/types";

describe("EdgeWorker - Native Attachments", () => {
	let edgeWorker: EdgeWorker;
	let mockConfig: EdgeWorkerConfig;

	beforeEach(() => {
		mockConfig = {
			id: "test-worker",
			sessionDirectory: "/tmp/test-sessions",
			repositories: [
				{
					id: "test-repo",
					name: "test-repo",
					repositoryPath: "/test/repo",
					linearToken: "test-token",
					baseBranch: "main",
				},
			],
			features: {
				enableAttachmentDownload: true,
			},
		};

		edgeWorker = new EdgeWorker(mockConfig);
	});

	describe("downloadIssueAttachments", () => {
		it("should fetch native Linear attachments alongside extracted URLs", async () => {
			// Mock Linear issue with attachments method
			const mockAttachments: Attachment[] = [
				{
					id: "attach1",
					title: "Error: Rendered more hooks than during the previous render.",
					url: "https://sentry.io/organizations/ceedar/issues/6785301401/",
				} as Attachment,
				{
					id: "attach2",
					title: "Performance Report",
					url: "https://datadog.com/reports/123",
				} as Attachment,
			];

			const mockIssue = {
				id: "issue-123",
				identifier: "PACK-203",
				title: "Test Issue",
				description:
					"Issue with attachment URL https://uploads.linear.app/test.png",
				attachments: vi.fn().mockResolvedValue({
					nodes: mockAttachments,
				} as AttachmentConnection),
			} as unknown as LinearIssue;

			// Mock LinearClient
			const mockLinearClient = {
				comments: vi.fn().mockResolvedValue({ nodes: [] }),
			};
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			// Call the method
			const result = await (edgeWorker as any).downloadIssueAttachments(
				mockIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			// Verify attachments were fetched
			expect(mockIssue.attachments).toHaveBeenCalled();

			// Verify manifest includes native attachments
			expect(result.manifest).toContain("### Linear Issue Links");
			expect(result.manifest).toContain(
				"Error: Rendered more hooks than during the previous render.",
			);
			expect(result.manifest).toContain(
				"https://sentry.io/organizations/ceedar/issues/6785301401/",
			);
			expect(result.manifest).toContain("Performance Report");
			expect(result.manifest).toContain("https://datadog.com/reports/123");
		});

		it("should handle when no native attachments are present", async () => {
			const mockIssue = {
				id: "issue-456",
				identifier: "PACK-204",
				title: "Test Issue Without Attachments",
				description: "No attachments here",
				attachments: vi.fn().mockResolvedValue({
					nodes: [],
				} as AttachmentConnection),
			} as unknown as LinearIssue;

			const mockLinearClient = {
				comments: vi.fn().mockResolvedValue({ nodes: [] }),
			};
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			const result = await (edgeWorker as any).downloadIssueAttachments(
				mockIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			expect(mockIssue.attachments).toHaveBeenCalled();
			expect(result.manifest).not.toContain("### Linear Issue Links");
			expect(result.manifest).toContain(
				"No attachments were found in this issue.",
			);
		});

		it("should handle errors when fetching native attachments", async () => {
			const mockIssue = {
				id: "issue-789",
				identifier: "PACK-205",
				title: "Test Issue with Error",
				description: "Testing error handling",
				attachments: vi.fn().mockRejectedValue(new Error("API Error")),
			} as unknown as LinearIssue;

			const mockLinearClient = {
				comments: vi.fn().mockResolvedValue({ nodes: [] }),
			};
			(edgeWorker as any).linearClients.set("test-repo", mockLinearClient);

			// Should not throw, but handle gracefully
			const result = await (edgeWorker as any).downloadIssueAttachments(
				mockIssue,
				mockConfig.repositories[0],
				"/tmp/workspace",
			);

			expect(mockIssue.attachments).toHaveBeenCalled();
			expect(result.manifest).toContain(
				"No attachments were found in this issue.",
			);
		});
	});

	describe("generateAttachmentManifest", () => {
		it("should include native attachments section when provided", () => {
			const downloadResult = {
				attachmentMap: {},
				imageMap: {},
				totalFound: 0,
				downloaded: 0,
				imagesDownloaded: 0,
				skipped: 0,
				failed: 0,
				nativeAttachments: [
					{ title: "Sentry Error", url: "https://sentry.io/error/123" },
					{
						title: "GitHub Issue",
						url: "https://github.com/org/repo/issues/456",
					},
				],
			};

			const manifest = (edgeWorker as any).generateAttachmentManifest(
				downloadResult,
			);

			expect(manifest).toContain("### Linear Issue Links");
			expect(manifest).toContain("1. Sentry Error");
			expect(manifest).toContain("   URL: https://sentry.io/error/123");
			expect(manifest).toContain("2. GitHub Issue");
			expect(manifest).toContain(
				"   URL: https://github.com/org/repo/issues/456",
			);
		});

		it("should handle mixed native and downloaded attachments", () => {
			const downloadResult = {
				attachmentMap: {
					"https://uploads.linear.app/doc.pdf":
						"/tmp/attachments/attachment_1.pdf",
				},
				imageMap: {
					"https://uploads.linear.app/screenshot.png":
						"/tmp/attachments/image_1.png",
				},
				totalFound: 2,
				downloaded: 2,
				imagesDownloaded: 1,
				skipped: 0,
				failed: 0,
				nativeAttachments: [
					{ title: "Related Sentry Issue", url: "https://sentry.io/issue/789" },
				],
			};

			const manifest = (edgeWorker as any).generateAttachmentManifest(
				downloadResult,
			);

			// Should include all sections
			expect(manifest).toContain("### Linear Issue Links");
			expect(manifest).toContain("Related Sentry Issue");
			expect(manifest).toContain("### Images");
			expect(manifest).toContain("image_1.png");
			expect(manifest).toContain("### Other Attachments");
			expect(manifest).toContain("attachment_1.pdf");
		});
	});
});
