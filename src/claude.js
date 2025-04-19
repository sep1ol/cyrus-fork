const { spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

// Ensure --print is included for non-interactive mode with stream-json
/*
Bash \
Edit \
Replace \
FileWriteTool \
FileEditTool
*/
const CLAUDE_ARGS = ['--print', '--output-format', 'stream-json', '--allowedTools', 'Bash', 'Edit', 'Replace', 'FileWriteTool', 'FileEditTool'];


/**
 * Helper to format comments for the prompt
 */
function formatLinearComments(comments) {
  if (!comments || !comments.nodes || comments.nodes.length === 0) {
    return '<linear_comments>No comments yet.</linear_comments>';
  }
  let commentString = '<linear_comments>\n';
  comments.nodes.forEach(comment => {
    // Basic XML escaping for comment body
    const escapedBody = comment.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
    commentString += `  <comment author="${comment.user?.name || 'Unknown'}">\n`;
    commentString += `    <body>${escapedBody}</body>\n`; // Use escaped body
    commentString += `  </comment>\n`;
  });
  commentString += '</linear_comments>';
  return commentString;
}

/**
 * Build the initial prompt for Claude using XML structure
 */
function buildInitialPrompt(issue) {
  // Basic XML escaping for text content
  const escapeXml = (unsafe) => unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const issueDetails = `
<issue_details>
  <identifier>${escapeXml(issue.identifier)}</identifier>
  <title>${escapeXml(issue.title)}</title>
  <description>${escapeXml(issue.description || 'No description provided')}</description>
  <status>${escapeXml(issue.state?.name || 'Unknown')}</status>
  <priority>${issue.priority}</priority> <!-- Assuming priority is safe or numerical -->
  <url>${escapeXml(issue.url)}</url>
</issue_details>
`;

  // Fetch/format comments - Assuming issue object might have comments attached
  // Ensure the caller of startClaudeSession provides an issue object with comments if needed.
  const linearComments = formatLinearComments(issue.comments);

  const instructions = `
<instructions>
You are an AI assistant assigned to work on the Linear issue detailed above.
Analyze the issue details and any existing comments.
Your first task is to formulate and provide your initial analysis and plan as if you were writing your *first comment* on the Linear issue. Structure your response clearly.

IMPORTANT:
- When creating branches, pull requests, or interacting with git, always use EXACTLY this branch name: "${escapeXml(issue.identifier.toLowerCase())}". Do not use any prefixes or other modifications.
- If you need clarification or encounter issues, state them clearly in your response.
- Once the code changes are ready and have been approved by the user, you may use the 'gh' command-line tool to create a new pull request or update an existing one for the branch "${escapeXml(issue.identifier.toLowerCase())}".
</instructions>
`;

  return `<prompt>${issueDetails}${linearComments}${instructions}</prompt>`;
}

/**
 * Start a Claude session for an issue
 */
async function startClaudeSession(issue, workspacePath) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Starting Claude session for issue ${issue.identifier}...`);

      // Prepare initial prompt using XML structure
      const initialPrompt = buildInitialPrompt(issue);
      const historyPath = path.join(workspacePath, 'conversation-history.jsonl');
      if (!fs.existsSync(historyPath)) {
        fs.writeFileSync(historyPath, '');
      }

      console.log(`Spawning Claude with command: ${process.env.CLAUDE_PATH} ${CLAUDE_ARGS.join(' ')}`);
      console.log(`Using spawn options: ${JSON.stringify({
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe']
      })}`);
      const claudeProcess = spawn(process.env.CLAUDE_PATH, CLAUDE_ARGS, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe']
      });
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
      let firstResponsePosted = false; // Flag for first response
      let lastResponsePosted = false; // Flag for final response
      let finalCost = null; // Variable to store cost
      let finalDuration = null; // Variable to store duration

      // Set up JSON stream handlers
      console.log(`=== Setting up JSON stream handlers for Claude process ${claudeProcess.pid} ===`);

      claudeProcess.stdout.on('data', (data) => {
        const output = data.toString().trim();
        lastLine = output; // Store the raw trimmed output as the last line seen
        lastLineTimestamp = Date.now();

        if (!output.startsWith('{') || !output.endsWith('}')) {
          if (output.length > 0) {
            console.log(`[CLAUDE RAW - ${issue.identifier}] Skipped non-JSON line: ${output.substring(0, 100)}...`);
          }
          return;
        }

        try {
          const jsonResponse = JSON.parse(output);

          // Append the stringified JSON object to history, ensuring a single newline at the end
          try {
            const compactJsonString = JSON.stringify(jsonResponse);
            fs.appendFileSync(historyPath, compactJsonString + '\n');
          } catch (err) {
            console.error(`Failed to update conversation history (${historyPath}): ${err.message}`);
          }

          // --- Process the jsonResponse --- 
          // (Existing logic for handling assistant/system messages)
          if (jsonResponse.role === 'assistant' && jsonResponse.content) {
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

            if (currentResponseText.trim().length > 0) {
              lastAssistantResponseText = currentResponseText; // Always update last response
              claudeProcess.lastAssistantResponseText = lastAssistantResponseText; // Store on process object

              // Post the FIRST complete response immediately
              if (!firstResponsePosted) {
                console.log(`Posting FIRST assistant response to Linear...`);
                postResponseToLinear(issue.id, lastAssistantResponseText) // Post without cost info
                  .then(() => {
                    console.log(`Successfully posted FIRST response to Linear for issue ${issue.id}`);
                    firstResponsePosted = true; // Mark first as posted
                  })
                  .catch(err => console.error(`Failed to post FIRST response: ${err.message}`));
              }
            }
          }

          // If this is the final cost message, store cost and duration
          if (jsonResponse.role === 'system' && jsonResponse.cost_usd) {
            console.log(`Claude response completed - Cost: $${jsonResponse.cost_usd.toFixed(2)}, Duration: ${jsonResponse.duration_ms}ms`);
            finalCost = jsonResponse.cost_usd; // Store cost locally for potential immediate use
            finalDuration = jsonResponse.duration_ms; // Store duration locally
            claudeProcess.finalCost = finalCost; // Store on process object
            claudeProcess.finalDuration = finalDuration; // Store on process object
          }
          // --- End of processing jsonResponse ---

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

        // Store exit code on the process object for the linearAgent handler
        claudeProcess.exitCode = code;

        if (code !== 0) {
          // Process exited with an error. Post the stderr content IF no response was ever posted.
          console.error(`Claude process exited with error code ${code}. Stderr will be posted by linearAgent if needed.`);
          claudeProcess.stderrContent = stderr; // Store stderr for potential posting by linearAgent
          // We don't reject here anymore, let the exit handler in linearAgent decide
        } else {
          console.log(`Claude process exited successfully. Final comment will be posted by linearAgent.`);
        }

        // REMOVED: Posting logic is moved to linearAgent.js exit handler
        // if (code === 0) {
        //   // ... removed posting logic ...
        // } else {
        //   // ... removed error posting logic ...
        // }

        // We don't resolve or reject here anymore. The 'exit' event in linearAgent handles the final state.
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
      const issue = claudeProcess.issue; // Get the issue object passed during startClaudeSession

      // Build the prompt using XML structure
      console.log(`Building updated prompt with conversation history and comments...`);

      // Basic XML escaping function
      const escapeXml = (unsafe) => unsafe
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');

      // Re-create issue details and comments sections
      const issueDetails = `
<issue_details>
  <identifier>${escapeXml(issue.identifier)}</identifier>
  <title>${escapeXml(issue.title)}</title>
  <description>${escapeXml(issue.description || 'No description provided')}</description>
  <status>${escapeXml(issue.state?.name || 'Unknown')}</status>
  <priority>${issue.priority}</priority>
  <url>${escapeXml(issue.url)}</url>
</issue_details>
`;
      // Fetch/format comments EVERY time for subsequent prompts
      // Ensure issue object passed to startClaudeSession contains up-to-date comments
      const linearComments = formatLinearComments(issue.comments);

      // Process and append cleaned history
      let historySection = '<conversation_history>\n';
      let historyTokens = 0;
      if (fs.existsSync(historyPath)) {
        try {
          const historyContent = fs.readFileSync(historyPath, 'utf8');
          const lines = historyContent.trim().split('\n');

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith('{') || !trimmedLine.endsWith('}')) {
              continue; // Skip non-JSON lines (like input markers)
            }
            try {
              const jsonEntry = JSON.parse(trimmedLine);
              // Clean the entry (remove metadata)
              const cleanedEntry = { ...jsonEntry };
              delete cleanedEntry.id;
              delete cleanedEntry.model;
              delete cleanedEntry.stop_reason;
              delete cleanedEntry.stop_sequence;
              delete cleanedEntry.usage;
              if (cleanedEntry.role === 'user' && Array.isArray(cleanedEntry.content)) {
                 cleanedEntry.content = cleanedEntry.content.map(item => {
                  if (item.type === 'tool_result') {
                    const cleanedItem = { ...item };
                    delete cleanedItem.usage; // Remove usage if nested
                    return cleanedItem;
                  }
                  return item;
                });
              }

              const cleanedLine = JSON.stringify(cleanedEntry);
              historySection += cleanedLine + '\n';
              historyTokens += Math.ceil(cleanedLine.length / 4);
            } catch (jsonErr) {
              console.warn(`Skipping invalid JSON line in history: ${jsonErr.message}`);
            }
          }
          console.log(`Appended cleaned history (${lines.length} entries, estimated ${historyTokens} tokens)`);
        } catch (err) {
          console.error(`Failed to read or process conversation history: ${err.message}`);
        }
      }
      historySection += '</conversation_history>\n';

      // New input section
      const newInputSection = `<new_input>${escapeXml(input)}</new_input>\n`;

      // Instructions section (can be simpler for subsequent turns)
      const instructions = `
<instructions>
Continue working on the Linear issue based on the conversation history and the new input provided above.
Use the provided tools and context. Remember the branch name convention: "${escapeXml(issue.identifier.toLowerCase())}".
If the task is complete and approved, use the 'gh' tool to manage the pull request.
</instructions>
`;

      // Combine all parts into the full prompt
      const fullPrompt = `<prompt>${issueDetails}${linearComments}${historySection}${newInputSection}${instructions}</prompt>`;

      // Log new input marker to history file
      try {
        fs.appendFileSync(historyPath, `\n[${new Date().toISOString()}] --- New Input Start --- \n${input}\n[${new Date().toISOString()}] --- New Input End --- \n`);
      } catch (err) {
        console.error(`Failed to write new input marker to history: ${err.message}`);
      }

      // Start a new Claude process with the new prompt via stdin
      console.log(`Starting new Claude process with updated prompt via stdin...`);

      const newClaudeProcess = spawn(process.env.CLAUDE_PATH, CLAUDE_ARGS, {
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Set up basic info for the new process
      newClaudeProcess.issue = issue; // Pass the full issue object
      newClaudeProcess.historyPath = historyPath;

      newClaudeProcess.on('error', (err) => {
        console.error(`\n[NEW CLAUDE SPAWN ERROR] ${err.message}`);
        reject(err);
      });

      // Write the full prompt to the new process's stdin
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
      // Resolve with the new process. Caller needs to handle its events.
      // NOTE: Complex event handlers (first/last post, cost tracking) from startClaudeSession are NOT re-attached here.
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
async function postResponseToLinear(issueId, response, costUsd = null, durationMs = null) { // Removed historyPath parameter
  try {
    const { createComment } = require('./linearAgent'); // Keep require inside if it's for lazy loading/circular dependency avoidance

    console.log(`\n===== Posting Response to Linear for issue ${issueId} =====`);
    console.log(`Response length: ${response.length} characters`);
    console.log(`First 100 chars: ${response.substring(0, 100)}...`);
    console.log(`================================================\n`);

    // Format the response for Linear
    let formattedResponse = response;

    // Append cost information IF PROVIDED (for the specific run, not total)
    if (costUsd !== null && durationMs !== null) {
      formattedResponse += `\n\n---`;
      formattedResponse += `\n*Last run cost: $${costUsd.toFixed(2)}, Duration: ${durationMs / 1000}s*`;
      // Total cost is now handled ONLY in the exit handler of linearAgent.js
    }

    // Create a comment on the issue
    console.log(`Posting response to Linear issue ${issueId}...`);
    const success = await createComment(issueId, formattedResponse);

    if (success) {
      console.log(`✅ Successfully posted response to Linear issue ${issueId}`);
    } else {
      console.error(`❌ Failed to post response to Linear issue ${issueId}`);
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