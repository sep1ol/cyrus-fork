# Cyrus Monorepo Architecture PRD

## Overview

This document outlines the plan to restructure Cyrus into a monorepo architecture with clear package boundaries, enabling code reuse across multiple applications while maintaining the existing functionality.

## Goals

1. **Code Reusability**: Share core logic between Electron app, CLI tools, and future web interfaces
2. **Clear Separation**: Define explicit boundaries between different concerns
3. **Platform Independence**: Keep core business logic free from platform-specific code
4. **Gradual Migration**: Enable incremental porting of existing code
5. **Type Safety**: Share TypeScript types across all packages

## Architecture

### Repository Structure

```
cyrus/
├── packages/                    # Shared packages
│   ├── core/                   # Business logic & models
│   ├── claude-parser/          # Claude message parsing
│   ├── linear-client/          # Linear API wrapper
│   ├── history-stream/         # Conversation history
│   ├── edge-worker/            # Edge worker orchestration
│   └── proxy-server/           # Proxy server (existing)
│
├── apps/                       # Applications
│   ├── electron/              # Electron desktop app
│   ├── cli/                   # CLI tool (future)
│   └── web-dashboard/         # Web UI (future)
│
├── package.json               # Root configuration
├── pnpm-workspace.yaml        # Workspace configuration
└── tsconfig.base.json         # Shared TypeScript config
```

### Package Definitions

#### `@cyrus/core` - Core Business Logic
**Purpose**: Platform-agnostic business models and state management

**Exports**:
- `Session` - Claude session state management
- `SessionManager` - Multi-session tracking
- `Issue` - Linear issue model
- `Workspace` - Workspace abstraction
- `Comment` - Comment model

**Dependencies**: None (pure business logic)

**Migration Path**: Direct port from existing `.mjs` files:
- `src/core/Session.mjs` → `packages/core/src/Session.ts`
- `src/core/Issue.mjs` → `packages/core/src/Issue.ts`
- `src/services/SessionManager.mjs` → `packages/core/src/SessionManager.ts`

#### `@cyrus/claude-parser` - Claude Output Parsing
**Purpose**: Parse and process Claude's JSON output stream

**Exports**:
- `ClaudeStdoutParser` - Line-by-line JSON parser
- `MessageTypes` - TypeScript types for all Claude messages
- `StreamProcessor` - Handle streaming events
- `ContentBlockParser` - Parse tool use, text, etc.

**Dependencies**: `@cyrus/core` (for Session updates)

**Migration Path**: Extract from `NodeClaudeService.mjs` lines 170-400

#### `@cyrus/linear-client` - Linear API Client
**Purpose**: Wrapper around Linear's GraphQL API

**Exports**:
- `LinearClient` - Main API client
- `WebhookTypes` - Webhook payload types
- `IssueOperations` - Issue CRUD operations
- `CommentOperations` - Comment posting/updating

**Dependencies**: `@linear/sdk`, `graphql`

**Migration Path**: Extract from `LinearIssueService.mjs`

#### `@cyrus/history-stream` - Conversation History
**Purpose**: Read/write conversation history files with streaming support

**Exports**:
- `HistoryReader` - Stream historical messages
- `HistoryWriter` - Append new messages
- `HistoryWatcher` - Watch for live updates
- `DividerParser` - Parse comment dividers

**Key Features**:
- Handle both JSON lines and special dividers
- Support streaming reads for UI
- Efficient file watching

**Dependencies**: Node.js fs/stream APIs

**Migration Path**: New implementation based on history file format

#### `@cyrus/edge-worker` - Edge Worker Core
**Purpose**: Orchestrate Claude processing for Linear issues

**Exports**:
- `EventProcessor` - Main webhook processor
- `WorkspaceManager` - Manage issue workspaces
- `ClaudeRunner` - Spawn and manage Claude processes

**Dependencies**: All other packages

**Migration Path**: Enhanced version of current `electron/event-processor.ts`

### Application Structure

#### `apps/electron` - Electron Desktop App
- Main process handles edge worker
- Renderer process shows dashboard UI
- IPC for communication
- Uses all `@cyrus/*` packages

#### `apps/cli` (Future)
- Command-line edge worker
- Uses `@cyrus/edge-worker` directly
- No UI dependencies

#### `apps/web-dashboard` (Future)
- Web-based monitoring dashboard
- Connects to edge worker via WebSocket
- React-based UI

## Implementation Plan

### Phase 1: Setup Monorepo Structure (Week 1)
1. Initialize pnpm workspace
2. Create package directories
3. Setup shared TypeScript configuration
4. Configure build tooling

### Phase 2: Port Core Package (Week 1-2)
1. Port `Session.mjs` to TypeScript
2. Port `SessionManager.mjs`
3. Port core models (Issue, Workspace, Comment)
4. Add comprehensive tests

### Phase 3: Extract Claude Parser (Week 2-3)
1. Extract parsing logic from `NodeClaudeService.mjs`
2. Create clean interfaces
3. Add streaming event support
4. Test with real Claude output

### Phase 4: Create Linear Client (Week 3-4)
1. Extract Linear API calls
2. Create typed client interface
3. Add retry logic
4. Test with Linear API

### Phase 5: Implement History Stream (Week 4)
1. Implement file reading/writing
2. Add streaming support
3. Handle special dividers
4. Add file watching

### Phase 6: Update Edge Worker (Week 5)
1. Refactor to use new packages
2. Update event handling
3. Add proper error handling
4. Integration testing

### Phase 7: Update Electron App (Week 5-6)
1. Update to use packages
2. Refactor IPC handlers
3. Update UI to use streams
4. End-to-end testing

## Technical Decisions

### Package Manager: pnpm
- Efficient disk usage
- Great workspace support
- Fast installation

### Build Tool: TypeScript Compiler (tsc)
- Standard TypeScript compilation
- No additional dependencies
- Direct source maps and type definitions

### Testing: Vitest
- Fast test execution
- Great TypeScript support
- Compatible with Jest

### Versioning: Changesets
- Automated version management
- Clear changelog generation
- Monorepo aware

## Migration Strategy

### For Existing Code
1. **Preserve Logic**: Port with minimal changes
2. **Add Types Gradually**: Start with `any` if needed
3. **Test Continuously**: Ensure behavior matches
4. **Refactor Later**: Clean up after initial port

### For New Features
1. **Start in Packages**: Build in appropriate package
2. **Design for Reuse**: Think beyond current use case
3. **Document Interfaces**: Clear API documentation
4. **Test in Isolation**: Unit test packages

## Success Criteria

1. **All existing functionality works**: No regressions
2. **Clear package boundaries**: No circular dependencies
3. **Improved developer experience**: Easier to understand and modify
4. **Ready for new apps**: Can easily build CLI or web UI
5. **Better testing**: Higher test coverage with isolated tests

## Risks and Mitigations

### Risk: Breaking existing functionality
**Mitigation**: Incremental migration with extensive testing

### Risk: Over-engineering
**Mitigation**: Start simple, add complexity only when needed

### Risk: Performance regression
**Mitigation**: Profile critical paths, optimize if needed

### Risk: Team adoption
**Mitigation**: Clear documentation and gradual rollout

## Future Possibilities

With this architecture, we can easily add:
- **Headless Edge Worker**: Run without Electron UI (daemon mode)
  - Uses same `@cyrus/edge-worker` package
  - File-based configuration instead of UI
  - Logs to files instead of UI
  - Perfect for server deployments
- **VS Code Extension**: Using `@cyrus/edge-worker`
- **GitHub App**: Alternative to Linear
- **Slack Bot**: Notifications and control
- **Web Dashboard**: For team visibility
- **API Server**: For third-party integrations

### Headless Mode Design
The architecture explicitly supports headless operation:
- All UI code is isolated in `apps/electron`
- Core packages have no UI dependencies
- Event emitters allow different consumers (UI, logs, webhooks)
- Configuration can come from files or environment variables

## Conclusion

This monorepo architecture provides a solid foundation for Cyrus's growth while maintaining the stability of existing functionality. The modular approach enables multiple deployment targets and better code organization.