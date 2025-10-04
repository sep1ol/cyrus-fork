# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- **Automatic MCP config detection**: Cyrus now automatically detects and loads `.mcp.json` files in the repository root without requiring explicit `mcpConfigPath` configuration. This makes MCP server setup more intuitive and matches expected user behavior.

### Fixed
- **Custom instructions now work correctly**: Fixed critical bug where `appendSystemPrompt` was being silently ignored, causing Cyrus to not follow custom instructions or agent guidance. The feature has been fixed to use the correct SDK API (`systemPrompt.append`), making custom prompts and Linear agent guidance work as intended.

## [0.1.53] - 2025-10-04

### Added
- **Agent guidance injection**: Cyrus now automatically receives and includes both workspace-level and team-specific agent guidance from Linear in all prompts. When both types of guidance are configured, both are included in the prompt, with team-specific guidance taking precedence as specified by Linear's guidance system.

### Changed
- Updated @linear/sdk from v58.1.0 to v60.0.0 to support agent guidance feature

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.28

#### cyrus-core
- cyrus-core@0.0.16

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.35

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.21

#### cyrus-ai (CLI)
- cyrus-ai@0.1.53

## [0.1.52] - 2025-10-04

### Changed
- Version bump for all packages to ensure proper dependency resolution

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.27

#### cyrus-core
- cyrus-core@0.0.15

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.34

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.20

#### cyrus-ai (CLI)
- cyrus-ai@0.1.52

## [0.1.51] - 2025-10-04

### Fixed
- **Restored file-based settings loading**: Fixed regression from claude-agent-sdk update where CLAUDE.md files, settings files, and custom slash commands were not being loaded
  - Added explicit `settingSources: ["user", "project", "local"]` configuration to ClaudeRunner
  - This restores backwards compatibility with existing user configurations
  - See [Claude Code SDK Migration Guide](https://docs.claude.com/en/docs/claude-code/sdk/migration-guide#settings-sources-no-longer-loaded-by-default)

### Changed
- **Default model changed from opus to sonnet 4.5**: The default Claude model is now `sonnet` instead of `opus`
  - Fallback model changed from `sonnet` to `haiku`
  - Label-based model selection still available - users can add `opus`, `sonnet`, or `haiku` labels to issues to override the default
  - Affects all new sessions that don't explicitly specify a model in config
- Updated @anthropic-ai/claude-agent-sdk from v0.1.0 to v0.1.5 for latest Claude Agent SDK improvements
- Updated @anthropic-ai/sdk from v0.64.0 to v0.65.0 for latest Anthropic SDK improvements
  - Added support for Claude Sonnet 4.5 and context management features
  - See [@anthropic-ai/sdk v0.65.0 changelog](https://github.com/anthropics/anthropic-sdk-typescript/compare/sdk-v0.64.0...sdk-v0.65.0)

### Packages

#### cyrus-claude-runner
- cyrus-claude-runner@0.0.26

#### cyrus-core
- cyrus-core@0.0.14

#### cyrus-edge-worker
- cyrus-edge-worker@0.0.33

#### cyrus-ndjson-client
- cyrus-ndjson-client@0.0.19

#### cyrus-ai (CLI)
- cyrus-ai@0.1.51

## [0.1.50] - 2025-09-30

### Fixed
- **Token limit handling now works correctly**: Fixed a bug where the token limit handling would incorrectly trigger on out-of-tokens errors, causing sessions to stop prematurely. The agent now properly:
  - Only triggers continuation when output tokens are exhausted AND there's an active `end_turn` block
  - Stops when there are truly no tokens left for input/output
  - See implementation in: `packages/claude-runner/src/ClaudeRunner.ts:469`

