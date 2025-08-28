import * as fs from "fs-extra";
import { basename, extname } from "node:path";
import { LinearClient } from "@linear/sdk";
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-code";
import { z } from "zod";
import { LinearService } from "./linear-service.js";

/**
 * Detect MIME type based on file extension
 */
function getMimeType(filename: string): string {
	const ext = extname(filename).toLowerCase();
	const mimeTypes: Record<string, string> = {
		// Images
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".svg": "image/svg+xml",
		".webp": "image/webp",
		".bmp": "image/bmp",
		".ico": "image/x-icon",

		// Documents
		".pdf": "application/pdf",
		".doc": "application/msword",
		".docx":
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".xls": "application/vnd.ms-excel",
		".xlsx":
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".ppt": "application/vnd.ms-powerpoint",
		".pptx":
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",

		// Text
		".txt": "text/plain",
		".md": "text/markdown",
		".csv": "text/csv",
		".json": "application/json",
		".xml": "application/xml",
		".html": "text/html",
		".css": "text/css",
		".js": "application/javascript",
		".ts": "application/typescript",

		// Archives
		".zip": "application/zip",
		".tar": "application/x-tar",
		".gz": "application/gzip",
		".rar": "application/vnd.rar",
		".7z": "application/x-7z-compressed",

		// Media
		".mp3": "audio/mpeg",
		".wav": "audio/wav",
		".mp4": "video/mp4",
		".mov": "video/quicktime",
		".avi": "video/x-msvideo",
		".webm": "video/webm",

		// Other
		".log": "text/plain",
		".yml": "text/yaml",
		".yaml": "text/yaml",
	};

	return mimeTypes[ext] || "application/octet-stream";
}




/**
 * Create an SDK MCP server with the inline Cyrus tools
 */
export function createCyrusToolsServer(linearApiToken: string) {
	const linearClient = new LinearClient({ apiKey: linearApiToken });
	const linearService = new LinearService(linearClient);

	// Create tools with bound linear service
	const uploadTool = tool(
		"linear_upload_file",
		"Upload a file to Linear. Returns an asset URL that can be used in issue descriptions or comments.",
		{
			filePath: z.string().describe("The absolute path to the file to upload"),
			filename: z
				.string()
				.optional()
				.describe(
					"The filename to use in Linear (optional, defaults to basename of filePath)",
				),
			contentType: z
				.string()
				.optional()
				.describe(
					"MIME type of the file (optional, auto-detected if not provided)",
				),
			makePublic: z
				.boolean()
				.optional()
				.describe(
					"Whether to make the file publicly accessible (default: false)",
				),
		},
		async ({ filePath, filename, contentType, makePublic }) => {
			try {
				// Read file and get stats
				const stats = await fs.stat(filePath);
				if (!stats.isFile()) {
					throw new Error(`Path ${filePath} is not a file`);
				}

				const fileBuffer = await fs.readFile(filePath);
				const finalFilename = filename || basename(filePath);
				const finalContentType = contentType || getMimeType(finalFilename);
				const size = stats.size;

				// Step 1: Request upload URL from Linear
				console.log(
					`Requesting upload URL for ${finalFilename} (${size} bytes, ${finalContentType})`,
				);
				const uploadPayload = await linearService.fileUpload(
					finalContentType,
					finalFilename,
					size,
					makePublic,
				);

				if (!uploadPayload.success || !uploadPayload.uploadFile) {
					throw new Error("Failed to get upload URL from Linear");
				}

				const { uploadUrl, headers, assetUrl } = uploadPayload.uploadFile;

				// Step 2: Upload the file to the provided URL
				console.log(`Uploading file to Linear cloud storage...`);

				// Create headers following Linear's documentation exactly
				const uploadHeaders: Record<string, string> = {
					"Content-Type": finalContentType,
					"Cache-Control": "public, max-age=31536000",
				};

				// Then add the headers from Linear's response
				// These override any defaults we set above
				for (const header of headers) {
					uploadHeaders[header.key] = header.value;
				}

				console.log(`Headers being sent:`, uploadHeaders);

				const uploadResponse = await fetch(uploadUrl, {
					method: "PUT",
					headers: uploadHeaders,
					body: fileBuffer,
				});

				if (!uploadResponse.ok) {
					const errorText = await uploadResponse.text();
					throw new Error(
						`Failed to upload file: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`,
					);
				}

				console.log(`File uploaded successfully: ${assetUrl}`);

				// Return the asset URL and metadata
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								assetUrl,
								filename: finalFilename,
								size,
								contentType: finalContentType,
							}),
						},
					],
				};
			} catch (error) {
				if (error instanceof Error) {
					throw new Error(`Failed to upload file: ${error.message}`);
				}
				throw error;
			}
		},
	);

	const agentSessionTool = tool(
		"linear_agent_session_create",
		"Create an agent session on a Linear issue to track AI/bot activity.",
		{
			issueId: z
				.string()
				.describe(
					'The ID or identifier of the Linear issue (e.g., "ABC-123" or UUID)',
				),
			externalLink: z
				.string()
				.optional()
				.describe(
					"Optional URL of an external agent-hosted page associated with this session",
				),
		},
		async ({ issueId, externalLink }) => {
			try {
				// Use raw GraphQL through the Linear client
				// Access the underlying GraphQL client
				const graphQLClient = (linearService as any).client.client;

				const mutation = `
					mutation AgentSessionCreateOnIssue($input: AgentSessionCreateOnIssue!) {
						agentSessionCreateOnIssue(input: $input) {
							success
							lastSyncId
							agentSession {
								id
							}
						}
					}
				`;

				const variables = {
					input: {
						issueId,
						...(externalLink && { externalLink }),
					},
				};

				console.log(`Creating agent session for issue ${issueId}`);

				const response = await graphQLClient.rawRequest(mutation, variables);

				const result = response.data.agentSessionCreateOnIssue;

				if (!result.success) {
					throw new Error("Failed to create agent session");
				}

				console.log(
					`Agent session created successfully: ${result.agentSession.id}`,
				);

				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: result.success,
								agentSessionId: result.agentSession.id,
								lastSyncId: result.lastSyncId,
							}),
						},
					],
				};
			} catch (error) {
				if (error instanceof Error) {
					throw new Error(`Failed to create agent session: ${error.message}`);
				}
				throw error;
			}
		},
	);

	const giveFeedbackTool = tool(
		"linear_agent_give_feedback",
		"Provide feedback to a child agent session to continue its processing.",
		{
			agentSessionId: z
				.string()
				.describe("The ID of the child agent session to provide feedback to"),
			message: z
				.string()
				.describe("The feedback message to send to the child agent session"),
		},
		async ({ agentSessionId, message }) => {
			// Simple validation - the actual work happens in the PostToolUse hook
			if (!agentSessionId) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: "agentSessionId is required",
							}),
						},
					],
				};
			}

			if (!message) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								success: false,
								error: "message is required",
							}),
						},
					],
				};
			}

			// Return success - the PostToolUse hook will handle the actual feedback
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify({ success: true }),
					},
				],
			};
		},
	);

	return createSdkMcpServer({
		name: "cyrus-tools",
		version: "1.0.0",
		tools: [uploadTool, agentSessionTool, giveFeedbackTool],
	});
}

/**
 * Export individual tools for direct use if needed
 */