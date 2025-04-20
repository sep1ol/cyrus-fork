const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os'); // Add os module requirement

/**
 * Create workspace directory structure
 */
async function setupWorkspaceBaseDir() {
  const baseDir = process.env.WORKSPACE_BASE_DIR;

  try {
    // Ensure the base directory exists
    await fs.ensureDir(baseDir);
    console.log(`Workspace base directory ready: ${baseDir}`);
    return baseDir;
  } catch (error) {
    console.error('Failed to setup workspace directory:', error);
    throw error;
  }
}

/**
 * Convert a Linear issue to a workspace name
 */
function issueToWorkspaceName(issue) {
  // Convert something like "CEE-123" to "cee-123"
  return issue.identifier.toLowerCase();
}

/**
 * Get the workspace directory for an issue
 */
async function getWorkspaceForIssue(issue) {
  const baseDir = process.env.WORKSPACE_BASE_DIR;
  const workspaceName = issueToWorkspaceName(issue);
  const workspacePath = path.join(baseDir, workspaceName);

  if (await fs.pathExists(workspacePath)) {
    return workspacePath;
  }

  return null;
}

// Helper to get repo root
async function getRepoRoot() {
    return new Promise((resolve) => {
        const checkGit = spawn('git', ['rev-parse', '--show-toplevel'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let repoRoot = '';
        let stderr = '';
        checkGit.stdout.on('data', (data) => repoRoot += data.toString().trim());
        checkGit.stderr.on('data', (data) => stderr += data.toString());
        checkGit.on('close', (code) => {
            if (code === 0 && repoRoot) {
                resolve(repoRoot);
            } else {
                console.log('Could not determine git repository root.', stderr.trim());
                resolve(null);
            }
        });
        // Corrected indentation:
        checkGit.on('error', (err) => {
            console.log('Error checking for git repository root:', err.message);
            resolve(null);
        });
    });
}

// Helper function to execute the script
async function executeSetupScript(workspacePath, scriptPath) {
  return new Promise((resolve, reject) => {
    const scriptProcess = spawn('bash', [path.basename(scriptPath)], { // Use basename as script might not be executable directly by path
      cwd: workspacePath,
      stdio: 'pipe' // Capture output/errors
    });

    let scriptStdout = '';
    let scriptStderr = '';

    scriptProcess.stdout.on('data', (data) => {
      const output = data.toString();
      scriptStdout += output;
      console.log(`[Setup Script - ${path.basename(workspacePath)}] stdout: ${output.trim()}`);
    });

    scriptProcess.stderr.on('data', (data) => {
      const errorOutput = data.toString();
      scriptStderr += errorOutput;
      console.error(`[Setup Script - ${path.basename(workspacePath)}] stderr: ${errorOutput.trim()}`);
    });

    scriptProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`Setup script in ${workspacePath} finished successfully.`);
        resolve({ stdout: scriptStdout, stderr: scriptStderr });
      } else {
        console.error(`Setup script in ${workspacePath} failed with code ${code}.`);
        reject(new Error(`Setup script failed with code ${code}\nStderr: ${scriptStderr}`));
      }
    });

    scriptProcess.on('error', (err) => {
      console.error(`Failed to start setup script in ${workspacePath}: ${err.message}`);
      reject(err);
    });
  });
}

// Helper function to run the setup script if it exists
async function runSetupScriptIfNeeded(workspacePath) {
  const setupScriptPath = path.join(workspacePath, 'secretagentsetup.sh'); // Removed leading dot
  try {
    if (await fs.pathExists(setupScriptPath)) {
      console.log(`Found setup script at ${setupScriptPath}. Executing...`);
      await executeSetupScript(workspacePath, setupScriptPath);
    } else {
      console.log(`No setup script (secretagentsetup.sh) found in ${workspacePath}.`); // Updated log message
    }
  } catch (error) {
    console.error(`Error checking for or running setup script in ${workspacePath}:`, error);
    // Decide if this error should prevent workspace creation/usage
    // For now, log it and continue.
  }
}

// Helper function to verify branch and run setup script
async function verifyBranchAndRunSetup(workspacePath, expectedBranchName) {
  return new Promise(async (resolve) => { // Make outer function async
    // Check if git is available in the workspace directory
    const checkGit = spawn('git', ['status'], { cwd: workspacePath, stdio: 'ignore' });
    checkGit.on('close', async (code) => { // Make inner handler async
      let branchVerified = false;
      if (code !== 0) {
        console.log(`Git not available or ${workspacePath} is not a git repository. Skipping branch verification.`);
        // Still try to run setup script even if not a git repo
        await runSetupScriptIfNeeded(workspacePath);
        resolve();
        return;
      }

      // Git is available, verify the branch
      const gitBranch = spawn('git', ['branch', '--show-current'], { cwd: workspacePath, stdio: ['ignore', 'pipe', 'pipe'] });
      let currentBranch = '';
      gitBranch.stdout.on('data', (data) => currentBranch += data.toString().trim());
      gitBranch.on('close', async (branchCode) => { // Make inner handler async
        if (branchCode === 0) {
          if (currentBranch === expectedBranchName) {
            console.log(`Workspace ${workspacePath} is correctly on branch ${expectedBranchName}`);
            branchVerified = true;
          } else {
            console.log(`Workspace ${workspacePath} is on branch ${currentBranch}, attempting to switch to ${expectedBranchName}`);
            const gitCheckout = spawn('git', ['checkout', expectedBranchName], { cwd: workspacePath, stdio: 'pipe' });
            let checkoutStderr = '';
            gitCheckout.stderr.on('data', (data) => checkoutStderr += data.toString());
            gitCheckout.on('close', (checkoutCode) => {
              if (checkoutCode === 0) {
                console.log(`Successfully checked out branch ${expectedBranchName}`);
                branchVerified = true;
              } else {
                console.warn(`Failed to checkout branch ${expectedBranchName} (code ${checkoutCode}): ${checkoutStderr.trim()}`);
                // Proceed anyway, maybe the setup script can still run
              }
              // Continue to setup script check after checkout attempt
              runSetupScriptIfNeeded(workspacePath).then(resolve); // Run script then resolve outer promise
            });
            gitCheckout.on('error', (err) => { // Make error handler async
              console.error(`Error spawning git checkout: ${err.message}`);
              runSetupScriptIfNeeded(workspacePath).then(resolve); // Still try to run script then resolve
            });
            return; // Don't run setup script yet if checkout is attempted
          }
        } else {
          console.log(`Failed to get current branch in workspace ${workspacePath}.`);
          // Continue to setup script check even if branch check fails
        }
        // If branch was already correct or check failed, run setup script now
        await runSetupScriptIfNeeded(workspacePath);
        resolve();
      });
      gitBranch.on('error', async (err) => { // Make error handler async
        console.error(`Error spawning git branch: ${err.message}`);
        await runSetupScriptIfNeeded(workspacePath); // Still try to run script
        resolve();
      });
    });
    checkGit.on('error', (err) => {
      console.error(`Error spawning git status: ${err.message}. Cannot verify workspace.`);
      // Still try to run setup script? Maybe not if git status fails.
      // Let's resolve without running the script if git status errors.
      resolve();
    });
  });
}

// Helper function to create the git worktree or simple directory
async function createGitWorktree(workspacePath, branchName) {
  return new Promise(async (resolve, reject) => { // Make outer function async
    const repoRoot = await getRepoRoot(); // Helper function needed
    if (!repoRoot) {
      console.log('Not in a git repository, creating simple workspace directory.');
      await fs.ensureDir(workspacePath);
      resolve();
      return;
    }

    console.log(`Attempting to create/attach git worktree for branch ${branchName} at ${workspacePath}`);

    // Try creating worktree with a new branch first, tracking origin/main
    const addWithNewBranch = spawn('git', ['worktree', 'add', '--track', '-b', branchName, workspacePath, 'origin/main'], {
      cwd: repoRoot,
      stdio: 'pipe' // Capture output/errors
    });

    let addWithNewBranchStderr = '';
    addWithNewBranch.stderr.on('data', (data) => addWithNewBranchStderr += data.toString());

    addWithNewBranch.on('close', async (code) => { // Make inner handler async
      if (code === 0) {
        console.log(`Successfully created new worktree and branch ${branchName} at ${workspacePath}`);
        resolve();
      } else {
        console.log(`Failed to create worktree with new branch (code ${code}): ${addWithNewBranchStderr.trim()}.`);
        // Check if the failure is because the branch already exists
        const branchExistsError = addWithNewBranchStderr.includes(`branch '${branchName}' already exists`) || addWithNewBranchStderr.includes(`already exists`); // Git error messages can vary slightly

        if (branchExistsError) {
          console.log(`Branch ${branchName} already exists or path is occupied. Attempting to attach worktree to existing branch.`);
          // Try adding worktree attached to the existing branch
          const addExistingBranch = spawn('git', ['worktree', 'add', workspacePath, branchName], {
            cwd: repoRoot,
            stdio: 'pipe'
          });
          let addExistingBranchStderr = '';
          addExistingBranch.stderr.on('data', (data) => addExistingBranchStderr += data.toString());

          addExistingBranch.on('close', async (codeExisting) => { // Make inner handler async
            if (codeExisting === 0) {
              console.log(`Successfully attached worktree to existing branch ${branchName} at ${workspacePath}`);
              resolve();
            } else {
              // Check if failure is because worktree path already exists (maybe from a previous failed attempt or manual setup)
              if (addExistingBranchStderr.includes('already exists') && addExistingBranchStderr.includes(workspacePath)) {
                console.warn(`Worktree path ${workspacePath} already exists but might not be properly linked. Assuming it's usable.`);
                resolve(); // Assume usable if path exists
              } else {
                console.error(`Failed to attach worktree to existing branch ${branchName} (code ${codeExisting}): ${addExistingBranchStderr.trim()}. Creating simple directory instead.`);
                await fs.ensureDir(workspacePath); // Fallback
                resolve(); // Resolve even on fallback
              }
            }
          });
          addExistingBranch.on('error', async (err) => { // Make error handler async
            console.error(`Error spawning git worktree add (existing branch): ${err.message}. Creating simple directory instead.`);
            await fs.ensureDir(workspacePath); // Fallback
            resolve(); // Resolve even on fallback
          });
        } else {
          // Different error, fallback to simple directory
          console.error(`Failed to create worktree for unknown reason. Creating simple directory instead.`);
          await fs.ensureDir(workspacePath); // Fallback
          resolve(); // Resolve even on fallback
        }
      }
    });

    addWithNewBranch.on('error', async (err) => { // Make error handler async
      console.error(`Error spawning git worktree add (new branch): ${err.message}. Creating simple directory instead.`);
      await fs.ensureDir(workspacePath); // Fallback
      resolve(); // Resolve even on fallback
    });
  });
}

/**
 * Create a workspace for a Linear issue
 */
async function createWorkspace(issue) {
  const baseDir = process.env.WORKSPACE_BASE_DIR;
  const workspaceName = issueToWorkspaceName(issue); // This is also the branch name
  const workspacePath = path.join(baseDir, workspaceName);

  try {
    // Ensure the parent directory exists (e.g., WORKSPACE_BASE_DIR)
    await fs.ensureDir(path.dirname(workspacePath));

    // Check if workspace directory already exists
    if (await fs.pathExists(workspacePath)) {
      console.log(`Workspace directory ${workspacePath} already exists. Verifying branch and running setup script...`);
      // It exists, just ensure it's set up correctly (branch, setup script)
      await verifyBranchAndRunSetup(workspacePath, workspaceName);
    } else {
      console.log(`Workspace directory ${workspacePath} does not exist. Creating worktree/directory...`);
      // Create the worktree (or simple dir if git fails)
      await createGitWorktree(workspacePath, workspaceName);
      // Now verify branch (should be correct if newly created by worktree) and run setup script
      console.log(`Worktree/directory created. Verifying branch and running setup script...`);
      await verifyBranchAndRunSetup(workspacePath, workspaceName); // verify also runs the setup script
    }
    console.log(`Workspace setup complete for ${issue.identifier} at ${workspacePath}`);
    return workspacePath;
  } catch (error) {
    console.error(`Failed to create or verify workspace for issue ${issue.identifier}:`, error);
    // If creation failed, maybe try to clean up a potentially partial workspace?
    // For now, just rethrow.
    throw error;
  }
}

/**
 * Clean up a worktree
 */
async function cleanupWorktree(workspacePath) {
  return new Promise(async (resolve) => { // Make outer function async
    const repoRoot = await getRepoRoot();
    if (!repoRoot) {
      console.log(`Not in a git repository, attempting simple directory removal for ${workspacePath}`);
      try {
        await fs.remove(workspacePath);
        console.log(`Removed directory ${workspacePath}`);
      } catch (err) {
        console.error(`Failed to remove directory ${workspacePath}: ${err.message}`);
      }
      resolve();
      return;
    }

    // It's a git repo, attempt worktree removal
    console.log(`Attempting to remove git worktree at ${workspacePath}`);
    const gitRemove = spawn('git', ['worktree', 'remove', '--force', workspacePath], {
      cwd: repoRoot,
      stdio: 'pipe'
    });

    let removeStderr = '';
    gitRemove.stderr.on('data', (data) => removeStderr += data.toString());

    gitRemove.on('close', async (code) => { // Make inner handler async
      if (code === 0) {
        console.log(`Successfully removed git worktree at ${workspacePath}`);
      } else {
        console.log(`Failed to remove git worktree at ${workspacePath} (code ${code}): ${removeStderr.trim()}. Attempting simple directory removal.`);
        // Fallback to simple directory removal if worktree command fails
        try {
          await fs.remove(workspacePath);
          console.log(`Removed directory ${workspacePath} as fallback.`);
        } catch (err) {
          console.error(`Fallback directory removal failed for ${workspacePath}: ${err.message}`);
        }
      }
      resolve();
    });

    gitRemove.on('error', async (err) => { // Make error handler async
      console.error(`Error spawning git worktree remove for ${workspacePath}: ${err.message}. Attempting simple directory removal.`);
      try {
        await fs.remove(workspacePath);
        console.log(`Removed directory ${workspacePath} as fallback.`);
      } catch (fsErr) {
        console.error(`Fallback directory removal failed for ${workspacePath}: ${fsErr.message}`);
      }
      resolve();
    });
  });
}

/**
 * Clean up all worktrees in the workspace directory
 */
async function cleanupAllWorktrees() {
  const baseDir = process.env.WORKSPACE_BASE_DIR;

  try {
    if (!await fs.pathExists(baseDir)) {
      console.log(`Workspace base directory ${baseDir} does not exist, nothing to clean up.`);
      return;
    }
    // Get all entries in the base directory
    const entries = await fs.readdir(baseDir);

    // Clean up each entry (assuming they are workspaces)
    for (const entryName of entries) {
      const workspacePath = path.join(baseDir, entryName);
      try {
        const stats = await fs.stat(workspacePath);
        if (stats.isDirectory()) {
          // Check if it looks like a worktree (contains .git file) or just a directory
          const gitFilePath = path.join(workspacePath, '.git');
          if (await fs.pathExists(gitFilePath)) {
            const gitFileContent = await fs.readFile(gitFilePath, 'utf8');
            if (gitFileContent.includes('gitdir:')) {
              console.log(`Cleaning up worktree: ${workspacePath}`);
              await cleanupWorktree(workspacePath); // Use the specific worktree cleanup
            } else {
              console.log(`Cleaning up directory (not a linked worktree): ${workspacePath}`);
              await fs.remove(workspacePath);
            }
          } else {
            console.log(`Cleaning up directory (no .git file): ${workspacePath}`);
            await fs.remove(workspacePath);
          }
        }
      } catch (statError) {
        // Ignore errors for entries that might have been removed concurrently or aren't directories
        console.warn(`Could not process entry ${workspacePath} during cleanup: ${statError.message}`);
      }
    }

    console.log('Workspace cleanup process finished.');
  } catch (error) {
    console.error('Failed during workspace cleanup:', error);
  }
}

/**
 * Get the absolute path to the conversation history file for a given workspace.
 */
function getHistoryFilePath(workspacePath) {
  const homeDir = os.homedir();
  const workspaceFolderName = path.basename(workspacePath);
  const historyDir = path.join(
    homeDir,
    '.linearsecretagent',
    workspaceFolderName
  );
  // Ensure the directory exists before returning the path
  fs.ensureDirSync(historyDir);
  return path.join(historyDir, 'conversation-history.jsonl');
}

module.exports = {
  setupWorkspaceBaseDir,
  createWorkspace,
  getWorkspaceForIssue,
  cleanupWorktree, // Keep exporting these for potential direct use or testing
  cleanupAllWorktrees,
  getHistoryFilePath, // Export the new function
};