import { EdgeWorker } from './EdgeWorker.mjs'

/**
 * Edge application that connects to proxy and processes events
 */
export class EdgeApp {
  constructor(container) {
    this.container = container
    this.edgeWorker = null
    this.isShuttingDown = false
  }
  
  /**
   * Initialize the application
   */
  async init() {
    // Validate configuration
    this.container.get('config').validate()
    
    // Set up workspace base directory
    const workspaceService = this.container.get('workspaceService')
    await workspaceService.setupBaseDir()
  }
  
  /**
   * Start the edge application
   */
  async start() {
    try {
      // Initialize the application
      await this.init()
      
      // Get configuration
      const config = this.container.get('config')
      
      // Verify edge configuration
      if (!config.edge?.proxyUrl || !config.edge?.edgeToken) {
        throw new Error('Edge configuration missing. Please run "cyrus setup" first.')
      }
      
      // Create and start edge worker
      const issueService = this.container.get('issueService')
      this.edgeWorker = new EdgeWorker({
        proxyUrl: config.edge.proxyUrl,
        edgeToken: config.edge.edgeToken
      }, issueService)
      
      await this.edgeWorker.start()
      
      console.log('✅ Edge worker started successfully')
      console.log(`Connected to proxy: ${config.edge.proxyUrl}`)
      
    } catch (error) {
      console.error('Failed to start edge application:', error)
      await this.shutdown()
      throw error
    }
  }
  
  /**
   * Shut down the application
   */
  async shutdown() {
    if (this.isShuttingDown) return
    this.isShuttingDown = true
    
    console.log('\nShutting down edge worker...')
    
    // Stop edge worker
    if (this.edgeWorker) {
      await this.edgeWorker.stop()
    }
    
    console.log('Shutdown complete')
  }
}