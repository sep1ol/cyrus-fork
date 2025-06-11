# Next Steps for Cyrus Monorepo Migration

## ✅ Completed (Phase 3)

1. **Fixed TypeScript errors in claude-parser package**
   - ✅ Fixed the StreamProcessor error handler type issue
   - ✅ Removed unused 'encoding' parameter warning
   - ✅ Built the package successfully

2. **Completed claude-parser package**
   - ✅ Installed dependencies for claude-parser
   - ✅ Verified the build output
   - ✅ Updated MONOREPO-TODOS.md to mark Phase 3 tasks as complete
   - ✅ Added README documenting jq requirement
   - ✅ Updated edge worker to use jq processing

## Next Steps

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
- ✅ Claude parser package completed and building successfully
- ⏳ Linear client package pending (Phase 4 - Next)
- ⏳ History stream package pending (Phase 5)
- ⏳ Edge worker refactoring pending (Phase 6)