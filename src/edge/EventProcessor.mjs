/**
 * Process webhook events received from the proxy
 * This bridges the edge client with the existing issue service
 */
export class EventProcessor {
  constructor(issueService) {
    this.issueService = issueService
  }

  /**
   * Process a webhook event
   * @param {object} webhook - The webhook payload
   */
  async processWebhook(webhook) {
    // Check if we're authenticated before processing
    if (!this.issueService.getAuthStatus()) {
      console.log('⚠️ Received webhook event but not authenticated with Linear API')
      return
    }

    // Check if this is an Agent notification webhook
    const isAgentNotification = webhook.type === "AppUserNotification"
    
    try {
      if (isAgentNotification) {
        await this.processAgentNotification(webhook)
      } else {
        await this.processLegacyWebhook(webhook)
      }
    } catch (error) {
      console.error('Error processing webhook:', error)
      throw error // Re-throw to report failure to proxy
    }
  }

  /**
   * Process Agent API notification
   * @param {object} webhook - The webhook payload
   */
  async processAgentNotification(webhook) {
    const action = webhook.action
    const notification = webhook.notification
    
    // Check if notification is from the agent itself
    const agentUserId = this.issueService.userId
    if (
      (notification.actor?.id === agentUserId) || 
      (notification.comment?.userId === agentUserId)
    ) {
      console.log('⚠️ Ignoring notification from the agent itself')
      return
    }

    // Route to appropriate handler based on notification type
    switch (notification.type) {
      case 'agentAssignable':
        console.log('Agent is now assignable to issues')
        break
        
      case 'issueAssignedToYou':
        console.log(`Issue ${notification.issue.identifier} assigned to agent`)
        await this.issueService.handleAgentAssignment({
          issueId: notification.issueId,
          issue: notification.issue,
          actor: notification.actor
        })
        break
        
      case 'issueCommentMention':
        console.log('Agent was mentioned in a comment')
        await this.issueService.handleAgentMention({
          commentId: notification.commentId,
          comment: notification.comment,
          issueId: notification.issueId,
          issue: notification.issue,
          actor: notification.actor
        })
        break
        
      case 'issueCommentReply':
        console.log('Someone replied to agent\'s comment')
        await this.issueService.handleAgentReply({
          commentId: notification.commentId,
          comment: notification.comment,
          issueId: notification.issueId,
          issue: notification.issue,
          actor: notification.actor
        })
        break
        
      case 'issueNewComment':
        console.log('New comment on an issue assigned to the agent')
        const agentUsername = this.issueService.username
        const commentBody = notification.comment?.body || ''
        const hasMentions = commentBody.includes('@')
        const mentionsAgent = agentUsername && commentBody.includes(`@${agentUsername}`)
        
        if (!hasMentions || mentionsAgent) {
          await this.issueService.handleAgentMention({
            commentId: notification.commentId,
            comment: notification.comment,
            issueId: notification.issueId,
            issue: notification.issue,
            actor: notification.actor
          })
        } else {
          console.log('Comment mentions other users but not agent, ignoring')
        }
        break
        
      case 'issueUnassignedFromYou':
        console.log('Agent was unassigned from an issue')
        await this.issueService.handleAgentUnassignment({
          issueId: notification.issueId,
          issue: notification.issue,
          actor: notification.actor
        })
        break
        
      default:
        console.log(`Unhandled notification type: ${notification.type}`)
    }
  }

  /**
   * Process legacy webhook format
   * @param {object} webhook - The webhook payload
   */
  async processLegacyWebhook(webhook) {
    const type = webhook.type
    const action = webhook.action
    const data = webhook.data || {}
    
    console.log(`Processing legacy webhook: ${type}/${action}`)
    
    // Check if this is from the agent itself
    const agentUserId = this.issueService.userId
    if (data.user?.id === agentUserId) {
      console.log('⚠️ Ignoring webhook from the agent itself')
      return
    }
    
    // Handle different webhook types
    if (type === 'Comment' && action === 'create') {
      if (!data.issueId || !data.body) {
        console.error('Comment data missing required fields')
        return
      }
      await this.issueService.handleCommentEvent(data)
    } else if (type === 'Issue' && action === 'update') {
      if (!data.id || !data.identifier) {
        console.error('Issue update data missing required fields')
        return
      }
      await this.issueService.handleIssueUpdateEvent(data)
    } else if (type === 'Issue' && action === 'create') {
      if (!data.id || !data.identifier || !data.title) {
        console.error('Issue create data missing required fields')
        return
      }
      await this.issueService.handleIssueCreateEvent(data)
    } else {
      console.log(`Unhandled legacy webhook type: ${type}/${action}`)
    }
  }
}