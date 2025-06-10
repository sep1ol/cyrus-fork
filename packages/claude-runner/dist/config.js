/**
 * Claude CLI configuration helpers
 */
/**
 * List of all available tools in Claude Code
 */
export const availableTools = [
    // File system tools
    'Read', 'Write', 'Edit', 'MultiEdit',
    'Glob', 'Grep', 'LS',
    // Execution tools
    'Bash', 'Task',
    // Web tools
    'WebFetch',
    // Task management
    'TodoRead', 'TodoWrite',
    // Notebook tools
    'NotebookRead', 'NotebookEdit',
    // Utility tools
    'Batch'
];
/**
 * Default read-only tools that are safe to enable
 */
export const readOnlyTools = [
    'Read', 'Glob', 'Grep', 'LS', 'WebFetch',
    'TodoRead', 'NotebookRead', 'Task', 'Batch'
];
/**
 * Tools that can modify the file system
 */
export const writeTools = [
    'Write', 'Edit', 'MultiEdit', 'Bash',
    'TodoWrite', 'NotebookEdit'
];
/**
 * Get a safe set of tools for read-only operations
 */
export function getReadOnlyTools() {
    return [...readOnlyTools];
}
/**
 * Get all available tools
 */
export function getAllTools() {
    return [...availableTools];
}
//# sourceMappingURL=config.js.map