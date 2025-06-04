import { LinearClient } from '@linear/sdk'
import { SessionManager } from '../services/SessionManager.mjs'
import { LinearIssueService } from '../adapters/LinearIssueService.mjs'
import { NodeClaudeService } from '../adapters/NodeClaudeService.mjs'
import { FSWorkspaceService } from '../adapters/FSWorkspaceService.mjs'
import { ProcessManager } from '../utils/ProcessManager.mjs'
import { FileSystem } from '../utils/FileSystem.mjs'

/**
 * Create a dependency injection container for edge mode
 * @returns {Map} Container with registered services
 */
export function createEdgeContainer() {
  const container = new Map()
  
  // Register configuration
  container.set('config', {
    edge: {
      proxyUrl: process.env.PROXY_URL || 'http://localhost:3000',
      edgeToken: process.env.EDGE_TOKEN,
      linearToken: process.env.LINEAR_OAUTH_TOKEN
    },
    workspace: {
      baseDir: process.env.WORKSPACE_BASE_DIR || './workspaces'
    },
    claude: {
      path: process.env.CLAUDE_PATH || 'claude',
      promptTemplatePath: process.env.PROMPT_TEMPLATE_PATH || './agent-prompt-template.md'
    },
    validate() {
      if (!this.edge.edgeToken) {
        throw new Error('EDGE_TOKEN environment variable is required')
      }
    }
  })
  
  // Register utilities
  container.set('fileSystem', new FileSystem())
  container.set('processManager', new ProcessManager())
  
  // Register workspace service
  container.set('workspaceService', new FSWorkspaceService(
    container.get('config').workspace.baseDir,
    container.get('fileSystem')
  ))
  
  // Register Claude service
  container.set('claudeService', new NodeClaudeService(
    container.get('config').claude.path,
    container.get('processManager')
  ))
  
  // Create Linear client that will use OAuth token from proxy
  // The edge worker will get the token as part of its configuration
  const edgeToken = container.get('config').edge.edgeToken
  
  // Extract OAuth token from edge token (assuming it's embedded in JWT)
  // For now, we'll need to pass the Linear OAuth token separately
  const linearClient = new LinearClient({
    accessToken: process.env.LINEAR_OAUTH_TOKEN || container.get('config').edge.linearToken
  })
  
  // Register issue service
  container.set('issueService', new LinearIssueService(
    linearClient,
    new SessionManager(
      container.get('workspaceService'),
      container.get('claudeService'),
      container.get('fileSystem')
    ),
    container.get('config').claude.promptTemplatePath
  ))
  
  return container
}