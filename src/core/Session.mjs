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
    toolCallsSeen = [],
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
    this.toolCallsSeen = toolCallsSeen; // Array of tool calls seen in current run
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
   * Add a tool call to the tracking list
   * @param {string} toolName - Name of the tool called
   */
  addToolCall(toolName) {
    if (!this.toolCallsSeen.includes(toolName)) {
      this.toolCallsSeen.push(toolName);
    }
  }

  /**
   * Update the streaming synthesis based on current progress
   * @param {string} currentMessage - Current assistant message content
   */
  updateStreamingSynthesis(currentMessage) {
    const synthesis = ['Getting to work...'];
    
    if (this.toolCallsSeen.length > 0) {
      const toolCount = this.toolCallsSeen.length;
      const toolList = this.toolCallsSeen.join(', ');
      synthesis.push(`${toolCount} tool call${toolCount > 1 ? 's' : ''}: ${toolList}`);
    }
    
    // Extract meaningful parts from the current message for synthesis
    if (currentMessage) {
      const lines = currentMessage.split('\n').filter(line => line.trim());
      const meaningfulLines = lines.filter(line => {
        const trimmed = line.trim();
        return trimmed.length > 10 && 
               !trimmed.startsWith('```') && 
               !trimmed.match(/^#+\s/) && // Skip headers
               trimmed.indexOf('I will') === 0 ||
               trimmed.indexOf('I need') === 0 ||
               trimmed.indexOf('Now I') === 0 ||
               trimmed.indexOf('Let me') === 0;
      });
      
      if (meaningfulLines.length > 0) {
        synthesis.push(`Current focus: ${meaningfulLines[0].substring(0, 100)}${meaningfulLines[0].length > 100 ? '...' : ''}`);
      }
    }
    
    this.streamingSynthesis = synthesis.join('\n\n');
  }

  /**
   * Reset streaming state for a new run
   */
  resetStreamingState() {
    this.toolCallsSeen = [];
    this.streamingSynthesis = 'Getting to work...';
  }
}