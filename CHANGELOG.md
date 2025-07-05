# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Automatic Linear MCP (Model Context Protocol) server integration
  - Claude can now use Linear API tools directly within sessions
  - Automatically configures `@tacticlaunch/mcp-linear` server with repository's Linear token
  - Adds 30+ Linear MCP tools for issue management, comments, projects, and more
  - No additional configuration needed - works out of the box with existing Linear tokens

### Changed
- ClaudeRunner now supports array of MCP config paths for composable configurations
- ClaudeRunner supports inline MCP server configurations alongside file-based configs
- MCP configurations from files and inline sources are merged together

### Improved
- New comments on Linear issues queue up when Cyrus is already busy working, so that you can send multiple in a row ([#77](https://github.com/ceedaragents/cyrus/pull/77)) (now feed into existing Claude sessions instead of killing and restarting the session

## [0.1.21] - 2025-07-05

### CLI
- cyrus-ai@0.1.21

### Added
- Added `CYRUS_HOST_EXTERNAL` environment variable to enable external server access ([#78](https://github.com/ceedaragents/cyrus/pull/78))
  - Set to `true` to listen on `0.0.0.0` (all interfaces) instead of `localhost`
  - Enables Docker container deployment and external webhook access scenarios
  - Maintains backward compatibility with `localhost` as default

### Changed
- **BREAKING**: Renamed `CYRUS_WEBHOOK_BASE_URL` to `CYRUS_BASE_URL` for clearer naming
  - **Action Required**: Update environment configuration to use `CYRUS_BASE_URL` instead of `CYRUS_WEBHOOK_BASE_URL`
  - **Legacy Support**: `CYRUS_WEBHOOK_BASE_URL` is still supported for backward compatibility but deprecated
  - The variable serves both webhook and OAuth callback purposes since they run on the same server

### Packages

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.9

## [0.1.19] - 2025-01-04

### CLI
- cyrus-ai@0.1.19

### Added
- Added `CYRUS_OAUTH_CALLBACK_BASE_URL` environment variable to configure OAuth callback URL (defaults to `http://localhost:3457`) ([#69](https://github.com/ceedaragents/cyrus/pull/69))
- Added `CYRUS_OAUTH_CALLBACK_PORT` environment variable to configure OAuth callback port (defaults to `3457`)
- OAuth callback URL is now fully configurable for different deployment environments (Docker, remote development, custom domains)
- Supports `--env-file=path` option to load environment variables from custom file
- Added `CYRUS_BASE_URL` environment variable to configure base URL for edge workers ([#74](https://github.com/ceedaragents/cyrus/pull/74))
- Added `CYRUS_WEBHOOK_PORT` environment variable to configure webhook port (defaults to random port 3000-3999)
- Implemented shared webhook server architecture to eliminate port conflicts between multiple Linear tokens

### Changed
- **BREAKING**: Migrated from Server-Sent Events (SSE) to webhook-only architecture ([#74](https://github.com/ceedaragents/cyrus/pull/74))
  - **Action Required**: Edge workers now receive webhooks instead of SSE streams
  - **Action Required**: Set `CYRUS_BASE_URL` environment variable if using custom deployment URLs (e.g., ngrok tunnel, server domain)
  - **Action Required**: Set `CYRUS_WEBHOOK_PORT=3456` environment variable to ensure consistent webhook port
  - **Action Required**: Ensure edge workers can receive inbound HTTP requests on webhook ports
- Renamed repository setup script from `secretagentsetup.sh` to `cyrus-setup.sh`

### Fixed
- Resolved SSE connection reliability issues by migrating to webhook architecture
- Improved disconnection message formatting
- Removed duplicate disconnection logging

### Packages

#### cyrus-claude-runner
- Upgraded @anthropic-ai/claude-code dependency to version 1.0.31

## [0.0.3] - 2025-06-17

### Packages
- cyrus-claude-runner@0.0.3
- cyrus-core@0.0.3
- cyrus-edge-worker@0.0.3
- cyrus-ndjson-client@0.0.3

Initial changelog entry

## [0.1.9] - 2025-06-17

### CLI
- cyrus-ai@0.1.9

Initial changelog entry
