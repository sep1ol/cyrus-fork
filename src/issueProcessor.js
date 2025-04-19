const { createWorkspace, getWorkspaceForIssue } = require('./workspace');
const { startClaudeSession } = require('./claude');
const fs = require('fs-extra');
const path = require('path');

/**
 * Process a Linear issue
 */
async function processIssue(issue, activeSessions, linearClient) {
  try {
    // Skip if we already have an active session for this issue
    if (activeSessions.has(issue.id)) {
      console.log(`Already have an active session for issue ${issue.identifier}`);
      return;
    }
    
    console.log(`Processing issue ${issue.identifier}: ${issue.title}`);
    
    // Get or create a workspace for this issue
    let workspacePath = await getWorkspaceForIssue(issue);
    if (!workspacePath) {
      console.log(`Creating new workspace for issue ${issue.identifier}`);
      workspacePath = await createWorkspace(issue);
    }
    
    // Start a Claude session for this issue
    console.log(`Starting Claude session for issue ${issue.identifier}`);
    const claudeProcess = await startClaudeSession(issue, workspacePath);
    
    // Store information about this session
    activeSessions.set(issue.id, {
      issue,
      workspacePath,
      process: claudeProcess,
      startedAt: new Date()
    });
    
    console.log(`Successfully set up session for issue ${issue.identifier}`);
    
    // Set up process exit handler
    claudeProcess.on('exit', (code) => {
      console.log(`Claude process for issue ${issue.identifier} exited with code ${code}`);
      // Keep the session in the map but mark it as exited
      const session = activeSessions.get(issue.id);
      if (session) {
        session.exited = true;
        session.exitCode = code;
        session.exitedAt = new Date();
      }
    });
  } catch (error) {
    console.error(`Error processing issue ${issue.identifier}:`, error);
    // Post error to Linear comment
    try {
      const { createComment } = require('./linearAgent');
      await createComment(
        issue.id, 
        `Claude agent encountered an error:\n\n\`\`\`\n${error.message}\n\`\`\``
      );
    } catch (commentError) {
      console.error(`Failed to post error comment to Linear:`, commentError);
    }
  }
}

/**
 * Get status of all active Claude sessions
 */
function getSessionsStatus(activeSessions) {
  console.log('\n===== CLAUDE SESSIONS STATUS =====');
  console.log(`Active sessions: ${activeSessions.size}`);
  
  if (activeSessions.size === 0) {
    console.log('No active sessions.');
    console.log('===================================\n');
    return;
  }
  
  // Convert the Map to an array for easier iteration
  const sessions = Array.from(activeSessions.entries());
  
  for (const [issueId, session] of sessions) {
    const { issue, startedAt, process, exited, exitCode, exitedAt, workspacePath } = session;
    
    // Calculate runtime
    const now = new Date();
    const runtime = Math.floor((now - startedAt) / 1000);
    const hours = Math.floor(runtime / 3600);
    const minutes = Math.floor((runtime % 3600) / 60);
    const seconds = runtime % 60;
    const runtimeStr = `${hours}h ${minutes}m ${seconds}s`;
    
    console.log(`\nIssue: ${issue.identifier} - ${issue.title}`);
    console.log(`Status: ${exited ? 'EXITED' : 'RUNNING'}`);
    console.log(`Runtime: ${runtimeStr}`);
    
    if (exited) {
      console.log(`Exit code: ${exitCode}`);
      console.log(`Exited at: ${exitedAt.toISOString()}`);
    }
  }
  
  console.log('\n===================================\n');
}

// Export an init function to start monitoring
function initStatusMonitoring(linearAgentModule) {
  console.log('Setting up periodic status check timer...');
  
  // Store a reference to the linearAgent module
  const linearAgent = linearAgentModule;
  
  // Set up a timer to periodically show session status
  setInterval(() => {
    console.log('Status check timer triggered');
    getSessionsStatus(linearAgent.activeSessions);
  }, 15000); // Show status every 15 seconds (decreased from 60s for testing)
  
  return true;
}

module.exports = {
  processIssue,
  getSessionsStatus,
  initStatusMonitoring
};