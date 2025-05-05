/**
 * Interface for Claude AI operations
 */
export class ClaudeService {
  /**
   * Start a new Claude session for an issue
   * @param {Issue} issue - The issue to process
   * @param {Workspace} workspace - The workspace for the issue
   * @returns {Promise<Session>} - The created session
   */
  async startSession(issue, workspace) {
    throw new Error('Not implemented');
  }
  
  /**
   * Send a comment to an existing Claude session
   * @param {Session} session - The existing session
   * @param {string} commentText - The comment text to send
   * @returns {Promise<Session>} - The updated session
   */
  async sendComment(session, commentText) {
    throw new Error('Not implemented');
  }
  
  /**
   * Post a response from Claude to Linear
   * @param {string} issueId - The issue ID
   * @param {string} response - The response text
   * @param {number|null} costUsd - Optional cost information
   * @param {number|null} durationMs - Optional duration information
   * @returns {Promise<boolean>} - Success status
   */
  async postResponseToLinear(issueId, response, costUsd = null, durationMs = null) {
    throw new Error('Not implemented');
  }
  
  /**
   * Build an initial prompt for Claude using the loaded template
   * @param {Issue} issue - The issue to build the prompt for
   * @returns {string} - The formatted prompt
   */
  buildInitialPrompt(issue) {
    throw new Error('Not implemented');
  }
}