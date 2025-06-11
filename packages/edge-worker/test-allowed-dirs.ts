import { ClaudeRunner } from '@cyrus/claude-runner'
import { join } from 'path'
import { homedir } from 'os'

// Test that the allowed directories are passed correctly
const testDir = join(homedir(), '.cyrus', 'TEST-123', 'attachments')

const runner = new ClaudeRunner({
  claudePath: '/usr/local/bin/claude',
  workingDirectory: '/tmp/test',
  allowedTools: ['Read', 'Write'],
  allowedDirectories: [testDir]
})

// Check the command that would be generated
const buildArgs = runner['buildArgs']()
console.log('Generated args:', buildArgs)

// Should include: --add-dir /Users/<user>/.cyrus/TEST-123/attachments