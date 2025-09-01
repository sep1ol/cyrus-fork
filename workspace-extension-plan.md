# Workspace Extension Implementation Plan

This file contains the complete implementation details for extending workspace teams and labels context to orchestrator agents.

## Files to Modify

1. packages/edge-worker/label-prompt-template.md
2. packages/edge-worker/src/EdgeWorker.ts
3. CHANGELOG.md

## Implementation Details

### Template Update
Add workspace context section after </linear_issue>

### EdgeWorker Changes
- Add LinearClient access
- Fetch teams and labels data
- Format for template injection
- Add template replacements

Ready to implement these changes manually.