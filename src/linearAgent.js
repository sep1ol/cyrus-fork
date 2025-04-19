const { LinearClient } = require('@linear/sdk');
const fs = require('fs-extra'); // Ensure fs-extra is required
const path = require('path'); // Ensure path is required
const { createWorkspace, getWorkspaceForIssue } = require('./workspace');
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
    console.log(`Comment created on issue ${issueId}`);
    return true;
  } catch (error) {
    console.error(`Failed to create comment on issue ${issueId}:`, error);
    return false;
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
    
    // Set up a regular polling interval
    setInterval(fetchAssignedIssues, 5 * 60 * 1000); // Poll every 5 minutes
    
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
    const issueNodes = await issues.nodes;
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
    claudeProcess.on('exit', async (code) => { // Make the handler async
      console.log(`Claude process for issue ${issue.identifier} exited with code ${code}`);
      const session = activeSessions.get(issue.id);
      if (session && session.process) { // Ensure session and process exist
        session.exited = true;
        session.exitCode = code; // Code is passed directly
        session.exitedAt = new Date();

        // Retrieve details stored on the process object by claude.js
        const lastResponse = session.process.lastAssistantResponseText || '';
        const lastRunCost = session.process.finalCost;
        const lastRunDuration = session.process.finalDuration;
        const stderrContent = session.process.stderrContent || '';

        // Add a small delay to allow file system to flush the last write
        await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay

        // Calculate total cost from history
        let totalCost = 0;
        const historyFilePath = path.join(session.workspacePath, 'conversation-history.jsonl');
        let costCalculationMessage = '';

        try {
          if (await fs.pathExists(historyFilePath)) {
            const historyContent = await fs.readFile(historyFilePath, 'utf-8');
            const lines = historyContent.trim().split('\n');
            lines.forEach(line => {
              try {
                const entry = JSON.parse(line);
                if (entry.role === 'system' && typeof entry.cost_usd === 'number') {
                  totalCost += entry.cost_usd;
                }
              } catch (parseError) {
                // Ignore parse errors silently in final calculation
              }
            });
            costCalculationMessage = `\n*Total estimated cost for this issue: $${totalCost.toFixed(2)}*`;
          } else {
            costCalculationMessage = '\n*Conversation history file not found, cannot calculate total cost.*'
          }
        } catch (costError) {
          console.error(`Error calculating total cost for issue ${issue.identifier}:`, costError);
          costCalculationMessage = '\n*Error calculating total session cost.*'
        }

        // Construct the final message
        let finalMessageBody = '';
        if (code === 0) {
          // Successful exit
          finalMessageBody = lastResponse; // Start with the last assistant response
          if (lastRunCost !== null && lastRunDuration !== null) {
            finalMessageBody += `\n\n---`;
            finalMessageBody += `\n*Last run cost: $${lastRunCost.toFixed(2)}, Duration: ${lastRunDuration / 1000}s*`;
          }
          finalMessageBody += costCalculationMessage; // Add total cost info
        } else {
          // Error exit
          finalMessageBody = `Claude process exited with error code ${code}.\n\n`;
          if (lastResponse) {
             finalMessageBody += `**Last valid response before error:**\n${lastResponse}\n\n---\n`;
          }
          if (stderrContent) {
            finalMessageBody += `**Error details (stderr):**\n\`\`\`\n${stderrContent.substring(0, 1500)} ${stderrContent.length > 1500 ? '... (truncated)' : ''}\n\`\`\`\n`;
          }
          if (lastRunCost !== null && lastRunDuration !== null) {
            finalMessageBody += `\n*Last run cost (before error): $${lastRunCost.toFixed(2)}, Duration: ${lastRunDuration}ms*`;
          }
          finalMessageBody += costCalculationMessage; // Add total cost info
        }

        // Post the single final comment to Linear
        try {
          // Ensure message is not empty
          if (!finalMessageBody.trim()) {
            finalMessageBody = `Claude session finished for ${issue.identifier} with exit code ${code}. No final message content generated.`;
            finalMessageBody += costCalculationMessage;
          }
          await createComment(issue.id, finalMessageBody);
        } catch (commentError) {
          console.error(`Failed to post final status comment to Linear for issue ${issue.identifier}:`, commentError);
        }

        // Optionally remove the session from activeSessions after handling exit
        // activeSessions.delete(issue.id);
        // console.log(`Session for issue ${issue.identifier} removed after exit.`);

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
        `Claude agent encountered an error:\n\n\`\`\`\n${error.message}\n\`\`\``
      );
    } catch (commentError) {
      console.error(`Failed to post error comment to Linear:`, commentError);
    }
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
      console.log(`No active session for issue ${issueId}, creating one...`);
      
      // Get the issue details
      const issue = await linearClient.issue(issueId);
      console.log(`Retrieved issue details: ${issue.identifier} - ${issue.title}`);
      
      // Process the issue to create a session
      await processIssueDirectly(issue);
    }
    
    // Get the session info
    const sessionInfo = activeSessions.get(issueId);
    if (!sessionInfo || !sessionInfo.process) {
      console.error(`Could not find valid session for issue ${issueId}`);
      return;
    }
    
    // Format the comment for Claude
    const commentPrompt = `
A user has posted a new comment on the Linear issue we're working on:

${body}

Please consider this information as you continue working on the issue.
`;
    
    // In interactive mode, we can send the comment directly to the running Claude process
    console.log(`Sending comment directly to running Claude process...`);
    
    // Send the comment to Claude via stdin
    try {
      // Check if the process is still alive
      if (!sessionInfo.process || sessionInfo.process.killed) {
        console.log(`Claude process is not running, starting a new one...`);
        
        // Start a new process
        const { startClaudeSession } = require('./claude');
        const newProcess = await startClaudeSession(sessionInfo.issue, sessionInfo.workspacePath);
        
        // Update the session info
        sessionInfo.process = newProcess;
        console.log(`✅ New Claude process started for issue ${issueId}`);
        
        // Wait a moment for the process to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Send the comment to the new process
        await sendToClaudeSession(sessionInfo.process, commentPrompt);
      } else {
        // Send to the existing process
        await sendToClaudeSession(sessionInfo.process, commentPrompt);
      }
      
      console.log(`✅ Comment successfully sent to Claude for issue ${issueId}`);
      console.log(`Claude is processing the comment and will post a response to Linear when ready.`);
    } catch (err) {
      console.error(`Failed to send comment to Claude: ${err.message}`);
    }
  } catch (error) {
    console.error('Error handling comment event:', error);
  }
}

module.exports = {
  startLinearAgent,
  handleCommentEvent,
  activeSessions,
  linearClient,
  createComment
};