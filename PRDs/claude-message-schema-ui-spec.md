# Claude Code Message Schema UI Specification

## Overview

This document provides detailed specifications for rendering Claude Code SDK messages in the Cyrus UI, focusing on the "work in progress" view that shows real-time Claude activity.

## Message Schema Deep Dive

### Core Message Types

#### 1. Assistant Messages
```typescript
{
  type: "assistant",
  message: {
    id: "msg_01XYZ...",
    type: "message",
    role: "assistant",
    model: "claude-3-opus-20240229",
    content: ContentBlock[],
    stop_reason: "end_turn" | "max_tokens" | "tool_use",
    usage: {
      input_tokens: number,
      output_tokens: number
    }
  },
  session_id: "session_123"
}
```

#### 2. User Messages
```typescript
{
  type: "user",
  message: {
    role: "user",
    content: string | ContentBlock[]
  },
  session_id: "session_123"
}
```

#### 3. System Messages
```typescript
{
  type: "system",
  subtype: "init",
  session_id: "session_123",
  tools: ["Bash", "Edit", "Read", "Write", "Glob", "Grep"],
  mcp_servers: [{
    name: "ceedardb",
    status: "connected"
  }]
}
```

#### 4. Result Messages
```typescript
{
  type: "result",
  subtype: "success" | "error_max_turns",
  cost_usd: 0.0234,
  duration_ms: 45678,
  duration_api_ms: 12345,
  is_error: boolean,
  num_turns: number,
  result?: string,
  session_id: "session_123"
}
```

### Content Block Types

#### Text Block
```typescript
{
  type: "text",
  text: "I'll help you fix that authentication bug...",
  citations?: [{
    type: "web_search",
    data: {
      url: string,
      title: string,
      snippet: string
    }
  }]
}
```

#### Tool Use Block
```typescript
{
  type: "tool_use",
  id: "toolu_01ABC...",
  name: "Read" | "Edit" | "Bash" | etc.,
  input: {
    // Tool-specific parameters
    file_path?: string,
    command?: string,
    pattern?: string,
    // etc.
  }
}
```

#### Tool Result Block
```typescript
{
  type: "tool_result",
  tool_use_id: "toolu_01ABC...",
  content: string | ContentBlock[],
  is_error?: boolean
}
```

## UI Rendering Specifications

### Message Stream Processing

```javascript
class MessageStreamProcessor {
  constructor() {
    this.messages = new Map() // issueId -> messages[]
    this.activeBlocks = new Map() // blockId -> partial content
  }
  
  processStreamEvent(issueId, event) {
    switch (event.type) {
      case "message_start":
        this.handleMessageStart(issueId, event)
        break
      case "content_block_start":
        this.handleBlockStart(issueId, event)
        break
      case "content_block_delta":
        this.handleBlockDelta(issueId, event)
        break
      case "content_block_stop":
        this.handleBlockStop(issueId, event)
        break
      case "message_delta":
        this.handleMessageDelta(issueId, event)
        break
      case "message_stop":
        this.handleMessageStop(issueId, event)
        break
    }
  }
}
```

### Visual Rendering Components

#### 1. Text Content Rendering
```jsx
function TextBlock({ block, isStreaming }) {
  return (
    <div className="text-block">
      <ReactMarkdown>
        {block.text}
        {isStreaming && <span className="cursor">▌</span>}
      </ReactMarkdown>
    </div>
  )
}
```

#### 2. Tool Use Rendering
```jsx
function ToolUseBlock({ block, result }) {
  const icons = {
    Read: "📄",
    Edit: "✏️",
    Bash: "💻",
    Write: "📝",
    Grep: "🔍",
    Glob: "📁"
  }
  
  return (
    <div className="tool-use">
      <div className="tool-header">
        <span className="icon">{icons[block.name]}</span>
        <span className="name">{block.name}</span>
        {getToolDescription(block)}
      </div>
      {result && (
        <div className="tool-result">
          {renderToolResult(block.name, result)}
        </div>
      )}
    </div>
  )
}

function getToolDescription(block) {
  switch (block.name) {
    case "Read":
      return <span>Reading {block.input.file_path}</span>
    case "Edit":
      return <span>Editing {block.input.file_path}</span>
    case "Bash":
      return <span>{block.input.description || "Running command"}</span>
    // etc.
  }
}
```

#### 3. Progressive Tool Result Display
```jsx
function renderToolResult(toolName, result) {
  switch (toolName) {
    case "Read":
      return (
        <CodeBlock 
          language={getLanguageFromPath(result.file_path)}
          code={result.content}
          showLineNumbers={true}
        />
      )
    
    case "Bash":
      return (
        <Terminal>
          <pre>{result.output}</pre>
        </Terminal>
      )
    
    case "Edit":
      return (
        <DiffView
          before={result.old_string}
          after={result.new_string}
          file={result.file_path}
        />
      )
  }
}
```

### Real-Time UI Updates

#### Message Layout
```
┌─────────────────────────────────────────────────────────────────┐
│ LIN-123: Fix authentication bug                                 │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 👤 Connor: @claude fix the auth bug where special chars fail │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ 🤖 Claude: I'll help you fix that authentication bug.       │ │
│ │                                                             │ │
│ │ Let me first examine the authentication code...             │ │
│ │                                                             │ │
│ │ 📄 Reading src/auth/login.js                               │ │
│ │ ┌─────────────────────────────────────────────────────┐   │ │
│ │ │ 45 | function validatePassword(password) {          │   │ │
│ │ │ 46 |   const validPassword = /^[a-zA-Z0-9]+$/      │   │ │
│ │ │ 47 |   return validPassword.test(password)         │   │ │
│ │ └─────────────────────────────────────────────────────┘   │ │
│ │                                                             │ │
│ │ I found the issue. The regex is too restrictive...         │ │
│ │                                                             │ │
│ │ ✏️ Editing src/auth/login.js                               │ │
│ │ ┌─────────────────────────────────────────────────────┐   │ │
│ │ │ - const validPassword = /^[a-zA-Z0-9]+$/            │   │ │
│ │ │ + const validPassword = /^.{8,}$/                   │   │ │
│ │ └─────────────────────────────────────────────────────┘   │ │
│ │                                                             │ │
│ │ 💻 Running tests                                           │ │
│ │ ┌─────────────────────────────────────────────────────┐   │ │
│ │ │ $ npm test auth.test.js                             │   │ │
│ │ │ ✓ All tests passing (15/15)                        │   │ │
│ │ └─────────────────────────────────────────────────────┘   │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ 📊 Cost: $0.023 • Tokens: 1,234 • Duration: 45s                │
└─────────────────────────────────────────────────────────────────┘
```

### Streaming State Management

```javascript
class IssueStreamState {
  constructor(issueId) {
    this.issueId = issueId
    this.messages = []
    this.currentMessage = null
    this.activeBlocks = new Map()
    this.streamingBlockId = null
  }
  
  handleStreamEvent(event) {
    if (event.type === "message_start") {
      this.currentMessage = {
        id: event.message.id,
        role: event.message.role,
        content: [],
        timestamp: new Date()
      }
    }
    
    if (event.type === "content_block_start") {
      const block = {
        id: event.index,
        type: event.content_block.type,
        content: "",
        streaming: true
      }
      
      if (event.content_block.type === "tool_use") {
        block.name = event.content_block.name
        block.input = {}
      }
      
      this.activeBlocks.set(event.index, block)
      this.streamingBlockId = event.index
    }
    
    if (event.type === "content_block_delta") {
      const block = this.activeBlocks.get(event.index)
      
      if (event.delta.type === "text_delta") {
        block.content += event.delta.text
      } else if (event.delta.type === "input_json_delta") {
        // Accumulate JSON for tool inputs
        block.jsonBuffer = (block.jsonBuffer || "") + event.delta.partial_json
      }
    }
    
    if (event.type === "content_block_stop") {
      const block = this.activeBlocks.get(event.index)
      block.streaming = false
      
      if (block.jsonBuffer) {
        block.input = JSON.parse(block.jsonBuffer)
        delete block.jsonBuffer
      }
      
      this.currentMessage.content.push(block)
      this.activeBlocks.delete(event.index)
    }
    
    if (event.type === "message_stop") {
      this.messages.push(this.currentMessage)
      this.currentMessage = null
    }
  }
}
```

### Special Rendering Cases

#### 1. Thinking Blocks (Hidden by Default)
```jsx
function ThinkingBlock({ block, showThinking }) {
  if (!showThinking) return null
  
  return (
    <div className="thinking-block muted">
      <details>
        <summary>Claude's thinking process</summary>
        <div className="thinking-content">
          {block.text}
        </div>
      </details>
    </div>
  )
}
```

#### 2. Web Search Results
```jsx
function WebSearchBlock({ citations }) {
  return (
    <div className="web-search-results">
      {citations.map(citation => (
        <div key={citation.data.url} className="citation">
          <a href={citation.data.url} target="_blank">
            {citation.data.title}
          </a>
          <p>{citation.data.snippet}</p>
        </div>
      ))}
    </div>
  )
}
```

#### 3. Error States
```jsx
function ErrorBlock({ error }) {
  return (
    <div className="error-block">
      <span className="error-icon">⚠️</span>
      <span className="error-message">{error.message}</span>
      {error.details && (
        <details>
          <summary>Details</summary>
          <pre>{error.details}</pre>
        </details>
      )}
    </div>
  )
}
```

### Performance Considerations

1. **Virtual Scrolling**: For long conversation histories
2. **Debounced Updates**: Batch streaming updates every 16ms
3. **Lazy Loading**: Load tool results on demand
4. **Memory Management**: Limit stored messages per issue

```javascript
const UPDATE_THROTTLE_MS = 16 // 60fps
const MAX_MESSAGES_IN_MEMORY = 1000

class StreamRenderer {
  constructor() {
    this.pendingUpdates = new Map()
    this.updateTimer = null
  }
  
  queueUpdate(issueId, update) {
    if (!this.pendingUpdates.has(issueId)) {
      this.pendingUpdates.set(issueId, [])
    }
    
    this.pendingUpdates.get(issueId).push(update)
    
    if (!this.updateTimer) {
      this.updateTimer = setTimeout(() => {
        this.flushUpdates()
      }, UPDATE_THROTTLE_MS)
    }
  }
  
  flushUpdates() {
    for (const [issueId, updates] of this.pendingUpdates) {
      this.renderUpdates(issueId, updates)
    }
    
    this.pendingUpdates.clear()
    this.updateTimer = null
  }
}
```

## Summary

This specification provides a comprehensive framework for rendering Claude Code messages in the UI with:

1. **Full schema understanding** of all message types
2. **Progressive rendering** for streaming content
3. **Rich tool visualization** for different tool types
4. **Performance optimization** for smooth updates
5. **Clear visual hierarchy** for readability

The implementation should handle all edge cases including partial JSON streaming, tool result rendering, and error states while maintaining a responsive UI.