# Session Persistence Strategy

## Overview

This document describes the persistence strategy implemented to solve the issue where critical mappings were lost after cyrus restarts (CEA-154).

## Problem Statement

Before this implementation, when cyrus restarted, important mappings between Linear comments and Claude sessions were lost from memory, causing:
- Loss of session continuity when new comments arrived in existing threads
- Inability to resume conversations after restarts
- Missing context for ongoing Linear issue discussions

## Solution

### Architecture

The persistence strategy consists of three main components:

1. **PersistenceManager** (`packages/core/src/PersistenceManager.ts`)
   - Handles serialization/deserialization of state to disk
   - Manages state files in `~/.cyrus/state/`
   - Provides utility methods for Map/Set conversions

2. **SessionManager Persistence** (`packages/core/src/SessionManager.ts`)
   - Extended with serialization methods
   - Maintains session state across restarts
   - Handles session restoration from disk

3. **EdgeWorker Persistence** (`packages/edge-worker/src/EdgeWorker.ts`)
   - Integrated with PersistenceManager
   - Automatically saves state after critical mapping changes
   - Loads state on startup

### Critical Mappings Persisted

The following mappings are now persisted to disk:

#### EdgeWorker Mappings
- `commentToRepo` - Maps Linear comment ID to repository ID
- `commentToIssue` - Maps Linear comment ID to issue ID  
- `commentToLatestAgentReply` - Maps thread root comment ID to latest agent comment
- `issueToCommentThreads` - Maps issue ID to all comment thread IDs
- `issueToReplyContext` - Maps issue ID to reply context

#### Session Mappings
- `sessionsByCommentId` - Maps comment ID to Session objects
- `sessionsByIssueId` - Maps issue ID to Session arrays
- `claudeSessionId` - Claude Code session ID for resume functionality
- `agentRootCommentId` - Thread root identification
- `lastCommentId` - Last comment processed
- `currentParentId` - Reply context

### File Structure

State files are stored in `~/.cyrus/state/` directory:
- `{repository-id}-state.json` - Contains serialized state for each repository
- State files include version information and timestamps
- Files are updated immediately after mapping changes

### Automatic Persistence

State is automatically saved after these operations:
- Issue assignment (new sessions created)
- New comment processing (mappings updated)
- Comment posting (reply mappings updated)
- Session completion/error cleanup
- Issue unassignment (mappings cleared)

### Graceful Shutdown

The `EdgeWorker.shutdown()` method ensures state is persisted before termination:
- Saves all current mappings
- Stops running Claude sessions
- Cleans up resources

## Implementation Details

### State Loading

On startup, the `EdgeWorker.loadPersistedState()` method:
1. Iterates through all configured repositories
2. Loads persisted state for each repository
3. Restores mappings using `restoreMappings()`
4. Logs successful state restoration

### State Saving

The `EdgeWorker.savePersistedState()` method:
1. Serializes current mappings using `serializeMappings()`
2. Saves state for each repository
3. Handles errors gracefully without breaking execution

### Serialization Format

State files use JSON format with this structure:
```json
{
  "version": "1.0",
  "savedAt": "2025-07-10T03:30:00.000Z",
  "repositoryId": "repo-123",
  "state": {
    "commentToRepo": { "comment-456": "repo-123" },
    "commentToIssue": { "comment-456": "issue-789" },
    "commentToLatestAgentReply": { "comment-456": "reply-012" },
    "issueToCommentThreads": { "issue-789": ["comment-456"] },
    "issueToReplyContext": { "issue-789": { "commentId": "comment-456" } },
    "sessionsByCommentId": { "comment-456": {...} },
    "sessionsByIssueId": { "issue-789": [...] }
  }
}
```

## Benefits

1. **Session Continuity**: New comments in existing threads are properly routed to the correct Claude sessions
2. **Resume Functionality**: Claude sessions can be resumed with proper context after restarts
3. **Robust Recovery**: System can recover from unexpected shutdowns
4. **Minimal Performance Impact**: State saving is asynchronous and doesn't block processing
5. **Error Tolerance**: Persistence failures don't break normal operation

## Testing

The implementation includes:
- Unit tests for PersistenceManager serialization/deserialization
- Integration tests for EdgeWorker persistence
- Test coverage for state loading/saving scenarios
- Error handling tests for corrupted state files

## Monitoring

The system logs:
- Successful state loading on startup
- Persistence operation failures
- State file corruption warnings
- Recovery from invalid state files

## Future Enhancements

Potential improvements:
- State compression for large installations
- Automatic state cleanup for old/unused mappings
- State backup and rotation
- Performance monitoring for large state files
- Incremental state updates