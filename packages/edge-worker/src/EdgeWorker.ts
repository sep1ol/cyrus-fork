import { EventEmitter } from 'events'
import { LinearClient } from '@linear/sdk'
import { NdjsonClient } from '@cyrus/ndjson-client'
import { ClaudeRunner, getAllTools } from '@cyrus/claude-runner'
import { SessionManager, Session } from '@cyrus/core'
import type { EdgeWorkerConfig, EdgeWorkerEvents, RepositoryConfig } from './types.js'
import type { WebhookEvent, StatusUpdate } from '@cyrus/ndjson-client'
import type { ClaudeEvent } from '@cyrus/claude-parser'
import { readFile } from 'fs/promises'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

export declare interface EdgeWorker {
  on<K extends keyof EdgeWorkerEvents>(event: K, listener: EdgeWorkerEvents[K]): this
  emit<K extends keyof EdgeWorkerEvents>(event: K, ...args: Parameters<EdgeWorkerEvents[K]>): boolean
}

/**
 * Unified edge worker that orchestrates NDJSON streaming, Claude processing, and Linear integration
 */
export class EdgeWorker extends EventEmitter {
  private config: EdgeWorkerConfig
  private repositories: Map<string, RepositoryConfig> = new Map()
  private linearClients: Map<string, LinearClient> = new Map()
  private ndjsonClients: Map<string, NdjsonClient> = new Map()
  private sessionManager: SessionManager
  private claudeRunners: Map<string, ClaudeRunner> = new Map()
  private sessionToRepo: Map<string, string> = new Map() // Maps session ID to repository ID

  constructor(config: EdgeWorkerConfig) {
    super()
    this.config = config
    this.sessionManager = new SessionManager()

    // Initialize repositories
    for (const repo of config.repositories) {
      if (repo.isActive !== false) {
        this.repositories.set(repo.id, repo)
        
        // Create Linear client for this repository's workspace
        this.linearClients.set(repo.id, new LinearClient({
          accessToken: repo.linearToken
        }))
      }
    }

    // Group repositories by token to minimize NDJSON connections
    const tokenToRepos = new Map<string, RepositoryConfig[]>()
    for (const repo of this.repositories.values()) {
      const repos = tokenToRepos.get(repo.linearToken) || []
      repos.push(repo)
      tokenToRepos.set(repo.linearToken, repos)
    }

    // Create one NDJSON client per unique token
    for (const [token, repos] of tokenToRepos) {
      const ndjsonClient = new NdjsonClient({
        proxyUrl: config.proxyUrl,
        token: token,
        onConnect: () => this.handleConnect(token),
        onDisconnect: (reason) => this.handleDisconnect(token, reason),
        onError: (error) => this.handleError(error)
      })

      // Set up webhook handler
      ndjsonClient.on('webhook', (data) => this.handleWebhook(data, repos))
      
      // Optional heartbeat logging
      if (process.env.DEBUG_EDGE === 'true') {
        ndjsonClient.on('heartbeat', () => {
          console.log(`❤️ Heartbeat received for token ending in ...${token.slice(-4)}`)
        })
      }

      this.ndjsonClients.set(token, ndjsonClient)
    }
  }

  /**
   * Start the edge worker
   */
  async start(): Promise<void> {
    // Connect all NDJSON clients
    const connections = Array.from(this.ndjsonClients.values()).map(client => 
      client.connect()
    )
    await Promise.all(connections)
  }

  /**
   * Stop the edge worker
   */
  async stop(): Promise<void> {
    // Kill all Claude processes
    for (const [, runner] of this.claudeRunners) {
      runner.kill()
    }
    this.claudeRunners.clear()
    
    // Clear all sessions
    for (const [issueId] of this.sessionManager.getAllSessions()) {
      this.sessionManager.removeSession(issueId)
    }
    this.sessionToRepo.clear()
    
    // Disconnect all NDJSON clients
    for (const client of this.ndjsonClients.values()) {
      client.disconnect()
    }
  }

  /**
   * Handle connection established
   */
  private handleConnect(token: string): void {
    this.emit('connected', token)
    console.log(`✅ Connected to proxy with token ending in ...${token.slice(-4)}`)
  }

  /**
   * Handle disconnection
   */
  private handleDisconnect(token: string, reason?: string): void {
    this.emit('disconnected', token, reason)
    console.log(`❌ Disconnected from proxy (token ...${token.slice(-4)}): ${reason || 'Unknown reason'}`)
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    this.emit('error', error)
    this.config.handlers?.onError?.(error)
  }

  /**
   * Handle webhook events from proxy
   */
  private async handleWebhook(data: WebhookEvent['data'], repos: RepositoryConfig[]): Promise<void> {
    // Find the appropriate repository for this webhook
    const repository = this.findRepositoryForWebhook(data, repos)
    if (!repository) {
      console.log('No repository configured for webhook from workspace', this.extractWorkspaceId(data))
      return
    }
    try {
      // Check for Agent notifications
      if (data.type === 'AppUserNotification') {
        await this.handleAgentNotification(data, repository)
      } else {
        // Handle legacy webhook format
        await this.handleLegacyWebhook(data, repository)
      }
      
      // Report success if we have an event ID
      if ('eventId' in data && data.eventId) {
        await this.reportStatus({
          eventId: data.eventId as string,
          status: 'completed'
        })
      }
    } catch (error) {
      // Report failure
      if ('eventId' in data && data.eventId) {
        await this.reportStatus({
          eventId: data.eventId as string,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
      throw error
    }
  }

  /**
   * Handle Agent API notifications
   */
  private async handleAgentNotification(data: any, repository: RepositoryConfig): Promise<void> {
    const notification = data.notification
    
    switch (notification?.type) {
      case 'issueAssignedToYou':
        await this.handleIssueAssigned(notification.issue, repository)
        break
        
      case 'issueCommentMention':
      case 'issueCommentReply':
      case 'issueNewComment':
        await this.handleNewComment(notification.issue, notification.comment, repository)
        break
        
      case 'issueUnassignedFromYou':
        await this.handleIssueUnassigned(notification.issue, repository)
        break
        
      default:
        console.log(`Unhandled notification type: ${notification?.type}`)
    }
  }

  /**
   * Handle legacy webhook format
   */
  private async handleLegacyWebhook(data: any, repository: RepositoryConfig): Promise<void> {
    if (data.type === 'Comment' && data.action === 'create') {
      const issue = data.data?.issue
      const comment = data.data
      if (issue && comment) {
        await this.handleNewComment(issue, comment, repository)
      }
    }
  }

  /**
   * Find the repository configuration for a webhook
   */
  private findRepositoryForWebhook(data: any, repos: RepositoryConfig[]): RepositoryConfig | null {
    const workspaceId = this.extractWorkspaceId(data)
    if (!workspaceId) return repos[0] || null // Fallback to first repo if no workspace ID

    return repos.find(repo => repo.linearWorkspaceId === workspaceId) || null
  }

  /**
   * Extract workspace ID from webhook data
   */
  private extractWorkspaceId(data: any): string | null {
    // Try different locations where workspace ID might be
    return data.organizationId || 
           data.workspaceId || 
           data.data?.workspaceId || 
           data.notification?.issue?.team?.id ||
           null
  }

  /**
   * Handle issue assignment
   */
  private async handleIssueAssigned(issue: any, repository: RepositoryConfig): Promise<void> {
    // Create workspace
    const workspace = this.config.handlers?.createWorkspace
      ? await this.config.handlers.createWorkspace(issue, repository)
      : {
          path: `${repository.workspaceBaseDir}/${issue.identifier}`,
          isGitWorktree: false
        }

    // Create Claude runner
    const runner = new ClaudeRunner({
      claudePath: this.config.claudePath,
      workingDirectory: workspace.path,
      allowedTools: this.config.defaultAllowedTools || getAllTools(),
      onEvent: (event) => this.handleClaudeEvent(issue.id, event, repository.id),
      onExit: (code) => this.handleClaudeExit(issue.id, code, repository.id)
    })

    // Store runner
    this.claudeRunners.set(issue.id, runner)

    // Spawn Claude process
    const processInfo = runner.spawn()

    // Create session
    const session = new Session({
      issue,
      workspace,
      process: processInfo.process,
      startedAt: processInfo.startedAt
    })
    
    this.sessionManager.addSession(issue.id, session)
    this.sessionToRepo.set(issue.id, repository.id)

    // Emit events
    this.emit('session:started', issue.id, issue, repository.id)
    this.config.handlers?.onSessionStart?.(issue.id, issue, repository.id)

    // Build and send initial prompt
    const prompt = await this.buildInitialPrompt(issue, repository)
    await runner.sendInitialPrompt(prompt)
  }

  /**
   * Handle new comment on issue
   */
  private async handleNewComment(issue: any, comment: any, repository: RepositoryConfig): Promise<void> {
    const session = this.sessionManager.getSession(issue.id)
    if (!session) {
      console.log(`No active session for issue ${issue.identifier}`)
      return
    }

    // Check if continuation is enabled
    if (!this.config.features?.enableContinuation) {
      console.log('Continuation not enabled, ignoring comment')
      return
    }

    // Kill existing Claude process
    const existingRunner = this.claudeRunners.get(issue.id)
    if (existingRunner) {
      existingRunner.kill()
    }

    // Create new runner with --continue flag
    const runner = new ClaudeRunner({
      claudePath: this.config.claudePath,
      workingDirectory: session.workspace.path,
      allowedTools: this.config.defaultAllowedTools || getAllTools(),
      continueSession: true,
      onEvent: (event) => this.handleClaudeEvent(issue.id, event, repository.id),
      onExit: (code) => this.handleClaudeExit(issue.id, code, repository.id)
    })

    // Store new runner
    this.claudeRunners.set(issue.id, runner)

    // Spawn new process
    runner.spawn()

    // Send comment as input
    await runner.sendInput(comment.body || comment.text || '')
  }

  /**
   * Handle issue unassignment
   */
  private async handleIssueUnassigned(issue: any, repository: RepositoryConfig): Promise<void> {
    // Kill Claude process
    const runner = this.claudeRunners.get(issue.id)
    if (runner) {
      runner.kill()
      this.claudeRunners.delete(issue.id)
    }

    // Remove session
    this.sessionManager.removeSession(issue.id)
    const repoId = this.sessionToRepo.get(issue.id)
    this.sessionToRepo.delete(issue.id)

    // Emit events
    this.emit('session:ended', issue.id, null, repoId || repository.id)
    this.config.handlers?.onSessionEnd?.(issue.id, null, repoId || repository.id)
  }

  /**
   * Handle Claude events
   */
  private async handleClaudeEvent(issueId: string, event: ClaudeEvent, repositoryId: string): Promise<void> {
    // Emit generic event
    this.emit('claude:event', issueId, event, repositoryId)
    this.config.handlers?.onClaudeEvent?.(issueId, event, repositoryId)

    // Handle specific events
    if (event.type === 'assistant') {
      const content = this.extractTextContent(event)
      if (content) {
        this.emit('claude:response', issueId, content, repositoryId)
        
        // Post to Linear
        await this.postComment(issueId, content, repositoryId)
      }
    } else if (event.type === 'tool' && 'tool_name' in event) {
      this.emit('claude:tool-use', issueId, event.tool_name, event.input, repositoryId)
    } else if (event.type === 'error' || event.type === 'tool_error') {
      const errorMessage = 'message' in event ? event.message : 'error' in event ? event.error : 'Unknown error'
      this.handleError(new Error(`Claude error: ${errorMessage}`))
    }

    // Handle token limit
    if (this.config.features?.enableTokenLimitHandling && event.type === 'error') {
      if ('message' in event && event.message?.includes('token')) {
        await this.handleTokenLimit(issueId, repositoryId)
      }
    }
  }

  /**
   * Handle Claude process exit
   */
  private handleClaudeExit(issueId: string, code: number | null, repositoryId: string): void {
    this.claudeRunners.delete(issueId)
    this.sessionToRepo.delete(issueId)
    this.emit('session:ended', issueId, code, repositoryId)
    this.config.handlers?.onSessionEnd?.(issueId, code, repositoryId)
  }

  /**
   * Handle token limit by restarting session
   */
  private async handleTokenLimit(issueId: string, repositoryId: string): Promise<void> {
    const session = this.sessionManager.getSession(issueId)
    if (!session) return

    const repository = this.repositories.get(repositoryId)
    if (!repository) return

    // Post warning to Linear
    await this.postComment(
      issueId,
      '[System] Token limit reached. Starting fresh session with issue context.',
      repositoryId
    )

    // Restart session
    await this.handleIssueAssigned(session.issue, repository)
  }

  /**
   * Build initial prompt for issue
   */
  private async buildInitialPrompt(issue: any, repository: RepositoryConfig): Promise<string> {
    try {
      // Use custom template if provided (repository-specific takes precedence)
      let templatePath = repository.promptTemplatePath || this.config.features?.promptTemplatePath
      
      // If no custom template, use the default one
      if (!templatePath) {
        const __filename = fileURLToPath(import.meta.url)
        const __dirname = dirname(__filename)
        templatePath = resolve(__dirname, '../prompt-template.md')
      }

      // Load the template
      const template = await readFile(templatePath, 'utf-8')
      
      // Get comment history
      const linearClient = this.linearClients.get(repository.id)
      let commentHistory = ''
      let latestComment = ''
      
      if (linearClient && issue.id) {
        try {
          const comments = await linearClient.comments({
            filter: { issue: { id: { eq: issue.id } } }
          })
          
          const commentNodes = await comments.nodes
          if (commentNodes.length > 0) {
            commentHistory = commentNodes.map((comment: any, index: number) => 
              `Comment ${index + 1} by ${comment.user?.name || 'Unknown'} at ${comment.createdAt}:\n${comment.body}`
            ).join('\n\n')
            
            latestComment = commentNodes[commentNodes.length - 1]?.body || ''
          }
        } catch (error) {
          console.error('Failed to fetch comments:', error)
        }
      }
      
      // Replace template variables
      const prompt = template
        .replace(/{{repository_name}}/g, repository.name)
        .replace(/{{issue_id}}/g, issue.id || issue.identifier || '')
        .replace(/{{issue_title}}/g, issue.title || '')
        .replace(/{{issue_description}}/g, issue.description || 'No description provided')
        .replace(/{{issue_state}}/g, issue.state?.name || 'Unknown')
        .replace(/{{issue_priority}}/g, issue.priority?.toString() || 'None')
        .replace(/{{issue_url}}/g, issue.url || '')
        .replace(/{{comment_history}}/g, commentHistory || 'No comments yet')
        .replace(/{{latest_comment}}/g, latestComment || 'No comments yet')
        .replace(/{{working_directory}}/g, this.config.handlers?.createWorkspace ? 
          'Will be created based on issue' : repository.repositoryPath)
        .replace(/{{base_branch}}/g, repository.baseBranch)
        .replace(/{{branch_name}}/g, issue.branchName || `${issue.identifier}-${issue.title?.toLowerCase().replace(/\s+/g, '-').substring(0, 30)}`)
        
      return prompt
    } catch (error) {
      console.error('Failed to load prompt template:', error)
      
      // Fallback to simple prompt
      return `Please help me with the following Linear issue:

Repository: ${repository.name}
Issue: ${issue.identifier}
Title: ${issue.title}
Description: ${issue.description || 'No description provided'}

Working directory: ${repository.repositoryPath}
Base branch: ${repository.baseBranch}

Please analyze this issue and help implement a solution.`
    }
  }

  /**
   * Extract text content from Claude event
   */
  private extractTextContent(event: any): string | null {
    if (event.type !== 'assistant') return null
    
    const message = event.message
    if (!message?.content) return null

    if (typeof message.content === 'string') {
      return message.content
    }

    if (Array.isArray(message.content)) {
      return message.content
        .filter((block: any) => block.type === 'text')
        .map((block: any) => block.text)
        .join('')
    }

    return null
  }

  /**
   * Report status back to proxy
   */
  private async reportStatus(update: StatusUpdate): Promise<void> {
    // Find which client to use based on the event ID
    // For now, send to all clients (they'll ignore if not their event)
    const promises = Array.from(this.ndjsonClients.values()).map(client => 
      client.sendStatus(update).catch(err => 
        console.error('Failed to send status update:', err)
      )
    )
    await Promise.all(promises)
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): Map<string, boolean> {
    const status = new Map<string, boolean>()
    for (const [token, client] of this.ndjsonClients) {
      status.set(token, client.isConnected())
    }
    return status
  }

  /**
   * Get active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessionManager.getAllSessions().keys())
  }

  /**
   * Post a comment to Linear
   */
  private async postComment(issueId: string, body: string, repositoryId: string): Promise<void> {
    try {
      // Get the Linear client for this repository
      const linearClient = this.linearClients.get(repositoryId)
      if (!linearClient) {
        throw new Error(`No Linear client found for repository ${repositoryId}`)
      }

      const commentData: any = {
        issueId,
        body
      }

      const response = await linearClient.createComment(commentData)

      // Linear SDK returns CommentPayload with structure: { comment, success, lastSyncId }
      if (response && response.comment) {
        console.log(`✅ Successfully created comment on issue ${issueId}`)
        const comment = await response.comment
        if (comment?.id) {
          console.log(`Comment ID: ${comment.id}`)
        }
      } else {
        throw new Error('Comment creation failed')
      }
    } catch (error) {
      console.error(`Failed to create comment on issue ${issueId}:`, error)
      throw error
    }
  }
}