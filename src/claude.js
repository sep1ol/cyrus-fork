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

      // Set up Claude args. DO NOT remove --print, as it is required for the stream-json output format.
      let claudeArgs = ['--print', '--output-format', 'stream-json'];

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

      // Variables to store the latest response and track posting
      let lastAssistantResponseText = '';
      let responsePosted = false; // Flag to prevent duplicate posts
      let finalCost = null; // Variable to store cost
      let finalDuration = null; // Variable to store duration

      // Set up JSON stream handlers
      console.log(`=== Setting up JSON stream handlers for Claude process ${claudeProcess.pid} ===`);

      claudeProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        lastLine = output;
        lastLineTimestamp = Date.now();

        if (!output.startsWith('{') || !output.endsWith('}')) {
          if (output.length > 0) {
            console.log(`[CLAUDE RAW - ${issue.identifier}] Skipped non-JSON line: ${output.substring(0, 100)}...`);
          }
          return;
        }

        try {
          const jsonResponse = JSON.parse(output);

          // Append valid JSON to history
          try {
            fs.appendFileSync(historyPath, output + '\n');
          } catch (err) {
            console.error(`Failed to update conversation history (${historyPath}): ${err.message}`);
          }

          // If this is an assistant message, store its content
          if (jsonResponse.role === 'assistant' && jsonResponse.content) {
            console.log(`Received assistant content chunk from Claude`);
            let currentResponseText = '';
            if (Array.isArray(jsonResponse.content)) {
              for (const content of jsonResponse.content) {
                if (content.type === 'text') {
                  currentResponseText += content.text;
                }
              }
            } else if (typeof jsonResponse.content === 'string') {
              currentResponseText = jsonResponse.content;
            }
            // Update the latest complete response text
            if (currentResponseText.trim().length > 0) {
              lastAssistantResponseText = currentResponseText;
              console.log(`Updated lastAssistantResponseText (${lastAssistantResponseText.length} chars)`);
            }
          }

          // If this is the final cost message, store cost and duration
          if (jsonResponse.role === 'system' && jsonResponse.cost_usd) {
            console.log(`Claude response completed - Cost: $${jsonResponse.cost_usd.toFixed(4)}, Duration: ${jsonResponse.duration_ms}ms`);
            finalCost = jsonResponse.cost_usd; // Store cost
            finalDuration = jsonResponse.duration_ms; // Store duration
          }
        } catch (err) {
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

        if (code === 0) {
          // Process exited successfully. Post the last response if it wasn't already posted.
          if (lastAssistantResponseText && !responsePosted) {
            console.log(`Posting final assistant response to Linear (triggered by process close)...`);
            // Pass cost and duration to postResponseToLinear
            await postResponseToLinear(issue.id, lastAssistantResponseText, finalCost, finalDuration);
            responsePosted = true; // Mark as posted
          } else if (responsePosted) {
            console.log(`Final response already posted.`);
          } else {
            console.log(`Process closed successfully, but no final assistant response text found to post.`);
          }
        } else {
          // Process exited with an error. Post the stderr content.
          console.error(`Claude process exited with error code ${code}. Posting stderr to Linear.`);
          if (!responsePosted) { // Avoid posting error if a response was already successfully posted
            await postResponseToLinear(issue.id, `Claude exited with error code ${code}:\n\n\`\`\`\n${stderr || 'No stderr output captured.'}\n\`\`\``);
            responsePosted = true; // Mark error as posted
          } else {
            console.log(`Error occurred, but a response was already posted.`);
          }
          reject(new Error(`Claude process exited with code ${code}`));
          return; // Ensure rejection happens
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

      // Build a new prompt that includes the conversation history
      console.log(`Building updated prompt with conversation history...`);

      // Start with the initial prompt
      const initialPrompt = buildInitialPrompt(claudeProcess.issue);
      let fullPrompt = initialPrompt;

      // Process and append cleaned history
      if (fs.existsSync(historyPath)) {
        try {
          const historyContent = fs.readFileSync(historyPath, 'utf8');
          const lines = historyContent.trim().split('\n');
          let historyPromptSection = '\n\n# Conversation History\n';

          for (const line of lines) {
            const trimmedLine = line.trim();
            // Skip input markers or empty lines
            if (!trimmedLine.startsWith('{') || !trimmedLine.endsWith('}')) {
              continue;
            }

            try {
              const jsonEntry = JSON.parse(trimmedLine);

              // Create a cleaned copy, removing specified keys
              const cleanedEntry = { ...jsonEntry };
              delete cleanedEntry.id;
              delete cleanedEntry.model;
              delete cleanedEntry.stop_reason;
              delete cleanedEntry.stop_sequence;
              delete cleanedEntry.usage;

              // Remove usage from tool_result content if present
              if (cleanedEntry.role === 'user' && Array.isArray(cleanedEntry.content)) {
                cleanedEntry.content = cleanedEntry.content.map(item => {
                  if (item.type === 'tool_result') {
                    const cleanedItem = { ...item };
                    // Assuming usage might be nested here, remove if found
                    delete cleanedItem.usage;
                    return cleanedItem;
                  }
                  return item;
                });
              }

              // Append the cleaned JSON string to the history section
              const cleanedLine = JSON.stringify(cleanedEntry);
              historyPromptSection += cleanedLine + '\n';
            } catch (jsonErr) {
              console.warn(`Skipping invalid JSON line in history: ${jsonErr.message}`);
            }
          }
          // Append the history section to the main prompt
          fullPrompt += historyPromptSection;
          console.log(`Appended cleaned history (${lines.length} entries`);

        } catch (err) {
          console.error(`Failed to read or process conversation history: ${err.message}`);
        }
      }

      // Append the new input
      fullPrompt += `\n\n# New Input\n${input}`;

      // Log new input to history file (as a simple marker, not JSON)
      try {
        fs.appendFileSync(historyPath, `\n[${new Date().toISOString()}] --- New Input Start --- \n${input}\n[${new Date().toISOString()}] --- New Input End --- \n`);
      } catch (err) {
        console.error(`Failed to write new input marker to history: ${err.message}`);
      }

      // Start a new Claude process with the new prompt via stdin
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
// Modify function signature to accept optional cost and duration
async function postResponseToLinear(issueId, response, costUsd = null, durationMs = null) {
  try {
    const { createComment } = require('./linearAgent');
    
    console.log(`\n===== CLAUDE RESPONSE for issue ${issueId} =====`);
    console.log(`Response length: ${response.length} characters`);
    console.log(`First 100 chars: ${response.substring(0, 100)}...`);
    console.log(`================================================\n`);
    
    // Format the response for Linear
    let formattedResponse = `Claude Agent Response:\n\n${response}`;
    
    // Append cost information if available
    if (costUsd !== null && durationMs !== null) {
      formattedResponse += `\n\n---`;
      formattedResponse += `\n*Cost: $${costUsd.toFixed(4)}, Duration: ${durationMs}ms*`;
    }
    
    // Create a comment on the issue
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