# Linear Claude Agent

A JavaScript application that integrates Linear with Claude to automate issue processing.

## Features

- Automatically processes Linear issues assigned to a specific user
- Creates separate Git worktrees for each issue
- Runs Claude in each worktree to handle issues
- Posts Claude's responses back to Linear as comments
- Listens for new comments via Linear's webhook API and forwards them to Claude
- Maintains isolated environments for each issue
- Cleans up worktrees on shutdown

## Setup

1. Clone this repository
2. Create a `.env` file based on `.env.example`
3. Fill in your Linear API token, user ID, and webhook secret
4. Install dependencies with `npm install`
5. Start the agent with `npm start`

## Environment Variables

- `LINEAR_API_TOKEN`: Your Linear API token
- `LINEAR_USER_ID`: The Agent Linear user ID
- `LINEAR_USERNAME`: The Agent Linear username
- `LINEAR_WEBHOOK_SECRET`: Secret for verifying webhook requests
- `WEBHOOK_PORT`: Port for the webhook server
- `CLAUDE_PATH`: Path to the Claude executable
- `WORKSPACE_BASE_DIR`: Directory where issue workspaces will be created
- `PROMPT_TEMPLATE_PATH`: Path to the file containing the prompt template for Claude. This file should contain placeholders like `{{issue_details}}`, `{{linear_comments}}`, `{{branch_name}}`, `{{process_history}}`, and `{{new_input}}`.

## Webhook Setup

1. In your Linear workspace, go to Settings > API
2. Create a new webhook with the following settings:
   - URL: `https://your-server.com/webhook`
   - Resource types: Issues, Comments
   - Actions: Create, Update
   - Secret: Your webhook secret (same as in `.env`)

## How It Works

1. When started, the agent fetches all issues assigned to the specified user
2. For each issue, it creates a workspace (a git worktree if in a git repo).
   - It checks if the workspace directory or branch already exists to allow persistence.
   - If a script named `secretagentsetup.sh` exists in the root of the repository, it is executed within the new worktree after creation/setup. This allows for project-specific initialization (e.g., installing dependencies).
3. It starts a Claude session within the workspace.
4. Initial responses from Claude are posted back to Linear as comments
5. When users comment on issues, the webhook receives the event
6. The comment is forwarded to the corresponding Claude session
7. Claude's responses are posted back to Linear

## Development

- `npm start`: Start the application
- `npm run dev`: Start with nodemon for development (auto-restart on file changes)

## Troubleshooting

- Check the logs for error messages
- Ensure your Linear API token and user ID are correct
- Verify that the Claude executable path is correct
- Make sure your webhook URL is publicly accessible