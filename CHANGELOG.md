# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### CLI
- cyrus-ai@0.1.10

### Added
- Added `OAUTH_CALLBACK_BASE_URL` environment variable to configure OAuth callback URL (defaults to `http://localhost:3457`)
- OAuth callback URL is now fully configurable for different deployment environments (Docker, remote development, custom domains)

### Changed
- Renamed repository setup script from `secretagentsetup.sh` to `cyrus-setup.sh` for better naming consistency
- Updated all references in codebase to use the new script name
- Added comprehensive documentation for the setup script feature in README.md

### Fixed
- Improved disconnection message formatting to show token suffix consistently
- Removed duplicate disconnection logging between EdgeWorker and CLI

### Packages
- cyrus-ndjson-client

### Fixed
- Fixed reconnection not being attempted when proxy stream ends normally (e.g., after timeout)

### Added
- Added `reconnectOnStreamEnd` configuration option (defaults to true) to control automatic reconnection behavior

- cyrus-claude-runner

### Changed
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
