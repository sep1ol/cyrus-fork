/**
 * Claude configuration
 */
export default {
  // Default arguments for Claude CLI
  defaultArgs: [
    '--print',
    '--output-format',
    'stream-json',
    '--allowedTools',
    'Bash',
    'Edit',
    'Replace',
    'Write',
    'WebFetch'
  ],
  
  // Extended arguments for continuation mode
  getContinueArgs(newComment) {
    // For continuation, we'll pass the comment as a separate parameter
    return [
      ...this.defaultArgs,
      '--continue'
    ];
  }
};