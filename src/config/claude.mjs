/**
 * Claude configuration
 */
export default {
  /**
   * List of all available tools in Claude Code
   * 
   * These can be individually allowed or denied through configuration
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
    // Convert array to flat CLI arguments format
    const toolArgs = [];
    if (allowedTools && allowedTools.length > 0) {
      toolArgs.push('--allowedTools');
      toolArgs.push(...allowedTools);
    }
    return toolArgs;
  },
  
  /**
   * Default arguments for Claude CLI
   */
  getDefaultArgs(allowedTools = []) {
    return [
      '--print',
      '--output-format',
      'stream-json',
      ...this.getToolsArgs(allowedTools)
    ];
  },
  
  /**
   * Extended arguments for continuation mode
   */
  getContinueArgs(allowedTools = []) {
    return [
      ...this.getDefaultArgs(allowedTools),
      '--continue'
    ];
  }
};