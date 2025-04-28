const { spawn } = require('child_process')
const fs = require('fs-extra')
const path = require('path')
const readline = require('readline') // Import readline
const os = require('os') // Import os module
const { getHistoryFilePath } = require('./workspace'); // Import the shared function

// Ensure --print is included for non-interactive mode with stream-json
/*
Bash \
Edit \
Replace \
FileWriteTool \
FileEditTool
*/
const CLAUDE_ARGS = [
  '--print',
  '--output-format',
  'stream-json',
  '--allowedTools',
  'Bash',
  'Edit',
  'Replace',
  'FileWriteTool',
  'FileEditTool',
]

// --- Prompt Template Loading ---
let promptTemplate = '';
try {
  const templatePath = process.env.PROMPT_TEMPLATE_PATH;
  if (!templatePath) {
    throw new Error('PROMPT_TEMPLATE_PATH environment variable is not set.');
  }
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Prompt template file not found at: ${templatePath}`);
  }
  promptTemplate = fs.readFileSync(templatePath, 'utf-8');
  console.log(`Successfully loaded prompt template from: ${templatePath}`);
} catch (error) {
  console.error(`Error loading prompt template: ${error.message}`);
  process.exit(1); // Exit if template cannot be loaded
}
// --- End Prompt Template Loading ---

/**
 * Helper to format comments for the prompt
 */
function formatLinearComments(comments) {
  if (!comments || !comments.nodes || comments.nodes.length === 0) {
    return '<linear_comments>No comments yet.</linear_comments>'
  }
  let commentString = '<linear_comments>\n'
  comments.nodes.forEach((comment) => {
    // Basic XML escaping for comment body
    const escapedBody = comment.body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
    commentString += `  <comment author="${comment.user?.name || 'Unknown'}">\n`
    commentString += `    <body>${escapedBody}</body>\n` // Use escaped body
    commentString += `  </comment>\n`
  })
  commentString += '</linear_comments>'
  return commentString
}

// Basic XML escaping function (moved outside for reuse)
const escapeXml = (unsafe) =>
  unsafe
    ? unsafe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;')
    : ''; // Return empty string if input is null or undefined

/**
 * Build the initial prompt for Claude using the loaded template
 */
function buildInitialPrompt(issue) {
  const issueDetails = `
<issue_details>
  <identifier>${escapeXml(issue.identifier)}</identifier>
  <title>${escapeXml(issue.title)}</title>
  <description>${escapeXml(
    issue.description || 'No description provided'
  )}</description>
  <status>${escapeXml(issue.state?.name || 'Unknown')}</status>
  <priority>${
    issue.priority
  }</priority> <!-- Assuming priority is safe or numerical -->
  <url>${escapeXml(issue.url)}</url>
</issue_details>
`

  const linearComments = formatLinearComments(issue.comments)
  const branchName = escapeXml(issue.identifier.toLowerCase());

  // Inject variables into the template
  let finalPrompt = promptTemplate;
  finalPrompt = finalPrompt.replace('{{issue_details}}', issueDetails);
  finalPrompt = finalPrompt.replace('{{linear_comments}}', linearComments);
  finalPrompt = finalPrompt.replace('{{branch_name}}', branchName);
  // Remove placeholders for sections not used in the initial prompt
  finalPrompt = finalPrompt.replace('{{process_history}}', '');
  finalPrompt = finalPrompt.replace('{{new_input}}', '');

  return finalPrompt;
}

/**
 * Set up the event handlers for a Claude process
 * This is shared between startClaudeSession and sendToClaudeSession
 */
function setupClaudeProcessHandlers(claudeProcess, issue, historyPath) {
  // Set up buffers to capture output
  let stderr = ''
  let lastAssistantResponseText = '' // Re-introduce to accumulate response
  let firstResponsePosted = false // Track if the first response was posted
  let lineBuffer = '' // Buffer for incomplete lines

  // Set up JSON stream handlers
  console.log(
    `=== Setting up JSON stream handlers for Claude process ${claudeProcess.pid} ===`
  )

  claudeProcess.stdout.on('data', (data) => {
    lineBuffer += data.toString() // Append data to buffer
    let lines = lineBuffer.split('\n') // Split into lines

    // Process all complete lines except the last (which might be incomplete)
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i].trim()
      if (!line) continue // Skip empty lines

      try {
        const jsonResponse = JSON.parse(line)

        // Append the stringified JSON object to history, ensuring a single newline at the end
        try {
          // Use the already compact line from jq
          fs.appendFileSync(historyPath, line + '\n')
        } catch (err) {
          console.error(
            `Failed to update conversation history (${historyPath}): ${err.message}`
          )
        }

        // Process the jsonResponse
        if (jsonResponse.role === 'assistant' && jsonResponse.content) {
          let currentResponseText = ''
          if (Array.isArray(jsonResponse.content)) {
            for (const content of jsonResponse.content) {
              if (content.type === 'text') {
                currentResponseText += content.text
              }
            }
          } else if (typeof jsonResponse.content === 'string') {
            currentResponseText = jsonResponse.content
          }

          if (currentResponseText.trim().length > 0) {
            lastAssistantResponseText = currentResponseText

            // Post the first complete response immediately
            if (!firstResponsePosted) {
              console.log(`[CLAUDE JSON - ${issue.identifier}] Posting first response to Linear.`);
              postResponseToLinear(issue.id, lastAssistantResponseText)
              firstResponsePosted = true
            }
          }
        }

        // Post the final accumulated response to Linear when the turn ends (NO cost here)
        if (jsonResponse.stop_reason === 'end_turn') {
          if (lastAssistantResponseText.trim().length > 0) {
            console.log(
              `[CLAUDE JSON - ${issue.identifier}] Detected stop_reason: end_turn. Posting final response.`
            )
            // Post the text
            postResponseToLinear(issue.id, lastAssistantResponseText)
            lastAssistantResponseText = '' // Reset for the next potential turn
          } else {
            console.log(
              `[CLAUDE JSON - ${issue.identifier}] Detected stop_reason: end_turn, but no accumulated assistant content to post.`
            )
          }
        }

        // If this is the final cost message, calculate TOTAL cost and post it separately
        if (jsonResponse.role === 'system' && jsonResponse.cost_usd) {
          console.log(
            `[CLAUDE JSON - ${issue.identifier}] Received final system cost message. Calculating total cost.`
          )
          // Log the cost of this specific chunk
           console.log(
            `Claude response chunk completed - Cost: $${jsonResponse.cost_usd.toFixed(
              2
            )}, Duration: ${jsonResponse.duration_ms / 1000}s`
          )

          // Calculate total cost from history
          let totalCost = 0
          let costCalculationMessage = ''
          try {
            if (fs.existsSync(historyPath)) {
              const historyContent = fs.readFileSync(historyPath, 'utf-8')
              const lines = historyContent.trim().split('\n')
              lines.forEach((line) => {
                try {
                  const entry = JSON.parse(line)
                  // Ensure we sum up ALL system cost messages in history
                  if (
                    entry.role === 'system' &&
                    typeof entry.cost_usd === 'number'
                  ) {
                    totalCost += entry.cost_usd
                  }
                } catch (parseError) {
                  // Ignore parse errors silently in final calculation
                }
              })
              // Add the cost from the *current* message as well, as it's not yet in the file
              totalCost += jsonResponse.cost_usd;
              costCalculationMessage = `*Cost for last run: $${jsonResponse.cost_usd.toFixed(2)}, Duration: ${jsonResponse.duration_ms / 1000}s*
*Total estimated cost for this issue: $${totalCost.toFixed(2)}*`
            } else {
              costCalculationMessage =
                '*Conversation history file not found, cannot calculate total cost.*'
            }
          } catch (costError) {
            console.error(
              `Error calculating total cost for issue ${issue.identifier}:`,
              costError
            )
            costCalculationMessage = '*Error calculating total session cost.*'
          }

          // Post the total cost message separately
          console.log(`[CLAUDE JSON - ${issue.identifier}] Posting total cost message to Linear.`);
          postResponseToLinear(issue.id, costCalculationMessage)
        }
      } catch (err) {
        console.error(
          `[CLAUDE JSON - ${issue.identifier}] Error parsing JSON line: ${err.message}`
        )
        console.error(
          `[CLAUDE JSON - ${issue.identifier}] Offending line: ${line}`
        )
      }
    }

    // Keep the last (potentially incomplete) line in the buffer
    lineBuffer = lines[lines.length - 1]
  })

  // Handle end of stream - process any remaining buffer content
  claudeProcess.stdout.on('end', () => {
    const line = lineBuffer.trim()
    if (line) {
      try {
        const jsonResponse = JSON.parse(line)
        // Process the final jsonResponse (similar logic as above, simplified for brevity)
        try {
          fs.appendFileSync(historyPath, line + '\n')
        } catch (err) {
          console.error(
            `Failed to update conversation history (${historyPath}) on end: ${err.message}`
          )
        }
        // Potentially handle final assistant/system messages if needed here
        if (jsonResponse.role === 'system' && jsonResponse.cost_usd) {
          console.log(
            `Claude response completed (on end) - Cost: $${jsonResponse.cost_usd.toFixed(
              2
            )}, Duration: ${jsonResponse.duration_ms / 1000}s`
          )
        }
      } catch (err) {
        console.error(
          `[CLAUDE JSON - ${issue.identifier}] Error parsing final JSON line: ${err.message}`
        )
        console.error(
          `[CLAUDE JSON - ${issue.identifier}] Offending final line: ${line}`
        )
      }
    }
    console.log(`Claude stdout stream ended for issue ${issue.identifier}`)
  })

  // Handle stderr output
  claudeProcess.stderr.on('data', (data) => {
    const error = data.toString()
    stderr += error

    console.error(
      `\n[CLAUDE ERROR - ${issue.identifier}] ${error.length} bytes received:`
    )
    console.error(`----------------------------------------`)
    console.error(error)
    console.error(`----------------------------------------`)
  })

  // Handle process exit
  claudeProcess.on('close', async (code) => {
    console.log(
      `Claude process for issue ${issue.identifier} exited with code ${code}`
    )

    // Store exit code on the process object for the linearAgent handler
    claudeProcess.exitCode = code

    if (code !== 0) {
      console.error(
        `Claude process exited with error code ${code}. Stderr will be posted by linearAgent if needed.`
      )
      claudeProcess.stderrContent = stderr
    } else {
      console.log(
        `Claude process exited successfully. Final comment will be posted by linearAgent.`
      )
    }
  })

  return claudeProcess
}

/**
 * Starts the *initial* Claude session for an issue.
 * Sends only the issue details and initial instructions based on the template.
 * Used when an issue is first assigned or processed.
 */
async function startClaudeSession(issue, workspacePath) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Starting Claude session for issue ${issue.identifier}...`)

      // Prepare initial prompt using the template
      const initialPrompt = buildInitialPrompt(issue)

      // Use the shared function to get the history path
      const historyPath = getHistoryFilePath(workspacePath);

      console.log(`Conversation history will be stored at: ${historyPath}`) // Log the path

      if (!fs.existsSync(historyPath)) {
        fs.writeFileSync(historyPath, '')
      }

      // Construct the command to pipe claude output through jq
      // Ensure CLAUDE_PATH and arguments are properly escaped for the shell
      const claudeCmd = `${process.env.CLAUDE_PATH} ${CLAUDE_ARGS.join(' ')}`
      const fullCommand = `${claudeCmd} | jq -c .` // Pipe output to jq

      console.log(`Spawning Claude via shell: sh -c "${fullCommand}"`)
      console.log(
        `Using spawn options: ${JSON.stringify({
          cwd: workspacePath,
          stdio: ['pipe', 'pipe', 'pipe'], // Keep stdio as pipes
          shell: true, // Use shell to interpret the pipe
        })}`
      )

      const claudeProcess = spawn(fullCommand, {
        // Spawn using the shell command
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true, // IMPORTANT: Use shell mode
      })
      claudeProcess.historyPath = historyPath // Store the correct history path

      // Handle process error (e.g., command not found, jq not found)
      claudeProcess.on('error', (err) => {
        console.error(`
[CLAUDE/JQ SPAWN ERROR] ${err.message}`)
        console.error(
          `Make sure the Claude executable and 'jq' are correctly installed and available in PATH`
        )
        reject(err)
      })

      // Write the initial prompt to stdin and close it
      try {
        claudeProcess.stdin.write(initialPrompt)
        claudeProcess.stdin.end()
        console.log(
          `Initial prompt sent via stdin to Claude/jq shell (PID: ${claudeProcess.pid}) for issue ${issue.identifier}`
        )
      } catch (stdinError) {
        console.error(
          `Failed to write prompt to Claude/jq stdin: ${stdinError.message}`
        )
        reject(stdinError)
        return // Stop further setup if stdin fails
      }

      // Set up common event handlers (now reads from jq's output)
      setupClaudeProcessHandlers(claudeProcess, issue, historyPath)

      // Store issue information
      claudeProcess.issue = issue
      claudeProcess.issue.workspace = workspacePath

      resolve(claudeProcess)
    } catch (error) {
      console.error(
        `Failed to start Claude session for issue ${issue.identifier}:`,
        error
      )
      reject(error)
    }
  })
}

/**
 * Sends subsequent input to an existing Claude session for an issue.
 * Kills the old process, starts a new one, and sends the *full* history + new input,
 * using the prompt template.
 * Used for follow-up interactions like user comments.
 */
async function sendToClaudeSession(claudeProcess, newComment) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!claudeProcess || claudeProcess.killed) {
        console.log(
          'Claude process is not running or already killed. Will start a new one.'
        )
      } else {
        console.log(
          `Terminating previous Claude process (PID: ${claudeProcess.pid})...`
        )
        claudeProcess.kill()
        await new Promise((res) => setTimeout(res, 500))
      }

      console.log(
        `Sending input to Claude process for issue ${claudeProcess.issue.identifier}...`
      )
      console.log(`Input length: ${newComment.length} characters`)

      const workspacePath = claudeProcess.issue.workspace
      // Use the shared function to get the history path (it should already be on claudeProcess, but recalculating is safer)
      const historyPath = getHistoryFilePath(workspacePath);
      const issue = claudeProcess.issue // Get the issue object passed during startClaudeSession

      // Build the prompt using the template and current context
      console.log(
        `Building updated prompt with conversation history and comments using template...`
      )

      // Re-create issue details and comments sections
      const issueDetails = `
<issue_details>
  <identifier>${escapeXml(issue.identifier)}</identifier>
  <title>${escapeXml(issue.title)}</title>
  <description>${escapeXml(
    issue.description || 'No description provided'
  )}</description>
  <status>${escapeXml(issue.state?.name || 'Unknown')}</status>
  <priority>${issue.priority}</priority>
  <url>${escapeXml(issue.url)}</url>
</issue_details>
`
      // Fetch/format comments EVERY time for subsequent prompts
      // Ensure issue object passed to startClaudeSession contains up-to-date comments
      const linearComments = formatLinearComments(issue.comments)
      const branchName = escapeXml(issue.identifier.toLowerCase());

      // Process and append cleaned history
      let historySection = '<process_history>\n'
      let historyTokens = 0
      if (fs.existsSync(historyPath)) {
        try {
          const historyContent = fs.readFileSync(historyPath, 'utf8')
          const lines = historyContent.trim().split('\n')

          for (const line of lines) {
            const trimmedLine = line.trim()
            if (!trimmedLine.startsWith('{') || !trimmedLine.endsWith('}')) {
              // Allow history markers
              if (!trimmedLine.startsWith('[')) {
                console.warn(
                  `Skipping non-JSON/non-marker line in history: ${trimmedLine.substring(
                    0,
                    50
                  )}...`
                )
              } else {
                historySection += trimmedLine + '\n' // Keep markers
              }
              continue
            }
            try {
              const jsonEntry = JSON.parse(trimmedLine)
              // Clean the entry (remove metadata)
              const cleanedEntry = { ...jsonEntry }
              delete cleanedEntry.id
              delete cleanedEntry.model
              delete cleanedEntry.stop_reason
              delete cleanedEntry.stop_sequence
              delete cleanedEntry.usage
              if (
                cleanedEntry.role === 'user' &&
                Array.isArray(cleanedEntry.content)
              ) {
                cleanedEntry.content = cleanedEntry.content.map((item) => {
                  if (item.type === 'tool_result') {
                    const cleanedItem = { ...item }
                    delete cleanedItem.usage // Remove usage if nested
                    return cleanedItem
                  }
                  return item
                })
              }

              const cleanedLine = JSON.stringify(cleanedEntry)
              historySection += cleanedLine + '\n'
              historyTokens += Math.ceil(cleanedLine.length / 4)
            } catch (jsonErr) {
              console.warn(
                `Skipping invalid JSON line in history during rebuild: ${jsonErr.message}`
              )
            }
          }
          console.log(
            `Appended cleaned history (${lines.length} entries, estimated ${historyTokens} tokens)`
          )
        } catch (err) {
          console.error(
            `Failed to read or process conversation history: ${err.message}`
          )
        }
      }
      historySection += '</process_history>\n'

      // New input section
      // Format the comment for Claude
      const commentPrompt = `
        A user has posted a new comment on the Linear issue you're working on:

        <new_comment>
        ${newComment}
        </new_comment>

        Please consider this information as you continue working on the issue.
        `
      const newInputSection = `<new_input>${escapeXml(
        commentPrompt
      )}</new_input>\n`

      // Inject variables into the template
      let fullPrompt = promptTemplate;
      fullPrompt = fullPrompt.replace('{{issue_details}}', issueDetails);
      fullPrompt = fullPrompt.replace('{{linear_comments}}', linearComments);
      fullPrompt = fullPrompt.replace('{{branch_name}}', branchName);
      fullPrompt = fullPrompt.replace('{{process_history}}', historySection);
      fullPrompt = fullPrompt.replace('{{new_input}}', newInputSection);

      // Log new input marker to history file
      try {
        fs.appendFileSync(
          historyPath,
          `\n[${new Date().toISOString()}] --- New Input Start --- \n${newComment}\n[${new Date().toISOString()}] --- New Input End --- \n`
        )
      } catch (err) {
        console.error(
          `Failed to write new input marker to history: ${err.message}`
        )
      }

      // Start a new Claude process with the new prompt via stdin, piped through jq
      console.log(
        `Starting new Claude process with updated prompt via stdin (piped through jq)...`
      )
      const claudeCmd = `${process.env.CLAUDE_PATH} ${CLAUDE_ARGS.join(' ')}`
      const fullCommand = `${claudeCmd} | jq -c .` // Pipe output to jq

      const newClaudeProcess = spawn(fullCommand, {
        // Spawn using the shell command
        cwd: workspacePath,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true, // IMPORTANT: Use shell mode
      })

      // Set up basic info for the new process
      newClaudeProcess.issue = issue // Pass the full issue object
      newClaudeProcess.historyPath = historyPath

      newClaudeProcess.on('error', (err) => {
        console.error(`\n[NEW CLAUDE/JQ SPAWN ERROR] ${err.message}`)
        console.error(
          `Make sure the Claude executable and 'jq' are correctly installed and available in PATH`
        )
        reject(err) // Reject the main promise on spawn error
      })

      // Write the full prompt to the new process's stdin
      try {
        newClaudeProcess.stdin.write(fullPrompt)
        newClaudeProcess.stdin.end()
        console.log(
          `Updated prompt sent via stdin to new Claude/jq shell (PID: ${newClaudeProcess.pid})`
        )
      } catch (stdinError) {
        console.error(
          `Failed to write prompt to new Claude/jq stdin: ${stdinError.message}`
        )
        try {
          newClaudeProcess.kill()
        } catch (killErr) {
          /* ignore kill error */
        }
        reject(stdinError) // Reject the main promise if stdin fails
        return // Exit the promise executor function
      }

      // If stdin write succeeded, set up handlers and resolve the promise
      setupClaudeProcessHandlers(newClaudeProcess, issue, historyPath)

      console.log(
        `New Claude process started with PID: ${newClaudeProcess.pid}`
      )
      resolve(newClaudeProcess) // Resolve the main promise with the new process
    } catch (error) {
      // Catch any other errors during the setup (before stdin write or after)
      console.error('Failed to send input to Claude session:', error)
      reject(error)
    }
  })
}

/**
 * Post Claude's response to Linear
 */
async function postResponseToLinear(
  issueId,
  response,
  costUsd = null,
  durationMs = null
) {
  try {
    const { createComment } = require('./linearAgent') // Keep require inside if it's for lazy loading/circular dependency avoidance

    console.log(`\n===== Posting Response to Linear for issue ${issueId} =====`)
    console.log(`Response length: ${response.length} characters`)
    console.log(`First 100 chars: ${response.substring(0, 100)}...`)
    console.log(`================================================\n`)

    // Format the response for Linear
    let formattedResponse = response

    // Append cost information IF PROVIDED (for the specific run, not total)
    if (costUsd !== null && durationMs !== null) {
      formattedResponse += `\n\n---`
      formattedResponse += `\n*Last run cost: $${costUsd.toFixed(
        2
      )}, Duration: ${durationMs / 1000}s*`
      // Total cost is now handled ONLY in the exit handler of linearAgent.js
    }

    // Create a comment on the issue
    const success = await createComment(issueId, formattedResponse)

    if (success) {
      console.log(`✅ Successfully posted response to Linear issue ${issueId}`)
    } else {
      console.error(`❌ Failed to post response to Linear issue ${issueId}`)
    }

    return success
  } catch (error) {
    console.error(`Failed to post response to Linear issue ${issueId}:`, error)
    return false
  }
}

module.exports = {
  startClaudeSession,
  sendToClaudeSession,
  postResponseToLinear,
}
