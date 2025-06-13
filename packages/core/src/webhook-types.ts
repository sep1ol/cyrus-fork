/**
 * Linear webhook types based on actual webhook payloads
 * These are the exact structures Linear sends in webhooks
 */

/**
 * Linear team data from webhooks
 */
export interface LinearWebhookTeam {
  id: string
  key: string
  name: string
}

/**
 * Linear issue data from webhooks
 */
export interface LinearWebhookIssue {
  id: string
  title: string
  teamId: string
  team: LinearWebhookTeam
  identifier: string
  url: string
}

/**
 * Linear comment data from webhooks
 */
export interface LinearWebhookComment {
  id: string
  body: string
  userId: string
  issueId: string
}

/**
 * Linear actor (user) data from webhooks
 */
export interface LinearWebhookActor {
  id: string
  name: string
  email: string
  url: string
}

/**
 * Base notification structure common to all webhook notifications
 */
export interface LinearWebhookNotificationBase {
  id: string
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  actorId: string
  externalUserActorId: string | null
  userId: string
  issueId: string
  issue: LinearWebhookIssue
  actor: LinearWebhookActor
}

/**
 * Issue assignment notification
 */
export interface LinearIssueAssignedNotification extends LinearWebhookNotificationBase {
  type: 'issueAssignedToYou'
}

/**
 * Issue comment mention notification
 */
export interface LinearIssueCommentMentionNotification extends LinearWebhookNotificationBase {
  type: 'issueCommentMention'
  commentId: string
  comment: LinearWebhookComment
}

/**
 * Issue new comment notification (can have parent comment for replies)
 */
export interface LinearIssueNewCommentNotification extends LinearWebhookNotificationBase {
  type: 'issueNewComment'
  commentId: string
  comment: LinearWebhookComment
  parentCommentId?: string
  parentComment?: LinearWebhookComment
}

/**
 * Issue unassignment notification (inferred structure)
 */
export interface LinearIssueUnassignedNotification extends LinearWebhookNotificationBase {
  type: 'issueUnassignedFromYou'
}

/**
 * Union of all notification types
 */
export type LinearWebhookNotification = 
  | LinearIssueAssignedNotification
  | LinearIssueCommentMentionNotification
  | LinearIssueNewCommentNotification
  | LinearIssueUnassignedNotification

/**
 * Issue assignment webhook payload
 */
export interface LinearIssueAssignedWebhook {
  type: 'AppUserNotification'
  action: 'issueAssignedToYou'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  notification: LinearIssueAssignedNotification
  webhookTimestamp: number
  webhookId: string
}

/**
 * Issue comment mention webhook payload
 */
export interface LinearIssueCommentMentionWebhook {
  type: 'AppUserNotification'
  action: 'issueCommentMention'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  notification: LinearIssueCommentMentionNotification
  webhookTimestamp: number
  webhookId: string
}

/**
 * Issue new comment webhook payload
 */
export interface LinearIssueNewCommentWebhook {
  type: 'AppUserNotification'
  action: 'issueNewComment'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  notification: LinearIssueNewCommentNotification
  webhookTimestamp: number
  webhookId: string
}

/**
 * Issue unassignment webhook payload (inferred structure)
 */
export interface LinearIssueUnassignedWebhook {
  type: 'AppUserNotification'
  action: 'issueUnassignedFromYou'
  createdAt: string
  organizationId: string
  oauthClientId: string
  appUserId: string
  notification: LinearIssueUnassignedNotification
  webhookTimestamp: number
  webhookId: string
}

/**
 * Union of all webhook types we handle
 */
export type LinearWebhook = 
  | LinearIssueAssignedWebhook
  | LinearIssueCommentMentionWebhook
  | LinearIssueNewCommentWebhook
  | LinearIssueUnassignedWebhook

/**
 * Type guards for webhook discrimination
 */
export function isIssueAssignedWebhook(webhook: LinearWebhook): webhook is LinearIssueAssignedWebhook {
  return webhook.action === 'issueAssignedToYou'
}

export function isIssueCommentMentionWebhook(webhook: LinearWebhook): webhook is LinearIssueCommentMentionWebhook {
  return webhook.action === 'issueCommentMention'
}

export function isIssueNewCommentWebhook(webhook: LinearWebhook): webhook is LinearIssueNewCommentWebhook {
  return webhook.action === 'issueNewComment'
}

export function isIssueUnassignedWebhook(webhook: LinearWebhook): webhook is LinearIssueUnassignedWebhook {
  return webhook.action === 'issueUnassignedFromYou'
}