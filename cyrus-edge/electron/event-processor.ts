import { EventEmitter } from 'events'
import { spawn } from 'child_process'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'

interface ProcessorConfig {
  linearToken: string
  claudePath: string
  workspaceBaseDir: string
}

export class EventProcessor extends EventEmitter {
  private config: ProcessorConfig
  private activeSessions: Map<string, any> = new Map()

  constructor(config: ProcessorConfig) {
    super()
    this.config = config
  }

  async processEvent(event: any): Promise<void> {
    console.log('Processing event:', event.type, event.data?.webhookType)
    console.log('Event data:', JSON.stringify(event.data, null, 2))

    switch (event.type) {
      case 'webhook':
        await this.handleWebhook(event)
        break
      case 'heartbeat':
        // Just acknowledge heartbeats
        break
      default:
        console.warn('Unknown event type:', event.type)
    }
  }

  private async handleWebhook(event: any): Promise<void> {
    const webhook = event.data
    
    // Linear webhook structure: { type, action, data, ... }
    // For notifications: { type: 'AppUserNotification', notification: { type: 'issueAssignedToYou', ... } }
    
    if (webhook.type === 'AppUserNotification') {
      const notificationType = webhook.notification?.type
      const issue = webhook.notification?.issue
      
      switch (notificationType) {
        case 'issueAssignedToYou':
          await this.handleIssueAssigned(issue)
          break
        case 'issueCommentMention':
        case 'issueCommentReply':
          await this.handleComment({ issue, comment: webhook.notification })
          break
        default:
          console.log('Unhandled notification type:', notificationType)
      }
    } else {
      console.log('Unhandled webhook type:', webhook.type)
    }
  }

  private async handleIssueAssigned(issue: any): Promise<void> {
    if (!issue) {
      console.error('No issue data provided to handleIssueAssigned')
      return
    }

    console.log('Handling issue assigned:', issue.identifier, issue.title)
    
    // Create workspace directory
    const workspaceDir = join(this.config.workspaceBaseDir, `issue-${issue.id}`)
    await mkdir(workspaceDir, { recursive: true })

    // Create a prompt file for Claude
    const prompt = `
You are working on Linear issue ${issue.identifier}: ${issue.title}

Description:
${issue.description || 'No description provided'}

Please help solve this issue.
`

    await writeFile(join(workspaceDir, 'prompt.md'), prompt)

    // Start Claude session
    const claudeProcess = spawn(this.config.claudePath, [], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        LINEAR_TOKEN: this.config.linearToken
      }
    })

    this.activeSessions.set(issue.id, {
      process: claudeProcess,
      workspaceDir
    })

    // Emit status updates
    this.emit('session-started', {
      issueId: issue.id,
      identifier: issue.identifier,
      title: issue.title
    })

    claudeProcess.on('exit', (code) => {
      this.emit('session-ended', {
        issueId: issue.id,
        code
      })
      this.activeSessions.delete(issue.id)
    })
  }

  private async handleComment(data: any): Promise<void> {
    const { issue, comment } = data
    const session = this.activeSessions.get(issue.id)

    if (!session) {
      console.log('No active session for issue:', issue.id)
      return
    }

    // In a real implementation, we would send the comment to Claude
    // For now, just log it
    console.log('New comment on', issue.identifier, ':', comment.body)
  }

  getActiveSessions(): Array<{issueId: string, workspaceDir: string}> {
    return Array.from(this.activeSessions.entries()).map(([issueId, session]) => ({
      issueId,
      workspaceDir: session.workspaceDir
    }))
  }
}