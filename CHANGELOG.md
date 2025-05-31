# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Coverage folder to .gitignore to prevent test coverage reports from being tracked

### Removed
- Coverage folder from git tracking (now properly ignored)

### Changed
- CLI argument `--env-file`/`-e` to specify custom environment file
- Default environment file changed from `.env` to `.env.secret-agents`
- CLAUDE.md file with project conventions and guidelines for Claude Code assistant
- Image download functionality for Linear issue attachments
  - Automatically downloads images from issue descriptions and comments
  - Supports Linear's authenticated file storage URLs
  - Includes images in Claude Code prompt with local file paths
  - Implements 10 image hard cap limit to prevent token overflow
  - Posts warning to Linear when image limit is exceeded

### Changed
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