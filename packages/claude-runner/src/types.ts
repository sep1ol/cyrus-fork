import type { SDKMessage } from '@anthropic-ai/claude-code'

export interface ClaudeRunnerConfig {
  workingDirectory?: string
  allowedTools?: string[]
  allowedDirectories?: string[]
  continueSession?: boolean
  workspaceName?: string
  maxTurns?: number
  systemPrompt?: string
  onMessage?: (message: SDKMessage) => void
  onError?: (error: Error) => void
  onComplete?: (messages: SDKMessage[]) => void
}

export interface ClaudeSessionInfo {
  sessionId: string
  startedAt: Date
  isRunning: boolean
}

export interface ClaudeRunnerEvents {
  'message': (message: SDKMessage) => void
  'assistant': (content: string) => void
  'tool-use': (toolName: string, input: any) => void
  'text': (text: string) => void
  'end-turn': (lastText: string) => void
  'error': (error: Error) => void
  'complete': (messages: SDKMessage[]) => void
}

// Re-export SDK types for convenience
export type { SDKMessage } from '@anthropic-ai/claude-code'