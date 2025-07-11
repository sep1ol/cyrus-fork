import { Session } from './Session.js'
import { PersistenceManager } from './PersistenceManager.js'
import type { SerializableSession } from './PersistenceManager.js'

/**
 * Manages active Claude sessions
 * Now supports comment-based session mapping (one session per comment thread)
 */
export class SessionManager {
  private sessionsByCommentId: Map<string, Session>
  private sessionsByIssueId: Map<string, Session[]>
  // private persistenceManager: PersistenceManager // Reserved for future use

  constructor(_persistenceManager?: PersistenceManager) {
    this.sessionsByCommentId = new Map()
    this.sessionsByIssueId = new Map()
    // this.persistenceManager = persistenceManager || new PersistenceManager() // Reserved for future use
  }
  
  /**
   * Add a session by comment ID (primary method)
   */
  addSession(commentId: string, session: Session): void {
    this.sessionsByCommentId.set(commentId, session)
    
    // Also maintain issue ID mapping for lookup
    const issueId = session.issue.id
    if (!this.sessionsByIssueId.has(issueId)) {
      this.sessionsByIssueId.set(issueId, [])
    }
    this.sessionsByIssueId.get(issueId)!.push(session)
  }
  
  /**
   * Get a session by comment ID
   */
  getSession(commentId: string): Session | undefined {
    return this.sessionsByCommentId.get(commentId)
  }
  
  /**
   * Get all sessions for an issue ID
   */
  getSessionsForIssue(issueId: string): Session[] {
    return this.sessionsByIssueId.get(issueId) || []
  }
  
  /**
   * Check if a session exists for a comment ID
   */
  hasSession(commentId: string): boolean {
    return this.sessionsByCommentId.has(commentId)
  }
  
  /**
   * Check if any sessions exist for an issue ID
   */
  hasSessionsForIssue(issueId: string): boolean {
    return this.sessionsByIssueId.has(issueId) && this.sessionsByIssueId.get(issueId)!.length > 0
  }
  
  /**
   * Remove a session by comment ID
   */
  removeSession(commentId: string): boolean {
    const session = this.sessionsByCommentId.get(commentId)
    if (!session) return false
    
    // Remove from comment mapping
    this.sessionsByCommentId.delete(commentId)
    
    // Remove from issue mapping
    const issueId = session.issue.id
    const issueSessions = this.sessionsByIssueId.get(issueId)
    if (issueSessions) {
      const index = issueSessions.indexOf(session)
      if (index !== -1) {
        issueSessions.splice(index, 1)
        if (issueSessions.length === 0) {
          this.sessionsByIssueId.delete(issueId)
        }
      }
    }
    
    return true
  }
  
  /**
   * Remove all sessions for an issue ID
   */
  removeSessionsForIssue(issueId: string): number {
    const sessions = this.sessionsByIssueId.get(issueId) || []
    let removedCount = 0
    
    for (const session of sessions) {
      // Find the comment ID for this session
      for (const [commentId, sessionObj] of this.sessionsByCommentId.entries()) {
        if (sessionObj === session) {
          this.sessionsByCommentId.delete(commentId)
          removedCount++
          break
        }
      }
    }
    
    this.sessionsByIssueId.delete(issueId)
    return removedCount
  }
  
  /**
   * Get all sessions (by comment ID)
   */
  getAllSessions(): Map<string, Session> {
    return this.sessionsByCommentId
  }
  
  /**
   * Get all sessions grouped by issue ID
   */
  getAllSessionsByIssue(): Map<string, Session[]> {
    return this.sessionsByIssueId
  }
  
  /**
   * Update a session by comment ID
   */
  updateSession(commentId: string, session: Session): boolean {
    if (!this.sessionsByCommentId.has(commentId)) {
      return false
    }
    
    // Remove old session and add new one to maintain consistency
    this.removeSession(commentId)
    this.addSession(commentId, session)
    return true
  }
  
  /**
   * Get all active sessions
   */
  getActiveSessions(): Array<[string, Session]> {
    return Array.from(this.sessionsByCommentId.entries()).filter(([_, session]) => session.isActive())
  }
  
  /**
   * Get all active sessions for a specific issue
   */
  getActiveSessionsForIssue(issueId: string): Session[] {
    return this.getSessionsForIssue(issueId).filter(session => session.isActive())
  }
  
  /**
   * Count active sessions
   */
  countActiveSessions(): number {
    return this.getActiveSessions().length
  }
  
  /**
   * Count active sessions for a specific issue
   */
  countActiveSessionsForIssue(issueId: string): number {
    return this.getActiveSessionsForIssue(issueId).length
  }

  /**
   * Serialize sessions to a format suitable for persistence
   */
  serializeSessions(): { sessionsByCommentId: Record<string, SerializableSession>; sessionsByIssueId: Record<string, SerializableSession[]> } {
    const sessionsByCommentId: Record<string, SerializableSession> = {}
    const sessionsByIssueId: Record<string, SerializableSession[]> = {}

    // Serialize sessionsByCommentId
    for (const [commentId, session] of this.sessionsByCommentId.entries()) {
      sessionsByCommentId[commentId] = this.serializeSession(session)
    }

    // Serialize sessionsByIssueId
    for (const [issueId, sessions] of this.sessionsByIssueId.entries()) {
      sessionsByIssueId[issueId] = sessions.map(session => this.serializeSession(session))
    }

    return { sessionsByCommentId, sessionsByIssueId }
  }

  /**
   * Restore sessions from serialized data
   */
  deserializeSessions(data: { sessionsByCommentId: Record<string, SerializableSession>; sessionsByIssueId: Record<string, SerializableSession[]> }): void {
    // Clear existing sessions
    this.sessionsByCommentId.clear()
    this.sessionsByIssueId.clear()

    // Restore sessionsByCommentId
    for (const [commentId, serializedSession] of Object.entries(data.sessionsByCommentId)) {
      const session = this.deserializeSession(serializedSession)
      this.sessionsByCommentId.set(commentId, session)
    }

    // Restore sessionsByIssueId
    for (const [issueId, serializedSessions] of Object.entries(data.sessionsByIssueId)) {
      const sessions = serializedSessions.map(serializedSession => this.deserializeSession(serializedSession))
      this.sessionsByIssueId.set(issueId, sessions)
    }
  }

  /**
   * Convert a Session to SerializableSession
   */
  private serializeSession(session: Session): SerializableSession {
    return {
      issueId: session.issue.id,
      issueIdentifier: session.issue.identifier,
      issueTitle: session.issue.title,
      workspacePath: session.workspace.path,
      isGitWorktree: session.workspace.isGitWorktree,
      historyPath: session.workspace.historyPath,
      claudeSessionId: session.claudeSessionId,
      agentRootCommentId: session.agentRootCommentId,
      lastCommentId: session.lastCommentId,
      currentParentId: session.currentParentId,
      startedAt: session.startedAt.toISOString(),
      exitedAt: session.exitedAt?.toISOString() || null,
      conversationContext: session.conversationContext
    }
  }

  /**
   * Convert a SerializableSession to Session
   */
  private deserializeSession(serializedSession: SerializableSession): Session {
    return new Session({
      issue: {
        id: serializedSession.issueId,
        identifier: serializedSession.issueIdentifier,
        title: serializedSession.issueTitle,
        getBranchName: () => serializedSession.issueIdentifier.toLowerCase().replace(/[^a-z0-9]/g, '-')
      },
      workspace: {
        path: serializedSession.workspacePath,
        isGitWorktree: serializedSession.isGitWorktree,
        historyPath: serializedSession.historyPath
      },
      claudeSessionId: serializedSession.claudeSessionId,
      agentRootCommentId: serializedSession.agentRootCommentId,
      lastCommentId: serializedSession.lastCommentId,
      currentParentId: serializedSession.currentParentId,
      startedAt: serializedSession.startedAt,
      exitedAt: serializedSession.exitedAt,
      conversationContext: serializedSession.conversationContext
    })
  }
}