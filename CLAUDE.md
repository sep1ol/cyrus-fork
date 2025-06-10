# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Cyrus (Linear Claude Agent) is a monorepo JavaScript/TypeScript application that integrates Linear's issue tracking with Anthropic's Claude Code to automate software development tasks. The project is transitioning to an edge-proxy architecture that separates OAuth/webhook handling (proxy) from Claude processing (edge workers).

**Key capabilities:**
- Monitors Linear issues assigned to a specific user
- Creates isolated Git worktrees for each issue
- Runs Claude Code sessions to process issues
- Posts responses back to Linear as comments
- Maintains conversation continuity using the `--continue` flag
- Supports edge worker mode for distributed processing

## Architecture Overview

The codebase follows a pnpm monorepo structure:

```
cyrus/
├── apps/
│   ├── cli/          # Main CLI application
│   ├── electron/     # Future Electron GUI (in development)
│   └── proxy/        # Edge proxy server for OAuth/webhooks
└── packages/
    ├── core/         # Shared types and session management
    ├── claude-parser/# Claude stdout parsing with jq
    ├── claude-runner/# Claude CLI execution wrapper
    ├── edge-worker/  # Edge worker client implementation
    └── ndjson-client/# NDJSON streaming client
```

## Common Commands

### Monorepo-wide Commands (run from root)
```bash
# Install dependencies for all packages
pnpm install

# Build all packages
pnpm build

# Run tests across all packages
pnpm test

# Run tests only in packages directory
pnpm test:packages

# Run TypeScript type checking
pnpm typecheck

# Development mode (watch all packages)
pnpm dev
```

### App-specific Commands

#### CLI App (`apps/cli/`)
```bash
# Start the agent
pnpm start

# Development mode with auto-restart
pnpm dev

# Run tests
pnpm test
pnpm test:watch  # Watch mode
```

#### Electron App (`apps/electron/`)
```bash
# Run linting
pnpm lint

# Development mode
pnpm dev

# Build for production
pnpm build:all

# Run electron in dev mode
pnpm electron:dev
```

#### Proxy App (`apps/proxy/`)
```bash
# Start proxy server
pnpm start

# Development mode with auto-restart
pnpm dev

# Run tests
pnpm test
```

### Package Commands (all packages follow same pattern)
```bash
# Build the package
pnpm build

# TypeScript type checking
pnpm typecheck

# Run tests
pnpm test        # Watch mode
pnpm test:run    # Run once

# Development mode (TypeScript watch)
pnpm dev
```

## Linear State Management

The agent automatically moves issues to the "started" state when assigned. Linear uses standardized state types:

- **State Types Reference**: https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/enums/ProjectStatusType
- **Standard Types**: `triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`
- **Issue Assignment Behavior**: When an issue is assigned to the agent, it automatically transitions to a state with `type === 'started'` (In Progress)

## Important Development Notes

1. **Edge-Proxy Architecture**: The project is transitioning to separate OAuth/webhook handling from Claude processing. See `EDGE-PROXY-MASTER.md` for current status.

2. **Dependencies**: 
   - The claude-parser package requires `jq` to be installed on the system
   - Uses pnpm as package manager (v10.11.0)
   - TypeScript for all new packages

3. **Git Worktrees**: When processing issues, the agent creates separate git worktrees. If a `secretagentsetup.sh` script exists in the repository root, it's executed in new worktrees for project-specific initialization.

4. **Testing**: Uses Vitest for all packages. Run tests before committing changes.

## Key Code Paths

- **Linear Integration**: `apps/cli/services/LinearIssueService.mjs`
- **Claude Execution**: `packages/claude-runner/src/ClaudeRunner.ts`
- **Session Management**: `packages/core/src/session/`
- **Edge Worker**: `packages/edge-worker/src/EdgeWorker.ts`
- **OAuth Flow**: `apps/proxy/src/services/OAuthService.mjs`

