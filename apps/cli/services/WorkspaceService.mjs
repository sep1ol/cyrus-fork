/**
 * Interface for workspace-related operations
 */
export class WorkspaceService {
  /**
   * Set up the base workspace directory
   * @returns {Promise<string>} - Path to base directory
   */
  async setupBaseDir() {
    throw new Error('Not implemented');
  }
  
  /**
   * Get the workspace for an issue
   * @param {Issue} issue - The issue
   * @returns {Promise<Workspace|null>} - The workspace if it exists, or null
   */
  async getWorkspaceForIssue(issue) {
    throw new Error('Not implemented');
  }
  
  /**
   * Create a new workspace for an issue
   * @param {Issue} issue - The issue
   * @returns {Promise<Workspace>} - The created workspace
   */
  async createWorkspace(issue) {
    throw new Error('Not implemented');
  }
  
  /**
   * Clean up a specific workspace
   * @param {Workspace} workspace - The workspace to clean up
   * @returns {Promise<void>}
   */
  async cleanupWorkspace(workspace) {
    throw new Error('Not implemented');
  }
  
  /**
   * Clean up all workspaces
   * @returns {Promise<void>}
   */
  async cleanupAllWorkspaces() {
    throw new Error('Not implemented');
  }
}