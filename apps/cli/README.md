# cyrus-ai

AI-powered Linear issue automation using Claude Code.

## Overview

Cyrus automatically monitors Linear issues assigned to a specific user and processes them using Anthropic's Claude Code. It creates isolated Git worktrees for each issue, runs Claude Code sessions to implement solutions, and posts responses back to Linear as comments.

## Installation

```bash
npm install -g cyrus-ai
```

## Quick Start

1. **Initialize Cyrus**:
   ```bash
   cyrus
   ```
   This will start the setup wizard to configure your Linear and Anthropic credentials.

2. **Environment Setup**:
   Create a `.env.cyrus` file with your credentials:
   ```env
   ANTHROPIC_API_KEY=your_anthropic_api_key
   LINEAR_API_KEY=your_linear_api_key
   PROXY_URL=your_proxy_server_url
   ```

3. **Repository Configuration**:
   Create a `repositories.json` file to specify which repositories to monitor:
   ```json
   {
     "repositories": [
       {
         "path": "/path/to/your/repo",
         "assignee": "your-linear-assignee-id"
       }
     ]
   }
   ```

## Features

- **Automatic Issue Processing**: Monitors Linear issues and processes them when assigned
- **Git Worktree Integration**: Creates isolated environments for each issue
- **Claude Code Integration**: Uses Anthropic's Claude Code for intelligent code generation
- **Conversation Continuity**: Maintains context using the `--continue` flag
- **Edge Worker Architecture**: Supports distributed processing
- **OAuth Flow**: Handles Linear authentication seamlessly

## Configuration

### Edge Configuration

You can use `.edge-config.json` for advanced configuration:

```json
{
  "repositories": [
    {
      "path": "/path/to/repo",
      "assignee": "assignee-id",
      "allowedTools": ["specific", "tools", "only"]
    }
  ],
  "credentials": {
    "anthropic": "your_key",
    "linear": "your_key"
  }
}
```

### Repository-Specific Setup

If your repository has a `secretagentsetup.sh` script in the root, Cyrus will execute it in new worktrees for project-specific initialization.

## Requirements

- Node.js 18+
- Claude CLI installed and configured
- Git repository with appropriate permissions
- Linear workspace access
- Anthropic API access

## Architecture

Cyrus uses an edge-proxy architecture that separates:
- **OAuth/webhook handling** (proxy server)
- **Claude processing** (edge workers)

This allows for scalable, distributed processing of Linear issues.

## Development

This package is part of the Cyrus monorepo. For development setup:

```bash
git clone https://github.com/ceedaragents/cyrus.git
cd cyrus
pnpm install
pnpm build
```

## License

MIT

## Support

For issues and feature requests, please visit: https://github.com/ceedaragents/cyrus/issues