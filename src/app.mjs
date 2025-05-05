import 'dotenv/config';
import { createContainer } from './container.mjs';

/**
 * Application class that orchestrates the components
 */
export class App {
  constructor() {
    this.container = createContainer();
    this.webhookServer = null;
    this.isShuttingDown = false;
  }
  
  /**
   * Initialize the application
   */
  async init() {
    // Validate configuration
    this.container.get('config').validate();
    
    // Set up workspace base directory
    const workspaceService = this.container.get('workspaceService');
    await workspaceService.setupBaseDir();
  }
  
  /**
   * Start the application
   */
  async start() {
    try {
      // Initialize the application
      await this.init();
      
      // Get configuration
      const config = this.container.get('config');
      
      // Start webhook server
      const webhookService = this.container.get('webhookService');
      this.webhookServer = await webhookService.startServer(config.webhook.port);
      
      // Start Linear agent
      const issueService = this.container.get('issueService');
      await issueService.fetchAssignedIssues().then(issues => {
        issues.forEach(issue => {
          issueService.initializeIssueSession(issue).catch(err => {
            console.error(`Failed to initialize session for issue ${issue.identifier}:`, err);
          });
        });
      });
      
      console.log(`✅ Linear agent and webhook server started successfully.`);
      console.log(`Webhook server listening on port ${config.webhook.port}`);
    } catch (error) {
      console.error('Failed to start application:', error);
      await this.shutdown();
      throw error;
    }
  }
  
  /**
   * Shut down the application
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    console.log('\nShutting down...');
    
    // Clean up worktrees
    // Uncomment when ready to implement
    // console.log('Cleaning up worktrees...');
    // const workspaceService = this.container.get('workspaceService');
    // await workspaceService.cleanupAllWorkspaces();
    
    // Close webhook server
    if (this.webhookServer) {
      console.log('Closing webhook server...');
      this.webhookServer.close();
    }
    
    console.log('Shutdown complete');
  }
}