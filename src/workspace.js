const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');

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
 * Create a workspace for a Linear issue
 */
async function createWorkspace(issue) {
  const baseDir = process.env.WORKSPACE_BASE_DIR;
  
  // Generate a suitable directory name from the issue identifier
  const workspaceName = issueToWorkspaceName(issue);
  const workspacePath = path.join(baseDir, workspaceName);
  
  try {
    // Check if workspace already exists
    if (await fs.pathExists(workspacePath)) {
      console.log(`Workspace for issue ${issue.identifier} already exists at ${workspacePath}`);
      return workspacePath;
    }
    
    // Create the workspace directory
    await fs.ensureDir(workspacePath);
    console.log(`Created workspace for issue ${issue.identifier} at ${workspacePath}`);
    
    // Clone the repository into the workspace
    await cloneRepo(workspacePath);
    
    // Create a branch for the issue
    await createBranch(workspacePath, workspaceName);
    
    return workspacePath;
  } catch (error) {
    console.error(`Failed to create workspace for issue ${issue.identifier}:`, error);
    throw error;
  }
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

/**
 * Convert a Linear issue to a workspace name
 */
function issueToWorkspaceName(issue) {
  // Convert something like "CEE-123" to "cee-123"
  return issue.identifier.toLowerCase();
}

/**
 * Create a Git worktree for the workspace
 */
async function cloneRepo(workspacePath) {
  return new Promise((resolve, reject) => {
    // Get the repository root
    const currentDir = process.cwd();
    
    // First check if we're in a git repository
    const checkGit = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd: currentDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let repoRoot = '';
    checkGit.stdout.on('data', (data) => {
      repoRoot += data.toString().trim();
    });
    
    checkGit.on('close', (code) => {
      if (code !== 0 || !repoRoot) {
        console.log('Not in a git repository, creating simple workspace instead');
        // If not in a git repo, just create an empty workspace
        fs.ensureDirSync(workspacePath);
        resolve();
        return;
      }
      
      const workspaceName = path.basename(workspacePath);
      console.log(`Creating git worktree from ${repoRoot} at ${workspacePath}`);
      
      // Create worktree
      const git = spawn('git', ['worktree', 'add', workspacePath, 'main', '-b', workspaceName], {
        cwd: repoRoot,
        stdio: 'inherit'
      });
      
      git.on('close', (code) => {
        if (code === 0) {
          console.log(`Successfully created git worktree at ${workspacePath}`);
          resolve();
        } else {
          console.log(`Git worktree creation failed with code ${code}, creating simple workspace instead`);
          // Even if worktree creation fails, proceed with an empty workspace
          fs.ensureDirSync(workspacePath);
          resolve();
        }
      });
    });
  });
}

/**
 * Verify that we're on the correct branch for the issue
 * (branch is already created by the worktree command)
 */
async function createBranch(workspacePath, branchName) {
  return new Promise((resolve) => {
    // First check if git is available in this workspace
    const checkGit = spawn('git', ['status'], {
      cwd: workspacePath,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    checkGit.on('close', (code) => {
      if (code !== 0) {
        console.log(`Git not available in workspace ${workspacePath}, skipping branch verification`);
        // Resolve anyway, not fatal if we can't verify the branch
        resolve();
        return;
      }
      
      // Git is available, just verify the branch
      const git = spawn('git', ['branch', '--show-current'], {
        cwd: workspacePath,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let currentBranch = '';
      git.stdout.on('data', (data) => {
        currentBranch += data.toString().trim();
      });
      
      git.on('close', (code) => {
        if (code === 0) {
          if (currentBranch === branchName) {
            console.log(`Confirmed workspace ${workspacePath} is on branch ${branchName}`);
          } else {
            console.log(`Workspace ${workspacePath} is on branch ${currentBranch}, expected ${branchName}`);
          }
        } else {
          console.log(`Failed to verify branch in workspace ${workspacePath}`);
        }
        resolve();
      });
    });
  });
}

/**
 * Clean up a worktree
 */
async function cleanupWorktree(workspacePath) {
  return new Promise((resolve) => {
    // Get the repository root
    const currentDir = process.cwd();
    
    // First check if we're in a git repository
    const checkGit = spawn('git', ['rev-parse', '--show-toplevel'], {
      cwd: currentDir,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let repoRoot = '';
    checkGit.stdout.on('data', (data) => {
      repoRoot += data.toString().trim();
    });
    
    checkGit.on('close', (code) => {
      if (code !== 0 || !repoRoot) {
        console.log('Not in a git repository, cannot clean up worktree');
        resolve();
        return;
      }
      
      // Remove the worktree
      console.log(`Removing git worktree at ${workspacePath}`);
      const git = spawn('git', ['worktree', 'remove', '--force', workspacePath], {
        cwd: repoRoot,
        stdio: 'inherit'
      });
      
      git.on('close', (code) => {
        if (code === 0) {
          console.log(`Successfully removed git worktree at ${workspacePath}`);
        } else {
          console.log(`Failed to remove git worktree at ${workspacePath}, code ${code}`);
        }
        resolve();
      });
    });
  });
}

/**
 * Clean up all worktrees in the workspace directory
 */
async function cleanupAllWorktrees() {
  const baseDir = process.env.WORKSPACE_BASE_DIR;
  
  try {
    // Get all workspace directories
    const workspaces = await fs.readdir(baseDir);
    
    // Clean up each worktree
    for (const workspace of workspaces) {
      const workspacePath = path.join(baseDir, workspace);
      const stats = await fs.stat(workspacePath);
      
      if (stats.isDirectory()) {
        await cleanupWorktree(workspacePath);
      }
    }
    
    console.log('All worktrees cleaned up');
  } catch (error) {
    console.error('Failed to clean up worktrees:', error);
  }
}

module.exports = {
  setupWorkspaceBaseDir,
  createWorkspace,
  getWorkspaceForIssue,
  cleanupWorktree,
  cleanupAllWorktrees
};