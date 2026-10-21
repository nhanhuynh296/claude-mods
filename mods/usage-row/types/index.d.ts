export type Window = { percent: number; resetsAt: number | null }
export type Usage = { tokens: number | null; window: number | null; contextPercent: number | null; fiveHour: Window | null }
export type LastReply = { id: string; text: string }
export type Task = { id: string; type: string; label: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-row': {
      usage: Usage
      lastRequestAt: number | null
      lastReply: LastReply | null
      now: number
      tasks: Task[]
      agents: Task[]
    }
  }
}
