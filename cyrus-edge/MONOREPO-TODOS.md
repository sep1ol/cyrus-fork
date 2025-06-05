# Monorepo Migration TODOs

## Phase 1: Setup Monorepo Structure

- [x] Initialize pnpm workspace
  - [x] Create `pnpm-workspace.yaml` in root
  - [x] Update root `package.json` with workspace scripts
  - [x] Install pnpm if not already installed

- [x] Create package directories
  - [x] `packages/core/`
  - [x] `packages/claude-parser/`
  - [x] `packages/linear-client/`
  - [x] `packages/history-stream/`
  - [x] `packages/edge-worker/`

- [x] Setup shared configuration
  - [x] Create `tsconfig.base.json` in root
  - [x] Create `package.json` for each package (core and claude-parser done)
  - [x] Setup build scripts with tsc

## Phase 2: Port Core Package

- [x] Port Session class
  - [x] Copy `src/core/Session.mjs` to `packages/core/src/Session.ts`
  - [x] Add TypeScript types
  - [x] Update imports/exports
  - [ ] Add tests

- [x] Port SessionManager
  - [x] Copy `src/services/SessionManager.mjs` to `packages/core/src/SessionManager.ts`
  - [x] Add TypeScript types
  - [ ] Add tests

- [ ] Port Issue model
  - [ ] Copy relevant parts from `src/core/Issue.mjs`
  - [ ] Add TypeScript types
  - [ ] Remove Linear-specific API calls (those go in linear-client)

- [ ] Create package exports
  - [ ] Create `packages/core/src/index.ts`
  - [ ] Export all public APIs
  - [ ] Build and verify package

## Phase 3: Extract Claude Parser

- [ ] Create parser structure
  - [ ] Create `packages/claude-parser/src/StdoutParser.ts`
  - [ ] Create `packages/claude-parser/src/MessageTypes.ts`
  - [ ] Create `packages/claude-parser/src/StreamProcessor.ts`

- [ ] Extract parsing logic
  - [ ] Copy JSON parsing from `NodeClaudeService.mjs` (lines ~170-400)
  - [ ] Convert to TypeScript class
  - [ ] Remove Linear-specific calls
  - [ ] Make it event-based

- [ ] Add streaming support
  - [ ] Handle partial JSON
  - [ ] Handle line buffering
  - [ ] Emit typed events

- [ ] Test with real Claude output
  - [ ] Create test fixtures from conversation history
  - [ ] Unit test all message types
  - [ ] Test streaming scenarios

## Phase 4: Create Linear Client

- [ ] Setup package structure
  - [ ] Install `@linear/sdk` dependency
  - [ ] Create client class structure
  - [ ] Define TypeScript interfaces

- [ ] Extract API methods
  - [ ] Copy posting logic from `LinearIssueService.mjs`
  - [ ] Create `postComment` method
  - [ ] Create `updateComment` method
  - [ ] Add webhook type definitions

- [ ] Add error handling
  - [ ] Retry logic for network failures
  - [ ] Rate limiting
  - [ ] Error types

## Phase 5: Implement History Stream

- [ ] Create reader implementation
  - [ ] `HistoryReader` class with streaming support
  - [ ] Handle JSON lines
  - [ ] Parse comment dividers
  - [ ] Emit structured events

- [ ] Create writer implementation
  - [ ] `HistoryWriter` for appending messages
  - [ ] Handle atomic writes
  - [ ] Format comment dividers

- [ ] Add file watching
  - [ ] Watch for file changes
  - [ ] Resume from last position
  - [ ] Handle file rotation

## Phase 6: Update Edge Worker Package

- [ ] Refactor EventProcessor
  - [ ] Use new package imports
  - [ ] Remove duplicate code
  - [ ] Add proper TypeScript types

- [ ] Update process management
  - [ ] Use `ClaudeStdoutParser` from package
  - [ ] Use `Session` from core package
  - [ ] Use `LinearClient` for API calls

- [ ] Add event emissions
  - [ ] For UI updates
  - [ ] For logging
  - [ ] For debugging

## Phase 7: Update Electron App

- [x] Update package.json
  - [x] Add workspace dependencies
  - [ ] Update build scripts
  - [ ] Update start scripts

- [x] Refactor main process
  - [x] Import from packages (@cyrus/core)
  - [x] Remove duplicated code (Session management)
  - [ ] Update IPC handlers

- [x] Update types
  - [x] Use shared types from packages
  - [x] Remove local type definitions
  - [ ] Update electron.d.ts

## Phase 8: Testing & Documentation

- [ ] Integration tests
  - [ ] Test full flow with packages
  - [ ] Test Electron app
  - [ ] Test edge worker standalone

- [ ] Update documentation
  - [ ] Update README files
  - [ ] Document package APIs
  - [ ] Update CLAUDE.md

- [ ] Prepare for headless mode
  - [ ] Document configuration approach
  - [ ] Ensure no UI dependencies in core packages
  - [ ] Create example headless config

## Notes

- Keep existing functionality working throughout migration
- Commit after each major milestone
- Run tests frequently
- Update this checklist as you progress