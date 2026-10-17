export type TaskStatus = 'pending' | 'in_progress' | 'completed'
export type Task = { id: string; title: string; status: TaskStatus; owner: string | null; blockedBy: string[] }

export type AgentState = 'running' | 'done' | 'failed'
export type AgentRun = {
  id: string
  label: string
  type: string
  model: string | null
  startedAt: number
  endedAt: number | null
  state: AgentState
  lastAction: string | null
}

export type Window = { percent: number; resetsAt: number | null }
export type Usage = { tokens: number | null; fiveHour: Window | null }
export type LastReply = { id: string; text: string }
export type View = 'peek' | 'expanded'

declare module 'claude-code' {
  interface PluginState {
    'orchestrator-band': {
      tasks: Task[]
      agents: AgentRun[]
      view: View
      isPinned: boolean
      usage: Usage
      lastRequestAt: number | null
      lastReply: LastReply | null
      now: number
    }
  }
}
