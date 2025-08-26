import type { MCPToolDefinition } from "../../types.js";
import { uploadFileToolDefinition } from "./upload-tool.js";
import { createAgentSessionToolDefinition } from "./agent-session-tool.js";

// All tool definitions
export const allToolDefinitions: MCPToolDefinition[] = [
	uploadFileToolDefinition,
	createAgentSessionToolDefinition,
];

// Export all tool definitions individually
export { uploadFileToolDefinition, createAgentSessionToolDefinition };
