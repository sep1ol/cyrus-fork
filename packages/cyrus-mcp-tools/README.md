# cyrus-mcp-tools

MCP tools for Cyrus - including Linear file uploads and other utilities.

![Cyrus MCP Tools](https://img.shields.io/badge/Cyrus-MCP%20Tools-blue)
[![npm version](https://img.shields.io/npm/v/cyrus-mcp-tools.svg)](https://www.npmjs.com/package/cyrus-mcp-tools)

## Overview

This MCP server provides tools for Cyrus, currently including:
- File uploads to Linear's cloud storage for use in issues, comments, and other content
- Agent session creation for tracking AI/bot activity on Linear issues

## Features

- Upload files from local filesystem to Linear
- Auto-detection of MIME types
- Configurable public/private access
- Returns Linear-compatible asset URLs
- Built on the official Linear SDK

## Installation

### Prerequisites

- Node.js 20+
- Linear API token

### Getting Your Linear API Token

1. Log in to your Linear account at [linear.app](https://linear.app)
2. Click on your organization avatar (top-left corner)
3. Select **Settings**
4. Navigate to **Security & access** in the left sidebar
5. Under **Personal API Keys** click **New API Key**
6. Give your key a name (e.g., `MCP Linear Uploads`)
7. Copy the generated API token and store it securely

### Install via npm

```bash
npm install -g cyrus-mcp-tools
```

## Configuration

Add the following to your MCP settings file:

```json
{
  "mcpServers": {
    "linear-uploads": {
      "command": "npx",
      "args": ["-y", "cyrus-mcp-tools"],
      "env": {
        "LINEAR_API_TOKEN": "<YOUR_TOKEN>"
      }
    }
  }
}
```

### Client-Specific Configuration Locations

- **Cursor**: `~/.cursor/mcp.json`
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Claude VSCode Extension**: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

## Usage

### Available Tools

The server provides the following tools:

#### `linear_upload_file`

Upload a file to Linear and get an asset URL.

**Parameters:**
- `filePath` (required): Absolute path to the file to upload
- `filename` (optional): Custom filename for Linear (defaults to file basename)
- `contentType` (optional): MIME type (auto-detected if not provided)
- `makePublic` (optional): Make file publicly accessible (default: false)

**Returns:**
- `assetUrl`: Linear asset URL for use in issues/comments
- `filename`: Filename used for the upload
- `size`: File size in bytes
- `contentType`: MIME type of the uploaded file

#### `linear_agent_session_create`

Create an agent session on a Linear issue to track AI/bot activity.

**Parameters:**
- `issueId` (required): The ID or identifier of the Linear issue (e.g., "ABC-123" or UUID)
- `externalLink` (optional): URL of an external agent-hosted page associated with this session

**Returns:**
- `success`: Whether the operation was successful
- `agentSessionId`: The ID of the created agent session
- `lastSyncId`: The identifier of the last sync operation

### Example Usage

Once configured, you can use prompts like:

- "Upload the screenshot at /Users/me/Desktop/bug-screenshot.png to Linear"
- "Upload this log file to Linear and make it publicly accessible"
- "Upload the design mockup and give me the asset URL"

## Manual Execution

You can also run the server directly:

```bash
# With environment variable
export LINEAR_API_TOKEN=your_token_here
cyrus-mcp-tools

# Or with command line argument
cyrus-mcp-tools --token your_token_here
```

## Development

```bash
# Clone and install
git clone https://github.com/ceedaragents/cyrus
cd packages/cyrus-mcp-tools
npm install

# Development mode
npm run dev

# Build
npm run build

# Test
npm test
```

## License

MIT License - see LICENSE file for details.
