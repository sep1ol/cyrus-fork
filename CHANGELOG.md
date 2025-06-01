# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Vitest as the new test runner, replacing Jest
  - Provides significantly faster test execution
  - Maintains full compatibility with existing test APIs
  - Includes built-in UI mode for test debugging with `pnpm run test:ui`
  - Native ES modules support without experimental flags
- Coverage folder to .gitignore to prevent test coverage reports from being tracked
- AttachmentDownloader class to handle all types of Linear attachments (not just images)
  - Supports downloading any file type from Linear's authenticated storage
  - Automatically detects file types and categorizes them as images or other attachments
  - Gracefully handles download failures with informative warnings
  - Replaces the previous ImageDownloader with a more comprehensive solution

### Removed
- Jest test runner and related dependencies (@types/jest, jest-environment-node)
- Jest configuration file (jest.config.mjs)
- Coverage folder from git tracking (now properly ignored)
- ImageDownloader class (replaced by AttachmentDownloader)
  - All image handling functionality is now provided by AttachmentDownloader
  - Removed ImageDownloader tests, exports, and container registration

### Changed
- Migrated from npm to pnpm package manager
  - Replaced package-lock.json with pnpm-lock.yaml
  - Updated all documentation to use pnpm commands
  - Updated GitHub Actions workflow to use pnpm
  - Added `packageManager` field to package.json for explicit pnpm version (10.11.0)
- Renamed and simplified GitHub Actions workflow
  - Renamed `tests.yml` to `ci.yml` to better reflect its purpose
  - Simplified workflow configuration for clarity
  - Updated badge reference in README.md
  - Switched to `wyvox/action-setup-pnpm` for consistent dependency installation
  - Added Node.js 22.x to the test matrix
  - Refactored dependency installation into a reusable GitHub Action
- Test runner from Jest to Vitest for improved performance
  - All test files updated to import from 'vitest' instead of '@jest/globals'
  - Mock functions migrated from `jest.*` to `vi.*` equivalents
  - Updated package.json test scripts to use vitest commands
  - Created vitest.config.mjs with minimal configuration using defaults
- CLI argument `--env-file`/`-e` to specify custom environment file
- Default environment file changed from `.env` to `.env.secret-agents`
- CLAUDE.md file with project conventions and guidelines for Claude Code assistant
- Updated attachment handling to support all file types, not just images
  - NodeClaudeService now uses AttachmentDownloader instead of ImageDownloader
  - Attachments are stored in `~/.linearsecretagent/<workspace>/attachments` directory
  - Claude configuration updated to allow reading from attachments directory only
  - Error messages now indicate when non-image attachments fail to process
- Branch naming now uses Linear's workspace-configured branch format
  - Fetches `branchName` property from Linear API
  - Respects workspace settings for branch naming conventions
  - Falls back to lowercase identifier if API value not available
- All entry points now support custom environment file paths
- Updated documentation to reflect new environment file behavior
- NodeClaudeService now downloads images before starting Claude sessions
- Fresh sessions after token limit also include previously downloaded images
- Agent now has better social awareness when reading Linear comments 🎭
  - Only responds to comments without @ mentions (general conversation)
  - Always responds when directly @ mentioned (someone needs the agent!)
  - Politely ignores when other users are @ mentioned but not the agent (respecting private conversations)
- Image storage location moved from project directory to home directory
  - Images are now stored in `~/.linearsecretagent/<workspace>/images` instead of `.linear-images` in project
  - Prevents workspace pollution and eliminates need to update `.gitignore`
  - Follows same pattern as conversation history storage
- Image file type detection from content
  - Automatically detects actual file type (png, jpg, gif, etc.) from downloaded content
  - No longer relies on URL extensions which Linear doesn't provide
  - Falls back to .png if file type cannot be determined

### Fixed
- Agent now correctly identifies itself using its Linear username instead of "Claude"
  - Prompt template now uses dynamic `{{agent_name}}` placeholder
  - Agent name is fetched from Linear API and injected into prompts
  - Fallback to "Linear Agent" if username is not available
- Fixed issue where all attachments were treated as images
  - Non-image attachments (like .jsonl files) no longer cause "Could not process image" errors
  - Attachment failures are now handled gracefully without stopping the agent
