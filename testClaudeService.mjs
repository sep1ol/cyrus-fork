import { FileSystem } from './src/utils/FileSystem.mjs';
import { ProcessManager } from './src/utils/ProcessManager.mjs';
import { NodeClaudeService } from './src/adapters/NodeClaudeService.mjs';
import { Issue } from './src/core/Issue.mjs';
import { Workspace } from './src/core/Workspace.mjs';
import path from 'path';
import fs from 'fs';

// Create a mock template file
const templatePath = path.join(process.cwd(), 'prompt-template-test.txt');
fs.writeFileSync(templatePath, 'Test template {{issue_details}} {{linear_comments}} {{branch_name}} {{process_history}} {{new_input}}');

// Create mock issue service
const mockIssueService = {
  createComment: async (issueId, comment) => {
    console.log(`Would post comment to issue ${issueId}: ${comment}`);
    return true;
  }
};

// Create test issue
const testIssue = new Issue({
  id: 'test-123',
  identifier: 'TEST-123',
  title: 'Test Issue',
  description: 'This is a test issue',
  comments: []
});

// Create test workspace
const testWorkspace = new Workspace({
  id: 'workspace-123',
  path: process.cwd(),
  issue: testIssue
});

// Test function
async function testClaudeService() {
  try {
    console.log('Creating NodeClaudeService instance...');
    const claudeService = new NodeClaudeService(
      'echo', // Mock executable that just echoes input
      templatePath,
      mockIssueService
    );
    
    console.log('Initializing prompt template...');
    // Wait for prompt to initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Building initial prompt...');
    const initialPrompt = await claudeService.buildInitialPrompt(testIssue);
    console.log('Initial prompt:', initialPrompt);
    
    console.log('Test completed successfully!');
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    // Clean up
    fs.unlinkSync(templatePath);
  }
}

testClaudeService();