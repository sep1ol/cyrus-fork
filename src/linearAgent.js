const { LinearClient } = require('@linear/sdk');
const fs = require('fs-extra'); // Ensure fs-extra is required
const path = require('path'); // Ensure path is required
const os = require('os'); // Add os module requirement
const { createWorkspace, getWorkspaceForIssue, getHistoryFilePath } = require('./workspace'); // Import getHistoryFilePath
const { startClaudeSession, sendToClaudeSession } = require('./claude');

// Store pending issues when the processor is not yet loaded
const pendingIssues = [];

// Map of issue ID to claude process info
const activeSessions = new Map();

// Initialize Linear client
const linearClient = new LinearClient({
  apiKey: process.env.LINEAR_API_TOKEN
});

// Add comment creation function
async function createComment(issueId, body) {
  try {
    await linearClient.createComment({
      issueId: issueId,
      body: body
    });
    return true;
  } catch (error) {
    console.error(`Failed to create comment on issue ${issueId}:`, error);
    return false;
  }
}

// Helper function to encapsulate sending comment to avoid repetition
async function sendCommentToSession(sessionInfo, body) {
  try {
    // Check if the process is still alive
    if (!sessionInfo.process || sessionInfo.process.killed) {
      console.log(`Claude process is not running. sendToClaudeSession will start a new one.`);
      // No need to start a session here, sendToClaudeSession handles it.
    }

    // Send the comment prompt. sendToClaudeSession will handle
    // killing any old process and starting a new one with the full context.
    const newProcess = await sendToClaudeSession(sessionInfo.process, body);

    // Update the session info with the new process started by sendToClaudeSession
    sessionInfo.process = newProcess;

    console.log(`✅ Comment successfully sent to Claude for issue ${sessionInfo.issue.id}`);
    console.log(`Claude is processing the comment and will post a response to Linear when ready.`);
  } catch (err) {
    console.error(`Failed to send comment to Claude: ${err.message}`);
    // Optionally, post an error comment back to Linear
    try {
        await createComment(sessionInfo.issue.id, `Agent encountered an error trying to process your comment: ${err.message}`);
    } catch (commentError) {
        console.error(`Failed to post error comment to Linear for issue ${sessionInfo.issue.id}:`, commentError);
    }
  }
}

/**
 * Start the Linear agent to monitor assigned issues
 */
async function startLinearAgent() {
  console.log('Starting Linear agent...');
  
  try {
    // Initial fetch of assigned issues
    await fetchAssignedIssues();
    
    console.log('Linear agent started successfully');
  } catch (error) {
    console.error('Failed to start Linear agent:', error);
    throw error;
  }
}

/**
 * Fetch issues assigned to the specified user
 */
async function fetchAssignedIssues() {
  try {
    console.log(`Fetching issues assigned to user ${process.env.LINEAR_USER_ID}...`);
    
    // Get issues assigned to this user
    const issues = await linearClient.issues({
      filter: {
        assignee: { id: { eq: process.env.LINEAR_USER_ID } },
        state: { type: { nin: ["canceled", "completed"] } }
      }
    });
    
    // Process each issue
    const issueNodes = issues.nodes;
    console.log(`Found ${issueNodes.length} assigned issues`);
    
    // We'll directly use functions instead of trying to import the module
    // This avoids circular dependency issues
    for (const issue of issueNodes) {
      await processIssueDirectly(issue);
    }
  } catch (error) {
    console.error('Error fetching assigned issues:', error);
  }
}

/**
 * Process an issue directly without relying on the issueProcessor module
 */
async function processIssueDirectly(issue) {
  let workspacePath; // Define workspacePath outside try block
  try {
    // Skip if we already have an active session for this issue
    if (activeSessions.has(issue.id)) {
      console.log(`Already have an active session for issue ${issue.identifier}`);
      return;
    }
    
    console.log(`Processing issue ${issue.identifier}: ${issue.title}`);
    
    // Get or create a workspace for this issue
    workspacePath = await getWorkspaceForIssue(issue); // Assign value here
    if (!workspacePath) {
      console.log(`Creating new workspace for issue ${issue.identifier}`);
      workspacePath = await createWorkspace(issue); // Assign value here
    }
    
    // Start a Claude session for this issue
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
    claudeProcess.on('exit', async (code) => {
      console.log(`Claude process for issue ${issue.identifier} exited with code ${code}`);
      const session = activeSessions.get(issue.id);
      if (session && session.process) {
        session.exited = true;
        session.exitCode = code;
        session.exitedAt = new Date();

        // Retrieve only stderr content, as other final messages are handled in claude.js
        const stderrContent = session.process.stderrContent || '';

        // If the process exited with an error, post a notification to Linear
        if (code !== 0) {
          console.error(`Claude process for ${issue.identifier} exited abnormally (code ${code}).`);
          let errorMessage = `Claude process for issue ${issue.identifier} exited unexpectedly with code ${code}.`;
          if (stderrContent) {
            errorMessage += `\n\n**Error details (stderr):**\n\`\`\`\n${stderrContent.substring(0, 1500)} ${stderrContent.length > 1500 ? '... (truncated)' : ''}\n\`\`\``;
          }
          try {
            await createComment(issue.id, errorMessage);
          } catch (commentError) {
            console.error(`Failed to post error exit status comment to Linear for issue ${issue.identifier}:`, commentError);
          }
        } else {
          console.log(`Claude process for ${issue.identifier} finished successfully. Final messages were posted during the run.`);
        }

        // Clean up the session info
        // Consider removing the session from activeSessions map here or after a delay
        // activeSessions.delete(issue.id);

      } else {
         console.warn(`Could not find active session or process details for issue ${issue.id} upon exit.`);
      }
    });
  } catch (error) {
    console.error(`Error processing issue ${issue.identifier}:`, error);
    // Post error as a Linear comment
    try {
      await createComment(
        issue.id, 
        `Claude agent encountered an error while processing issue ${issue.identifier}:\n\n\`\`\`\n${error.message}\n\`\`\``
      );
    } catch (commentError) {
      console.error(`Failed to post error comment to Linear for issue ${issue.identifier}:`, commentError);
    }
  }
}

/**
 * Handle issue creation events from the webhook
 */
async function handleIssueCreateEvent(issueData) {
  try {
    console.log(`===== WEBHOOK: Received issue creation event for ${issueData.identifier || issueData.id} =====`);
    
    // Check if the issue is assigned to our agent
    if (issueData.assigneeId === process.env.LINEAR_USER_ID) {
      console.log(`New issue ${issueData.identifier || issueData.id} is assigned to our agent, processing immediately`);
      
      // Fetch complete issue data
      const issue = await linearClient.issue(issueData.id);
      // console.log(`Issue details:\n  Identifier: ${issue.identifier}\n  Title: ${issue.title}\n  Description: ${issue.description || 'No description'}\n  Status: ${issue.state?.name || 'Unknown'}\n  Priority: ${issue.priority}\n  URL: ${issue.url}`);
      
      // Process the issue right away
      await processIssueDirectly(issue);
      
      console.log(`✅ Successfully initiated processing for new issue ${issue.identifier}`);
    } else {
      console.log(`New issue ${issueData.identifier || issueData.id} is not assigned to our agent, skipping`);
    }
  } catch (error) {
    console.error('Error handling issue creation event:', error);
  }
}

/**
 * Handle issue update events from the webhook
 */
async function handleIssueUpdateEvent(issueData) {
  try {
    console.log(`===== WEBHOOK: Received issue update for ${issueData.identifier || issueData.id} =====`);
    
    // Check if the assignee was changed
    if ('assigneeId' in issueData) {
      const newAssigneeId = issueData.assigneeId;
      
      // Check if we have an active session for this issue
      if (activeSessions.has(issueData.id)) {
        const sessionInfo = activeSessions.get(issueData.id);
        const previousAssigneeId = sessionInfo.issue.assigneeId;
        
        console.log(`Assignee change detected: ${previousAssigneeId} -> ${newAssigneeId}`);
        
        // If the issue was assigned to our agent but now isn't
        if (previousAssigneeId === process.env.LINEAR_USER_ID && 
            (newAssigneeId === null || newAssigneeId !== process.env.LINEAR_USER_ID)) {
          console.log(`Issue ${sessionInfo.issue.identifier} has been unassigned from our agent, terminating Claude process`);
          
          // Kill the Claude process
          if (sessionInfo.process && !sessionInfo.process.killed) {
            try {
              // Post a comment to Linear before killing the process
              await createComment(
                issueData.id,
                `This issue has been unassigned from the agent. The Claude process is being terminated.`
              );
              
              // Kill the process
              sessionInfo.process.kill('SIGTERM');
              console.log(`✅ Terminated Claude process for issue ${sessionInfo.issue.identifier}`);
            } catch (killError) {
              console.error(`Error terminating Claude process for issue ${sessionInfo.issue.identifier}:`, killError);
            }
          } else {
            console.log(`No active Claude process to kill for issue ${sessionInfo.issue.identifier}`);
          }
        }
      } 
      // If the issue is newly assigned to our agent
      else if (newAssigneeId === process.env.LINEAR_USER_ID) {
        console.log(`Issue ${issueData.identifier || issueData.id} has been newly assigned to our agent, starting Claude process`);
        
        // Fetch complete issue data
        const issue = await linearClient.issue(issueData.id);
        // console.log(`Issue details:\n  Identifier: ${issue.identifier}\n  Title: ${issue.title}\n  Description: ${issue.description || 'No description'}\n  Status: ${issue.state?.name || 'Unknown'}\n  Priority: ${issue.priority}\n  URL: ${issue.url}`);
        
        // Process the issue right away
        await processIssueDirectly(issue);
        
        console.log(`✅ Successfully initiated processing for newly assigned issue ${issue.identifier}`);
      }
    }
  } catch (error) {
    console.error('Error handling issue update event:', error);
  }
}

/**
 * Handle a comment event from the webhook
 */
async function handleCommentEvent(event) {
  try {
    // Get the issue ID from the comment event
    const { issueId, body, user } = event;

    // Skip comments created by our own user
    if (user.id === process.env.LINEAR_USER_ID) {
      console.log(`Skipping comment from our own user (${user.id})`);
      return;
    }

    console.log(`===== WEBHOOK: Received comment on issue ${issueId} =====`);
    console.log(`From user: ${user.id}`);
    console.log(`Comment: ${body}`);
    console.log(`================================================`);

    // Check if we have an active session for this issue
    if (!activeSessions.has(issueId)) {
      console.log(`No active session for issue ${issueId}. Checking assignment before potentially creating one...`);

      // Get the issue details
      const issue = await linearClient.issue(issueId);
      console.log(`Retrieved issue details: ${issue.identifier} - ${issue.title}`);

      // *** Check if the issue is assigned to the agent ***
      if (issue.assigneeId !== process.env.LINEAR_USER_ID) {
        console.log(`Issue ${issue.identifier} is not assigned to the agent (${process.env.LINEAR_USER_ID}). Skipping comment processing.`);
        return; // Do not process if not assigned
      }

      console.log(`Issue ${issue.identifier} is assigned to the agent. Creating session...`);
      // Process the issue to create a session
      await processIssueDirectly(issue);
    }

    // Get the session info
    const sessionInfo = activeSessions.get(issueId);
    if (!sessionInfo || !sessionInfo.process) {
      console.error(`Could not find valid session for issue ${issueId}`);
      // Attempt to re-process if the issue is assigned, in case session setup failed previously
      const issue = await linearClient.issue(issueId);
      if (issue.assigneeId === process.env.LINEAR_USER_ID) {
        console.log(`Re-attempting session creation for assigned issue ${issue.identifier}`);
        await processIssueDirectly(issue);
        // Re-fetch session info after attempting creation
        const newSessionInfo = activeSessions.get(issueId);
        if (!newSessionInfo || !newSessionInfo.process) {
           console.error(`Still could not establish a valid session for assigned issue ${issueId} after retry.`);
           return;
        }
        // If retry successful, proceed with the new session info
        await sendCommentToSession(newSessionInfo, body);
      } else {
        console.log(`Issue ${issue.identifier} is not assigned to the agent, cannot process comment.`);
        return;
      }
    } else {
      // Session exists, send the comment
      await sendCommentToSession(sessionInfo, body);
    }
  } catch (error) {
    console.error('Error handling comment event:', error);
  }
}

module.exports = {
  startLinearAgent,
  handleCommentEvent,
  handleIssueUpdateEvent,
  handleIssueCreateEvent,
  activeSessions,
  linearClient,
  createComment
};