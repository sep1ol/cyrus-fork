import fs from "node:fs/promises";
import path from "node:path";
import type { LinearService } from "../../services/linear-service.js";
import { isUploadFileArgs } from "../type-guards.js";

/**
 * Detect MIME type based on file extension
 */
function getMimeType(filename: string): string {
	const ext = path.extname(filename).toLowerCase();
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
 * Handler for uploading files to Linear
 */
export function handleUploadFile(linearService: LinearService) {
	return async (args: unknown) => {
		if (!isUploadFileArgs(args)) {
			throw new Error("Invalid arguments for upload_file");
		}

		try {
			// Read file and get stats
			const stats = await fs.stat(args.filePath);
			if (!stats.isFile()) {
				throw new Error(`Path ${args.filePath} is not a file`);
			}

			const fileBuffer = await fs.readFile(args.filePath);
			const filename = args.filename || path.basename(args.filePath);
			const contentType = args.contentType || getMimeType(filename);
			const size = stats.size;

			// Step 1: Request upload URL from Linear
			console.log(
				`Requesting upload URL for ${filename} (${size} bytes, ${contentType})`,
			);
			const uploadPayload = await linearService.fileUpload(
				contentType,
				filename,
				size,
				args.makePublic,
			);

			if (!uploadPayload.success || !uploadPayload.uploadFile) {
				throw new Error("Failed to get upload URL from Linear");
			}

			const { uploadUrl, headers, assetUrl } = uploadPayload.uploadFile;

			// Step 2: Upload the file to the provided URL
			console.log(`Uploading file to Linear cloud storage...`);
			console.log(`Headers from Linear:`, headers);

			// Convert headers array to object, being careful with header names
			const uploadHeaders: Record<string, string> = {};
			
			// Only include headers that Linear explicitly provided
			for (const header of headers) {
				// Use the exact key provided by Linear
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
				assetUrl,
				filename,
				size,
				contentType,
			};
		} catch (error) {
			if (error instanceof Error) {
				throw new Error(`Failed to upload file: ${error.message}`);
			}
			throw error;
		}
	};
}
