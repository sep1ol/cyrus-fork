# Linear SDK TypeScript Types Summary

This document shows the exact TypeScript interfaces and types that should be used when working with Linear SDK Issue objects in the EdgeWorker.ts file.

## Key Linear SDK Types Used

### Issue Type
```typescript
import { Issue } from '@linear/sdk'

// Main Issue properties (from Linear SDK)
interface Issue {
  // Core identification
  id: string                          // Unique identifier
  identifier: string                  // Human readable identifier (e.g. ENG-123)
  number: number                     // Issue's unique number
  title: string                      // Issue's title
  url: string                        // Issue URL
  
  // Content and description
  description?: string               // Issue's description in markdown format
  
  // Status and workflow
  priority: number                   // 0 = No priority, 1 = Urgent, 2 = High, 3 = Normal, 4 = Low
  priorityLabel: string             // Label for the priority
  
  // Timestamps
  createdAt: Date                   // When entity was created
  updatedAt: Date                   // When entity was last updated
  startedAt?: Date                  // When issue was moved into started state
  completedAt?: Date                // When issue was moved into completed state
  canceledAt?: Date                 // When issue was moved into canceled state
  dueDate?: Date                    // Date at which issue is due
  
  // Relationships (accessed via LinearFetch)
  assignee?: LinearFetch<User>      // User assigned to issue
  creator?: LinearFetch<User>       // User who created issue
  state?: LinearFetch<WorkflowState> // Workflow state
  team?: LinearFetch<Team>          // Team associated with issue
  parent?: LinearFetch<Issue>       // Parent issue
  
  // Collections (accessed via methods)
  comments(variables?: CommentQueryVariables): LinearFetch<CommentConnection>
  attachments(variables?: AttachmentQueryVariables): LinearFetch<AttachmentConnection>
  children(variables?: IssueQueryVariables): LinearFetch<IssueConnection>
  labels(variables?: LabelQueryVariables): LinearFetch<IssueLabelConnection>
  
  // Other properties
  branchName: string                // Suggested branch name
  estimate?: number                 // Complexity estimate
  labelIds: string[]               // Array of label IDs
  trashed?: boolean                // Whether issue is in trash
}
```

### Comment Type
```typescript
import { Comment } from '@linear/sdk'

// Main Comment properties (from Linear SDK)
interface Comment {
  // Core identification
  id: string                        // Unique identifier
  body: string                     // Comment content in markdown format
  url: string                      // Comment's URL
  
  // Timestamps
  createdAt: Date                  // When entity was created
  updatedAt: Date                  // When entity was last updated
  editedAt?: Date                  // When user edited the comment
  resolvedAt?: Date                // When comment thread was resolved
  
  // Relationships (accessed via LinearFetch)
  user?: LinearFetch<User>         // User who wrote the comment
  issue?: LinearFetch<Issue>       // Issue the comment is associated with
  parent?: LinearFetch<Comment>    // Parent comment (for threaded replies)
  
  // Other properties
  quotedText?: string              // Text that this comment references (inline comments)
  reactionData: JSONObject         // Emoji reaction summary
  reactions: Reaction[]            // Reactions associated with comment
}
```

### CommentCreateInput Type
```typescript
// Input type for creating comments (from Linear SDK)
interface CommentCreateInput {
  issueId: string                  // Required: Issue ID to comment on
  body: string                     // Required: Comment content in markdown
  parentId?: string                // Optional: Parent comment ID for replies
  // ... other optional fields
}
```

## Updated Method Signatures in EdgeWorker.ts

### Before (using `any`)
```typescript
private async handleIssueAssigned(issue: any, repository: RepositoryConfig): Promise<void>
private async handleNewComment(issue: any, comment: any, repository: RepositoryConfig): Promise<void>
private async postComment(issueId: string, body: string, repositoryId: string, parentId?: string): Promise<{ id: string } | null>
```

### After (using proper Linear SDK types)
```typescript
private async handleIssueAssigned(issue: Issue | any, repository: RepositoryConfig): Promise<void>
private async handleNewComment(issue: Issue | any, comment: Comment | any, repository: RepositoryConfig): Promise<void>
private async postComment(issueId: string, body: string, repositoryId: string, parentId?: string): Promise<Comment | null>
```

Note: We use `Issue | any` and `Comment | any` to maintain compatibility with webhook data that may not be fully typed, while still providing proper types when using the Linear SDK directly.

## CommentData Type Improvements

### Before
```typescript
const commentData: any = {
  issueId,
  body
}
```

### After
```typescript
const commentData: { issueId: string; body: string; parentId?: string } = {
  issueId,
  body
}
```

## Key Benefits

1. **Type Safety**: Catching type errors at compile time instead of runtime
2. **IntelliSense**: Better IDE autocomplete and code navigation
3. **Documentation**: Self-documenting code with clear type contracts
4. **Refactoring**: Safer code changes with compile-time validation
5. **Maintainability**: Easier to understand and modify code

## Files Updated

1. `/packages/edge-worker/src/EdgeWorker.ts` - Main EdgeWorker class with proper Linear SDK types
2. `/packages/edge-worker/src/types.ts` - Type definitions with Linear SDK imports

## How to Access Linear SDK Type Definitions

The complete Linear SDK type definitions are available at:
- `node_modules/@linear/sdk/dist/_generated_sdk.d.ts` - Main SDK types
- `node_modules/@linear/sdk/dist/types.d.ts` - Client and error types
- `node_modules/@linear/sdk/dist/index.d.ts` - Main exports

You can also browse them online at the Linear SDK documentation or GitHub repository.