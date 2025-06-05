# Next Steps for Cyrus Monorepo Migration

## Super-Immediate Next Steps (In Progress)

1. **Fix remaining TypeScript errors in claude-parser package**
   - Fix the StreamProcessor error handler type issue
   - Remove unused 'encoding' parameter warning
   - Build the package successfully

2. **Complete claude-parser package**
   - Install dependencies for claude-parser
   - Verify the build output
   - Update MONOREPO-TODOS.md to mark Phase 3 tasks as complete

## Next Steps After That

### Phase 4: Create Linear Client Package
1. **Setup @cyrus/linear-client package**
   - Create package.json and tsconfig.json
   - Install @linear/sdk as dependency
   - Create TypeScript interfaces for Linear API operations

2. **Extract Linear API methods**
   - Port comment posting logic from LinearIssueService.mjs
   - Implement createComment, updateComment methods
   - Add webhook type definitions
   - Implement error handling and retry logic

### Phase 5: Implement History Stream Package
1. **Create @cyrus/history-stream package**
   - Implement HistoryReader class with streaming support
   - Handle JSONL parsing with comment dividers
   - Create HistoryWriter for appending messages
   - Add file watching capabilities

### Phase 6: Update Edge Worker Package
1. **Refactor EventProcessor to use new packages**
   - Import StdoutParser from @cyrus/claude-parser
   - Use LinearClient from @cyrus/linear-client
   - Remove duplicate parsing code
   - Add proper event emissions for UI updates

### Phase 7: Complete Electron Integration
1. **Update Electron app dependencies**
   - Add all new workspace packages to package.json
   - Update IPC handlers to use new types
   - Update electron.d.ts with shared types

## Current Status
- ✅ Core package created and working
- ✅ Session and SessionManager ported to TypeScript
- ✅ Electron app successfully using @cyrus/core
- 🚧 Claude parser package structure created, fixing build errors
- ⏳ Linear client package pending
- ⏳ History stream package pending
- ⏳ Edge worker refactoring pending