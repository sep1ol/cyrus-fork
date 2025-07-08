import { Session } from './Session.js'

/**
 * Manages active Claude sessions
 * Now supports comment-based session mapping (one session per comment thread)
 */
export class SessionManager {
  private sessionsByCommentId: Map<string, Session>
  private sessionsByIssueId: Map<string, Session[]>

  constructor() {
    this.sessionsByCommentId = new Map()
    this.sessionsByIssueId = new Map()
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
}