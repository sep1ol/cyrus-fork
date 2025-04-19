const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

/**
 * Build the initial prompt for Claude
 */
function buildInitialPrompt(issue) {
  // Updated prompt content
  return `You are an AI assistant assigned to work on Linear issue ${issue.identifier}: ${issue.title}

Description: ${issue.description || 'No description provided'}
Status: ${issue.state?.name || 'Unknown'}
Priority: ${issue.priority}
URL: ${issue.url}

Your task is to implement the feature or fix described in the issue. Analyze the requirements and propose a plan or start implementing the necessary code changes.

IMPORTANT:
- When creating branches, pull requests, or interacting with git, always use EXACTLY this branch name: "${issue.identifier.toLowerCase()}". Do not use any prefixes or other modifications.
- If you need clarification or encounter issues, state them clearly.
- Once the code changes are ready and have been approved by the user, you may use the 'gh' command-line tool to create a new pull request or update an existing one for the branch "${issue.identifier.toLowerCase()}".

Begin by analyzing the issue and outlining the steps needed.`;
}

/**
 * Start a Claude session for an issue
 */
async function startClaudeSession(issue, workspacePath) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Starting Claude session for issue ${issue.identifier}...`);

      // Prepare initial prompt
      const initialPrompt = buildInitialPrompt(issue);

      // Set up history file path
      const historyPath = path.join(workspacePath, 'conversation-history.jsonl');

      // Create history file if it doesn't exist
      if (!fs.existsSync(historyPath)) {
        fs.writeFileSync(historyPath, ''); // Empty file to start
      }

      // Set up Claude args
      let claudeArgs = ['--output-format', 'stream-json'];

      console.log(`Spawning Claude with command: ${process.env.CLAUDE_PATH} ${claudeArgs.join(' ')}`);
      console.log(`Using spawn options: ${JSON.stringify({
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'] // Ensure stdin is pipe
      })}`);

      // Spawn the Claude process
      console.log(`Running Claude in stream-json mode, sending prompt via stdin`);
      const claudeProcess = spawn(process.env.CLAUDE_PATH, claudeArgs, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'] // stdin, stdout, stderr
      });

      // Store references to file paths in the process object
      claudeProcess.historyPath = historyPath;

      // Handle process error (e.g., command not found)
      claudeProcess.on('error', (err) => {
        console.error(`\n[CLAUDE SPAWN ERROR] ${err.message}`);
        console.error(`Make sure the Claude executable is correctly installed and available in PATH`);
        reject(err);
      });

      // Write the initial prompt to stdin and close it
      try {
        claudeProcess.stdin.write(initialPrompt);
        claudeProcess.stdin.end();
        console.log(`Initial prompt sent via stdin to Claude (PID: ${claudeProcess.pid}) for issue ${issue.identifier}`);
      } catch (stdinError) {
        console.error(`Failed to write prompt to Claude stdin: ${stdinError.message}`);
        reject(stdinError);
        return; // Stop further setup if stdin fails
      }

      // Set up buffers to capture output
      let stdout = '';
      let stderr = '';
      let lastLine = '';
      let lastLineTimestamp = Date.now();

      // Set up a timer to periodically log the last line
      const statusTimer = setInterval(() => {
        const now = Date.now();
        const secondsSinceLastLine = Math.floor((now - lastLineTimestamp) / 1000);

        if (lastLine && secondsSinceLastLine > 0) {
          console.log(`[CLAUDE STATUS - ${issue.identifier}] Last activity ${secondsSinceLastLine}s ago`);
        }
      }, 30000); // Log status every 30 seconds

      // Flag to track if we've received the full response JSON
      let receivedCompleteResponse = false;

      // Set up JSON stream handlers
      console.log(`=== Setting up JSON stream handlers for Claude process ${claudeProcess.pid} ===`);

      claudeProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();

        // Update last line tracking
        lastLine = output;
        lastLineTimestamp = Date.now();

        // Skip if the line is not a valid JSON object
        if (!output.startsWith('{') || !output.endsWith('}')) {
          // Log lines that are skipped if they are not empty
          if (output.length > 0) {
            console.log(`[CLAUDE JSON - ${issue.identifier}] Skipped non-JSON line: ${output.substring(0, 100)}...`);
          }
          return;
        }

        // Try to parse the JSON - each line should be a complete JSON object
        try {
          const jsonResponse = JSON.parse(output);

          // Append the parsed (and thus validated) JSON line to the history file
          try {
            fs.appendFileSync(historyPath, output + '\n');
          } catch (err) {
            console.error(`Failed to update conversation history (${historyPath}): ${err.message}`);
          }

          // If this is the assistant message response (not the system cost message)
          if (jsonResponse.role === 'assistant' && jsonResponse.content && !receivedCompleteResponse) {
            console.log(`Received complete assistant response from Claude`);

            // Extract the text content from the response
            let responseText = '';
            if (Array.isArray(jsonResponse.content)) {
              for (const content of jsonResponse.content) {
                if (content.type === 'text') {
                  responseText += content.text;
                }
              }
            } else if (typeof jsonResponse.content === 'string') {
              responseText = jsonResponse.content;
            }

            // If we have a valid response, post it to Linear
            if (responseText && responseText.trim().length > 0) {
              console.log(`Extracted response text (${responseText.length} chars)`);

              // Mark as posted to avoid duplicates
              receivedCompleteResponse = true;
              claudeProcess.responsePosted = true;

              // Post to Linear
              postResponseToLinear(issue.id, responseText)
                .then(() => {
                  console.log(`Successfully posted response to Linear for issue ${issue.id}`);
                })
                .catch(err => console.error(`Failed to post response: ${err.message}`));
            }
          }

          // If this is the final cost message, log it
          if (jsonResponse.role === 'system' && jsonResponse.cost_usd) {
            console.log(`Claude response completed - Cost: $${jsonResponse.cost_usd.toFixed(4)}, Duration: ${jsonResponse.duration_ms}ms`);
          }
        } catch (err) {
           // Log parsing errors more clearly
           console.error(`[CLAUDE JSON - ${issue.identifier}] Error parsing JSON line: ${err.message}`);
           console.error(`[CLAUDE JSON - ${issue.identifier}] Offending line: ${output}`);
        }
      });

      // Handle stderr output
      claudeProcess.stderr.on('data', (data) => {
        const error = data.toString();
        stderr += error;

        console.error(`\n[CLAUDE ERROR - ${issue.identifier}] ${error.length} bytes received:`);
        console.error(`----------------------------------------`);
        console.error(error);
        console.error(`----------------------------------------`);
      });

      // Handle process exit
      claudeProcess.on('close', async (code) => {
        console.log(`Claude process for issue ${issue.identifier} exited with code ${code}`);

        // Clear the status timer
        clearInterval(statusTimer);

        if (code !== 0) {
          // If Claude exits with error, post the error to Linear
          await postResponseToLinear(issue.id, `Claude exited with error:\n\n\`\`\`\n${stderr}\n\`\`\``);
          reject(new Error(`Claude process exited with code ${code}`));
          return;
        }

        resolve(claudeProcess);
      });

      // Store issue information
      claudeProcess.issue = issue;
      claudeProcess.issue.workspace = workspacePath;

      console.log(`Status monitoring is active. You'll see updates every 30 seconds.`);

      resolve(claudeProcess);
    } catch (error) {
      console.error(`Failed to start Claude session for issue ${issue.identifier}:`, error);
      reject(error);
    }
  });
}

/**
 * Send input to an existing Claude session
 */
async function sendToClaudeSession(claudeProcess, input) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!claudeProcess || claudeProcess.killed) {
        console.log('Claude process is not running or already killed. Will start a new one.');
      } else {
        console.log(`Terminating previous Claude process (PID: ${claudeProcess.pid})...`);
        claudeProcess.kill();
        await new Promise(res => setTimeout(res, 500));
      }

      console.log(`Sending input to Claude process for issue ${claudeProcess.issue.identifier}...`);
      console.log(`Input length: ${input.length} characters`);

      const workspacePath = claudeProcess.issue.workspace;
      const historyPath = claudeProcess.historyPath;

      console.log(`Building updated prompt with conversation history...`);

      let previousResponse = '';
      if (fs.existsSync(historyPath)) {
        try {
          const historyContent = fs.readFileSync(historyPath, 'utf8');
          const lines = historyContent.trim().split('\n');
          if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            if (lastLine.startsWith('{') && lastLine.endsWith('}')) {
              try {
                const jsonResponse = JSON.parse(lastLine);
                if (jsonResponse.content) {
                  if (Array.isArray(jsonResponse.content)) {
                    for (const content of jsonResponse.content) {
                      if (content.type === 'text') {
                        previousResponse += content.text;
                      }
                    }
                  } else if (typeof jsonResponse.content === 'string') {
                    previousResponse = jsonResponse.content;
                  }
                }
              } catch (jsonErr) {
                console.error(`Failed to parse history JSON: ${jsonErr.message}`);
              }
            }
          }
        } catch (err) {
          console.error(`Failed to read conversation history: ${err.message}`);
        }
      }
      const initialPrompt = buildInitialPrompt(claudeProcess.issue);
      let fullPrompt = initialPrompt;
      if (previousResponse) {
        fullPrompt += `\n\n# Previous Response\n${previousResponse}`;
      }
      fullPrompt += `\n\n# New Input\n${input}`;

      try {
        fs.appendFileSync(historyPath, `\n[${new Date().toISOString()}] New Input:\n${input}\n`);
      } catch (err) {
        console.error(`Failed to write new input to history: ${err.message}`);
      }

      console.log(`Starting new Claude process with updated prompt via stdin...`);

      const claudeArgs = ['--output-format', 'stream-json'];

      const newClaudeProcess = spawn(process.env.CLAUDE_PATH, claudeArgs, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      newClaudeProcess.issue = claudeProcess.issue;
      newClaudeProcess.historyPath = historyPath;

      newClaudeProcess.on('error', (err) => {
        console.error(`\n[NEW CLAUDE SPAWN ERROR] ${err.message}`);
        reject(err);
      });

      try {
        newClaudeProcess.stdin.write(fullPrompt);
        newClaudeProcess.stdin.end();
        console.log(`Updated prompt sent via stdin to new Claude process (PID: ${newClaudeProcess.pid})`);
      } catch (stdinError) {
        console.error(`Failed to write prompt to new Claude stdin: ${stdinError.message}`);
        try { newClaudeProcess.kill(); } catch(killErr) { /* ignore */ }
        reject(stdinError);
        return;
      }

      console.log(`New Claude process started with PID: ${newClaudeProcess.pid}`);
      resolve(newClaudeProcess);

    } catch (error) {
      console.error('Failed to send input to Claude session:', error);
      reject(error);
    }
  });
}

/**
 * Post Claude's response to Linear
 */
async function postResponseToLinear(issueId, response) {
  try {
    const { createComment } = require('./linearAgent');
    
    console.log(`\n===== CLAUDE RESPONSE for issue ${issueId} =====`);
    console.log(`Response length: ${response.length} characters`);
    console.log(`First 100 chars: ${response.substring(0, 100)}...`);
    console.log(`================================================\n`);
    
    const formattedResponse = `Claude Agent Response:\n\n${response}`;
    
    console.log(`Posting Claude's response to Linear issue ${issueId}...`);
    const success = await createComment(issueId, formattedResponse);
    
    if (success) {
      console.log(`✅ Successfully posted Claude's response to Linear issue ${issueId}`);
    } else {
      console.error(`❌ Failed to post Claude's response to Linear issue ${issueId}`);
    }
    
    return success;
  } catch (error) {
    console.error(`Failed to post response to Linear issue ${issueId}:`, error);
    return false;
  }
}

module.exports = {
  buildInitialPrompt,
  startClaudeSession,
  sendToClaudeSession,
  postResponseToLinear
};