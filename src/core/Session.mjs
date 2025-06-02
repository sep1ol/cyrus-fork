/**
 * Represents a Claude session for an issue
 */
export class Session {
  constructor({
    issue,
    workspace,
    process = null,
    startedAt = new Date(),
    exitCode = null,
    exitedAt = null,
    stderrContent = '',
    lastAssistantResponse = '',
    lastCommentId = null,
    conversationContext = null,
    agentRootCommentId = null,
    currentParentId = null,
    streamingCommentId = null,
    streamingSynthesis = null,
    streamingNarrative = [],
  }) {
    this.issue = issue;
    this.workspace = workspace;
    this.process = process;
    this.startedAt = startedAt instanceof Date ? startedAt : new Date(startedAt);
    this.exitCode = exitCode;
    this.exitedAt = exitedAt instanceof Date ? exitedAt : exitedAt ? new Date(exitedAt) : null;
    this.stderrContent = stderrContent;
    this.lastAssistantResponse = lastAssistantResponse;
    this.lastCommentId = lastCommentId;
    this.conversationContext = conversationContext;
    this.agentRootCommentId = agentRootCommentId; // First comment by agent on assignment
    this.currentParentId = currentParentId; // Current parent ID for threading
    this.streamingCommentId = streamingCommentId; // ID of "Getting to work..." comment for updates
    this.streamingSynthesis = streamingSynthesis; // Current synthesized progress message
    this.streamingNarrative = streamingNarrative; // Chronological list of text snippets and tool calls
  }

  /**
   * Check if this session is currently active
   */
  isActive() {
    return this.process !== null && !this.process.killed && this.exitCode === null;
  }

  /**
   * Check if this session has exited successfully
   */
  hasExitedSuccessfully() {
    return this.exitCode === 0;
  }

  /**
   * Check if this session has exited with an error
   */
  hasExitedWithError() {
    return this.exitCode !== null && this.exitCode !== 0;
  }

  /**
   * Format an error message for posting to Linear
   */
  formatErrorMessage() {
    let errorMessage = `Claude process for issue ${this.issue.identifier} exited unexpectedly with code ${this.exitCode}.`;
    
    if (this.stderrContent) {
      errorMessage += `\n\n**Error details (stderr):**\n\`\`\`\n${
        this.stderrContent.substring(0, 1500)
      } ${this.stderrContent.length > 1500 ? '... (truncated)' : ''}\n\`\`\``;
    }
    
    return errorMessage;
  }

  /**
   * Add a tool call to the narrative
   * @param {string} toolName - Name of the tool called
   */
  addToolCall(toolName) {
    this.streamingNarrative.push({
      type: 'tool_call',
      tool: toolName,
      timestamp: Date.now()
    });
    this.updateStreamingSynthesis();
  }

  /**
   * Add a text snippet to the narrative
   * @param {string} text - Text content from assistant message
   */
  addTextSnippet(text) {
    // Extract meaningful statements that show intent/progress
    const meaningfulStatements = this.extractMeaningfulStatements(text);
    
    for (const statement of meaningfulStatements) {
      this.streamingNarrative.push({
        type: 'text',
        content: statement,
        timestamp: Date.now()
      });
    }
    
    if (meaningfulStatements.length > 0) {
      this.updateStreamingSynthesis();
    }
  }

  /**
   * Extract meaningful statements from assistant text
   * @param {string} text - Raw text content
   * @returns {string[]} - Array of meaningful statements
   */
  extractMeaningfulStatements(text) {
    if (!text || typeof text !== 'string') return [];
    
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const meaningful = [];
    
    for (const line of lines) {
      // Skip code blocks, headers, and short lines
      if (line.startsWith('```') || line.match(/^#+\s/) || line.length < 15) {
        continue;
      }
      
      // Look for statements that show intent, action, or progress
      if (
        line.match(/^(I will|I'll|I need|I'm going to|Let me|Now I|First I|Next|Then)/i) ||
        line.match(/^(Looking|Checking|Searching|Creating|Building|Setting up|Implementing)/i) ||
        line.match(/^(Based on|After|Once|To)/i)
      ) {
        // Truncate very long statements
        const truncated = line.length > 120 ? line.substring(0, 117) + '...' : line;
        meaningful.push(truncated);
        
        // Only take the first 2 meaningful statements per update to avoid spam
        if (meaningful.length >= 2) break;
      }
    }
    
    return meaningful;
  }

  /**
   * Update the streaming synthesis based on chronological narrative
   */
  updateStreamingSynthesis() {
    const narrative = ['Getting to work...'];
    
    // Group consecutive items and process chronologically
    let i = 0;
    while (i < this.streamingNarrative.length) {
      const item = this.streamingNarrative[i];
      
      if (item.type === 'text') {
        narrative.push(item.content);
        i++;
      } else if (item.type === 'tool_call') {
        // Collect all consecutive tool calls
        const consecutiveTools = [];
        let j = i;
        
        while (j < this.streamingNarrative.length && this.streamingNarrative[j].type === 'tool_call') {
          const toolName = this.streamingNarrative[j].tool;
          if (!consecutiveTools.includes(toolName)) {
            consecutiveTools.push(toolName);
          }
          j++;
        }
        
        // Add grouped tool call summary
        const toolCount = consecutiveTools.length;
        const toolList = consecutiveTools.join(', ');
        narrative.push(`${toolCount} tool call${toolCount > 1 ? 's' : ''}: ${toolList}`);
        
        // Move index to the next non-tool-call item
        i = j;
      } else {
        i++;
      }
    }
    
    // Keep only the last 8 items to prevent the comment from getting too long
    const recentNarrative = narrative.slice(-8);
    this.streamingSynthesis = recentNarrative.join('\n\n');
  }

  /**
   * Reset streaming state for a new run
   */
  resetStreamingState() {
    this.streamingNarrative = [];
    this.streamingSynthesis = 'Getting to work...';
  }
}