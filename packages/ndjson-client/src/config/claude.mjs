/**
 * Simplified Claude configuration for edge-client
 * This provides the minimal configuration needed for ClaudeSpawner
 */
export const claudeConfig = {
  /**
   * List of all available tools in Claude Code
   */
  availableTools: [
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
  ],
  
  /**
   * Default read-only tools that are safe to enable
   */
  readOnlyTools: [
    'Read', 'Glob', 'Grep', 'LS', 'WebFetch', 
    'TodoRead', 'NotebookRead', 'Task', 'Batch'
  ],
  
  /**
   * Get the appropriate CLI arguments based on allowed tools
   */
  getToolsArgs(allowedTools) {
    const toolArgs = []
    if (allowedTools && allowedTools.length > 0) {
      toolArgs.push('--allowedTools')
      toolArgs.push(...allowedTools)
    }
    return toolArgs
  },
  
  /**
   * Default arguments for Claude CLI
   */
  getDefaultArgs(allowedTools = [], workspacePath = null) {
    return [
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      ...this.getToolsArgs(allowedTools)
    ]
  },
  
  /**
   * Extended arguments for continuation mode
   */
  getContinueArgs(allowedTools = [], workspacePath = null) {
    return [
      ...this.getDefaultArgs(allowedTools, workspacePath),
      '--continue'
    ]
  }
}
