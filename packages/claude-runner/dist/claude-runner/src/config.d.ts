/**
 * Claude CLI configuration helpers
 */
/**
 * List of all available tools in Claude Code
 */
export declare const availableTools: readonly ["Read", "Write", "Edit", "MultiEdit", "Glob", "Grep", "LS", "Bash", "Task", "WebFetch", "TodoRead", "TodoWrite", "NotebookRead", "NotebookEdit", "Batch"];
export type ToolName = typeof availableTools[number];
/**
 * Default read-only tools that are safe to enable
 */
export declare const readOnlyTools: ToolName[];
/**
 * Tools that can modify the file system
 */
export declare const writeTools: ToolName[];
/**
 * Get a safe set of tools for read-only operations
 */
export declare function getReadOnlyTools(): string[];
/**
 * Get all available tools
 */
export declare function getAllTools(): string[];
//# sourceMappingURL=config.d.ts.map