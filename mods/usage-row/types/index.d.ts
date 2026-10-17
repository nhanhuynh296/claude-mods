export type Window = { percent: number; resetsAt: number | null }
export type Usage = { tokens: number | null; fiveHour: Window | null }
export type LastReply = { id: string; text: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-row': {
      usage: Usage
      lastRequestAt: number | null
      lastReply: LastReply | null
      now: number
    }
  }
}
