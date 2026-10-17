import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderNode, SessionRateLimit, Space } from 'claude-code'

import type { AgentRun, AgentState, LastReply, Task, TaskStatus, Usage, View, Window } from '../types'

const PANE = 'orchestrator'
const PANE_TITLE = 'Tasks & agents'
const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_WARN_MS = 5 * 60 * 1000
const SHARE_OF_WINDOW = 0.4 // the band never takes more than this much of the window

const AMBER = '#F2B35E'
const RED = '#FF8A7A'

const tasks = atom({ plugin: 'orchestrator-band', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'orchestrator-band', key: 'agents' } as const, [])
const view = atom({ plugin: 'orchestrator-band', key: 'view' } as const, 'peek')
const isPinned = atom({ plugin: 'orchestrator-band', key: 'isPinned' } as const, false)
const usage = atom({ plugin: 'orchestrator-band', key: 'usage' } as const, { tokens: null, fiveHour: null })
const lastRequestAt = atom({ plugin: 'orchestrator-band', key: 'lastRequestAt' } as const, null)
const lastReply = atom({ plugin: 'orchestrator-band', key: 'lastReply' } as const, null)
const clockNow = atom({ plugin: 'orchestrator-band', key: 'now' } as const, 0)

// ── formatting ──────────────────────────────────────────────────────────────

export function formatTokens(n: number | null): string {
  if (n === null) return '--'
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

const two = (n: number) => String(n).padStart(2, '0')

// 2h14m from an hour up; mm:ss below it.
export function formatCountdown(ms: number): string {
  if (ms <= 0) return 'now'
  const total = Math.ceil(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (hours > 0) return `${hours}h${two(minutes)}m`
  return `${two(minutes)}:${two(total % 60)}`
}

// 42s, 2m14s, 1h05m; padded so a ticking value never moves its neighbours.
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`.padStart(6)
  if (s < 3600) return `${Math.floor(s / 60)}m${two(s % 60)}s`.padStart(6)
  return `${Math.floor(s / 3600)}h${two(Math.floor((s % 3600) / 60))}m`.padStart(6)
}

function toWindow(limits: SessionRateLimit[], kind: string): Window | null {
  const found = limits.find(l => l.kind === kind)
  if (!found) return null
  const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : NaN
  return { percent: found.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
}

function toUsage(tokens: number | undefined, limits: SessionRateLimit[]): Usage {
  return { tokens: tokens ?? null, fiveHour: toWindow(limits, 'five_hour') }
}

function limitColor(w: Window | null): string | undefined {
  if (!w) return undefined
  if (w.percent >= 90) return RED
  if (w.percent >= 75) return AMBER
  return undefined
}

const basename = (p: unknown) => String(p ?? '').split('/').pop() ?? ''
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// One line saying what an agent is doing: `Edit session.ts`, `Bash npm test`.
export function describeAction(tool: string, args: Record<string, unknown>): string {
  const name = tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool
  if (args.file_path !== undefined) return `${name} ${basename(args.file_path)}`
  if (args.notebook_path !== undefined) return `${name} ${basename(args.notebook_path)}`
  if (typeof args.command === 'string') return `${name} ${clip(args.command.split('\n')[0] ?? '', 48)}`
  if (typeof args.pattern === 'string') return `${name} ${clip(args.pattern, 40)}`
  if (typeof args.query === 'string') return `${name} ${clip(args.query, 40)}`
  if (typeof args.url === 'string') return `${name} ${clip(args.url.replace(/^https?:\/\//, ''), 40)}`
  if (typeof args.description === 'string') return `${name} ${clip(args.description, 40)}`
  return name
}

// ── task lists the model keeps ──────────────────────────────────────────────

const asStatus = (s: unknown): TaskStatus =>
  s === 'completed' || s === 'in_progress' ? s : 'pending'

export function fromTodos(todos: ReadonlyArray<{ content: string; status: string }>): Task[] {
  return todos.map((t, i) => ({
    id: String(i + 1),
    title: t.content,
    status: asStatus(t.status),
    owner: null,
    blockedBy: [],
  }))
}

type PlanArgs = {
  items?: ReadonlyArray<{ content?: string; status?: string }>
  advance?: boolean
  done?: ReadonlyArray<number>
  start?: number
}

// The desktop app's own task list (`update_plan`): a whole list, or a step.
export function applyPlan(list: Task[], args: PlanArgs): Task[] {
  let next = list
  if (Array.isArray(args.items)) {
    next = args.items.map((it, i) => ({
      id: String(i + 1),
      title: String(it.content ?? ''),
      status: asStatus(it.status),
      owner: null,
      blockedBy: [],
    }))
  }
  if (args.advance) {
    const current = next.findIndex(t => t.status === 'in_progress')
    const after = next.findIndex((t, i) => i > current && t.status === 'pending')
    next = next.map((t, i) =>
      i === current ? { ...t, status: 'completed' } : i === after ? { ...t, status: 'in_progress' } : t,
    )
  }
  if (Array.isArray(args.done)) {
    next = next.map((t, i) => (args.done?.includes(i + 1) ? { ...t, status: 'completed' } : t))
  }
  if (typeof args.start === 'number') {
    next = next.map((t, i) => (i + 1 === args.start ? { ...t, status: 'in_progress' } : t))
  }
  return next
}

export function taskIdFrom(text: string): string | null {
  const m = /#(\d+)/.exec(text) ?? /"id"\s*:\s*"?([\w-]+)/.exec(text) ?? /\btask\s+(\d+)/i.exec(text)
  return m?.[1] ?? null
}

// ── which agent works which task ────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

function agentsFor(task: Task, list: AgentRun[]): AgentRun[] {
  return list.filter(a => {
    if (task.owner && (norm(task.owner) === norm(a.label) || task.owner === a.id)) return true
    const title = norm(task.title)
    const label = norm(a.label)
    return label.length > 3 && (title.includes(label) || label.includes(title))
  })
}

// ── the module ──────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tracker', description: 'Pin or unpin the tasks-and-agents pane' })
    const now = await $.session.usage()
    await update($, usage, () => toUsage(now.context.tokens, now.rateLimits))
    if (await read($, isPinned)) void $.ui.open({ id: PANE, title: PANE_TITLE })

    let ticks = 0
    $.clock.every(1000, async () => {
      const at = await $.clock.now()
      await update($, clockNow, () => at)
      ticks += 1
      if (ticks % 3 !== 0) return
      // The engine's word on each agent we track, and any we missed.
      const listed = await $.agent.list()
      await update($, agents, list => {
        const known = new Map(list.map(a => [a.id, a]))
        for (const info of listed) {
          const state = info.status === 'completed' ? 'done'
            : info.status === 'failed' || info.status === 'killed' ? 'failed'
            : 'running'
          const had = known.get(info.id)
          if (had) {
            if (had.state === 'running' && state !== 'running') known.set(info.id, { ...had, state, endedAt: at })
          } else if (state === 'running') {
            known.set(info.id, {
              id: info.id, label: info.name ?? info.description, type: info.type, model: null,
              startedAt: at, endedAt: null, state, lastAction: null,
            })
          }
        }
        return [...known.values()]
      })
    })

    return next(e)
  })

  on('command.run', { command: 'tracker' }, async $ => {
    if (await read($, isPinned)) {
      await $.ui.close({ id: PANE })
      return { text: 'Tracker unpinned.' }
    }
    await update($, isPinned, () => true)
    await $.ui.open({ id: PANE, title: PANE_TITLE })
    return { text: 'Tracker pinned to the side pane.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, isPinned, () => false)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context.tokens, e.rateLimits))
    return next(e)
  })

  // Each main-thread request reads, and so refreshes, the prompt cache.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const at = await $.clock.now()
      await update($, lastRequestAt, () => at)
    }
    return yield* next(e)
  })

  // The last reply of the main thread: where the cache countdown is drawn.
  on('session.append', async ($, e, next) => {
    const stored = await next(e)
    if (e.door !== 'response' || e.agentId || e.message.role !== 'assistant') return stored
    const text = e.message.content
      .map(b => (b as { type: string; text?: string }))
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text ?? '')
      .join('\n')
      .trim()
    if (text) {
      try {
        const reply: LastReply = { id: stored.uuid ?? e.uuid, text }
        await update($, lastReply, () => reply)
      } catch {
        // The row is stored either way; a missed countdown is all that is lost.
      }
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    if (spawned.agentId) {
      const at = await $.clock.now()
      const run: AgentRun = {
        id: spawned.agentId,
        label: e.description || e.subagentType,
        type: e.subagentType,
        model: spawned.model ?? null,
        startedAt: at,
        endedAt: null,
        state: 'running',
        lastAction: null,
      }
      await update($, agents, list => [...list.filter(a => a.id !== run.id), run].slice(-40))
    }
    return spawned
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId) {
      const at = await $.clock.now()
      const state: AgentState = e.isAborted ? 'failed' : 'done'
      await update($, agents, list =>
        list.map(a => (a.id === e.agentId && a.state === 'running' ? { ...a, state, endedAt: at } : a)),
      )
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const args = e as unknown as Record<string, unknown>

    if (e.agentId) {
      const action = describeAction(tool, args)
      await update($, agents, list => list.map(a => (a.id === e.agentId ? { ...a, lastAction: action } : a)))
      return next(e)
    }

    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    if (tool === 'TodoWrite' && Array.isArray(args.todos)) {
      const list = fromTodos(args.todos as Array<{ content: string; status: string }>)
      await update($, tasks, () => list)
    } else if (tool.endsWith('__update_plan')) {
      await update($, tasks, list => applyPlan(list, args as PlanArgs))
    } else if (tool === 'TaskCreate') {
      const said = `${ran.text ?? ''} ${JSON.stringify(ran.result ?? '')}`
      await update($, tasks, list => [
        ...list,
        {
          id: taskIdFrom(said) ?? String(list.length + 1),
          title: String(args.subject ?? ''),
          status: 'pending' as const,
          owner: null,
          blockedBy: [],
        },
      ])
    } else if (tool === 'TaskUpdate') {
      const id = String(args.taskId ?? '')
      await update($, tasks, list =>
        args.status === 'deleted'
          ? list.filter(t => t.id !== id)
          : list.map(t =>
              t.id !== id ? t : {
                ...t,
                status: args.status === undefined ? t.status : asStatus(args.status),
                title: typeof args.subject === 'string' ? args.subject : t.title,
                owner: typeof args.owner === 'string' ? args.owner : t.owner,
                blockedBy: Array.isArray(args.addBlockedBy)
                  ? [...new Set([...t.blockedBy, ...(args.addBlockedBy as string[])])]
                  : t.blockedBy,
              },
            ),
      )
    }
    return ran
  }).catch(($, e, next) => next(e))

  // ── drawing ───────────────────────────────────────────────────────────────

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const taskList = await read($, tasks)
    const agentList = await read($, agents)
    const mode: View = await read($, view)
    const pinned = await read($, isPinned)
    const u = await read($, usage)
    const now = (await read($, clockNow)) || (await $.clock.now())

    const running = agentList.filter(a => a.state === 'running')
    const done = taskList.filter(t => t.status === 'completed').length
    const hasWork = taskList.length > 0 || running.length > 0
    const resetMs = u.fiveHour?.resetsAt != null ? u.fiveHour.resetsAt - now : null

    const sep = <Text dimColor>{' │ '}</Text>
    const usageLine = (
      <Text mono tabular wrap="truncate">
        <Text>{formatTokens(u.tokens).padStart(5)}</Text>
        {sep}
        <Text dimColor>5h </Text>
        <Text color={limitColor(u.fiveHour)}>{(u.fiveHour ? `${Math.round(u.fiveHour.percent)}%` : '--').padStart(4)}</Text>
        {sep}
        <Text dimColor>↻ </Text>
        <Text>{(resetMs === null ? '--' : formatCountdown(resetMs)).padStart(5)}</Text>
      </Text>
    )

    const toggle = () => update($, view, v => (v === 'peek' ? 'expanded' : 'peek'))
    const chevron = pinned ? '⇥' : mode === 'expanded' ? '⌄' : '⌃'
    const row = (
      <Box key="row" flexDirection="row" justifyContent="space-between" columnGap={2}>
        {hasWork ? (
          <Box flexDirection="row" alignItems="center" columnGap="md">
            <Button key="toggle" plain onPress={pinned ? () => $.ui.open({ id: PANE, title: PANE_TITLE }) : toggle}>
              {running.length > 0 ? '◐ ' : '○ '}
              {`${running.length} running`}
              <Text dimColor> · </Text>
              <Text mono tabular>{`${done}/${taskList.length}`}</Text>
              <Text dimColor>{` ${chevron}`}</Text>
            </Button>
            {!pinned && mode === 'expanded' && (
              <Button key="pin" plain dimColor onPress={() => pin($)}>
                <Text dimColor>Pin to side</Text>
              </Button>
            )}
          </Box>
        ) : (
          <Text> </Text>
        )}
        {usageLine}
      </Box>
    )

    if (!hasWork || pinned) {
      return <Box flexDirection="column">{below}{row}</Box>
    }

    const windowRows = e.viewport?.rows ? Math.floor(e.viewport.rows * SHARE_OF_WINDOW) : e.props.maxRows
    const budget = Math.max(3, Math.min(e.props.maxRows, windowRows) - 1)
    const els = { Box, Text, Button, sp: spacingFor(e.surface) }
    const body =
      mode === 'expanded'
        ? drawFull($, els, taskList, agentList, now, budget, true)
        : drawPeek($, els, taskList, running, now, budget)

    return (
      <Box flexDirection="column" rowGap={spacingFor(e.surface).row}>
        {below}
        {body}
        {row}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const taskList = await read($, tasks)
    const agentList = await read($, agents)
    const now = (await read($, clockNow)) || (await $.clock.now())
    const els = { Box, Text, Button, sp: spacingFor(e.surface) }
    const running = agentList.filter(a => a.state === 'running').length
    const done = taskList.filter(t => t.status === 'completed').length

    return (
      <Box flexDirection="column" rowGap="sm">
        <Box flexDirection="row" justifyContent="space-between">
          <Text mono tabular dimColor>
            {`${done}/${taskList.length} done`}
            {' │ '}
            {`${running} running`}
          </Text>
          <Button key="unpin" label="Unpin" plain onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {taskList.length === 0 && agentList.length === 0 ? (
          <Text dimColor>No tasks or agents yet.</Text>
        ) : (
          drawFull($, els, taskList, agentList, now, Infinity, false)
        )}
      </Box>
    )
  })

  // The prompt-cache countdown, under the main thread's last reply.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const last = await read($, lastReply)
    if (!last) return next(e)
    const isLast = e.requestId === last.id || e.props.text.trim() === last.text
    if (!isLast) return next(e)
    const at = await read($, lastRequestAt)
    if (at === null) return next(e)

    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const now = (await read($, clockNow)) || (await $.clock.now())
    const left = at + CACHE_TTL_MS - now
    const isWarm = left > 0

    return (
      <Box flexDirection="column">
        {drawn}
        <Text mono tabular dimColor={!isWarm || left >= CACHE_WARN_MS} color={isWarm && left < CACHE_WARN_MS ? AMBER : undefined}>
          {`◷ cache ${isWarm ? formatCountdown(left).padStart(5) : ' cold'}`}
        </Text>
      </Box>
    )
  })
}

// ── trees ─────────────────────────────────────────────────────────────────────

// The surface's own element constructors, as `$.ui.resolve(e)` handed them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Draw = { Box: any; Text: any; Button: any; sp: Spacing }

// Desktop matches its own task list's rhythm; the terminal stays tight, as
// every step there costs a whole row.
type Spacing = { row: Space; col: Space; padX: Space; padY: Space }
export function spacingFor(surface: string): Spacing {
  return surface === 'terminal' || surface === 'vscode'
    ? { row: 'xs', col: 'sm', padX: 'sm', padY: 'xs' }
    : { row: 'md', col: 'md', padX: 'lg', padY: 'md' }
}
type Dollar = EngineInterface

function stopAgent($: Dollar, id: string) {
  return () => {
    void $.tool.call({ tool: 'TaskStop', task_id: id })
  }
}

// One line of the list: a glyph in a fixed gutter, so titles line up.
function line({ Box, Text, sp }: Draw, key: string, glyph: string, title: RenderNode, opts: { dim?: boolean; strong?: boolean; tail?: string } = {}): RenderNode {
  return (
    <Box key={key} flexDirection="row" columnGap={sp.col}>
      <Box width={2} flexShrink={0}><Text dimColor={opts.dim}>{glyph}</Text></Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor={opts.dim} weight={opts.strong ? 'medium' : undefined} wrap="truncate">{title}</Text>
      </Box>
      {opts.tail !== undefined && <Text dimColor mono tabular>{opts.tail}</Text>}
    </Box>
  )
}

function agentCard($: Dollar, els: Draw, a: AgentRun, now: number, title: string | null): RenderNode {
  const { Box, Text, Button, sp } = els
  const isRunning = a.state === 'running'
  const elapsed = formatElapsed((a.endedAt ?? now) - a.startedAt).trim()
  const detail = isRunning ? a.lastAction ?? a.type : a.state === 'done' ? 'done' : 'stopped'
  const glyph = isRunning ? '◐' : a.state === 'done' ? '✓' : '×'
  return (
    <Box key={`agent-${a.id}`} flexDirection="row" columnGap={sp.col}>
      <Box width={2} flexShrink={0}><Text dimColor={!isRunning}>{title !== null ? glyph : '⎿'}</Text></Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
        {title !== null && <Text weight="medium" wrap="truncate">{title}</Text>}
        <Text mono tabular dimColor wrap="truncate">
          {a.label}
          {' │ '}
          {detail}
        </Text>
      </Box>
      <Text dimColor mono tabular>{elapsed}</Text>
      {isRunning && <Button key={`stop-${a.id}`} label="■" plain onPress={stopAgent($, a.id)} />}
    </Box>
  )
}

const frame = ({ Box, sp }: Draw, key: string, children: RenderNode[]) => (
  <Box key={key} flexDirection="column" rowGap={sp.row} borderStyle="round" borderDimColor paddingX={sp.padX} paddingY={sp.padY}>
    {children}
  </Box>
)

// E: what is running now, and what is next.
function drawPeek($: Dollar, els: Draw, taskList: Task[], running: AgentRun[], now: number, budget: number): RenderNode {
  const rows: RenderNode[] = []
  let used = 0
  for (const a of running) {
    if (used + 2 > budget - 1) break
    const task = taskList.find(t => t.status === 'in_progress' && agentsFor(t, [a]).length > 0)
    rows.push(agentCard($, els, a, now, task?.title ?? a.label))
    used += 2
  }
  if (running.length === 0) {
    for (const t of taskList.filter(t => t.status === 'in_progress')) {
      if (used + 1 > budget - 1) break
      rows.push(line(els, `task-${t.id}`, '◐', t.title, { strong: true }))
      used += 1
    }
  }
  const hidden = running.length - rows.length
  const nextTask = taskList.find(t => t.status === 'pending')
  if (hidden > 0) rows.push(line(els, 'more', '', `+${hidden} more running`, { dim: true }))
  else if (nextTask) {
    const after = nextTask.blockedBy.length ? `after ${nextTask.blockedBy.map(b => `#${b}`).join(', ')}` : undefined
    rows.push(line(els, 'next', '○', `Next: ${nextTask.title}`, { dim: true, tail: after }))
  }
  return frame(els, 'peek', rows)
}

// F, and the pane: every task, the agents under the tasks they work.
// The band folds finished tasks into one line; the pane lists each.
function drawFull($: Dollar, els: Draw, taskList: Task[], agentList: AgentRun[], now: number, budget: number, isBand: boolean): RenderNode {
  const { Box, Text, sp } = els
  type Item = { rows: number; node: RenderNode }
  const items: Item[] = []
  const linked = new Set<string>()

  const doneTasks = taskList.filter(t => t.status === 'completed')
  if (isBand && doneTasks.length > 0) {
    const last = doneTasks[doneTasks.length - 1]
    items.push({ rows: 1, node: line(els, 'done', '✓', `${doneTasks.length} done`, { dim: true, tail: last ? clip(last.title, 40) : undefined }) })
  }

  for (const t of taskList) {
    if (t.status === 'completed') {
      if (!isBand) items.push({ rows: 1, node: line(els, `task-${t.id}`, '✓', t.title, { dim: true }) })
    } else if (t.status === 'in_progress') {
      const workers = agentsFor(t, agentList)
      workers.forEach(a => linked.add(a.id))
      items.push({
        rows: 1 + workers.length,
        node: (
          <Box key={`task-${t.id}`} flexDirection="column" rowGap={sp.row}>
            {line(els, `title-${t.id}`, '◐', t.title, { strong: true })}
            {workers.map(a => (
              <Box key={`w-${a.id}`} paddingLeft={3}>{agentCard($, els, a, now, null)}</Box>
            ))}
          </Box>
        ),
      })
    } else {
      const after = t.blockedBy.length ? `after ${t.blockedBy.map(b => `#${b}`).join(', ')}` : undefined
      items.push({ rows: 1, node: line(els, `task-${t.id}`, '○', t.title, { tail: after }) })
    }
  }

  const loose = agentList.filter(a => !linked.has(a.id) && (a.state === 'running' || now - (a.endedAt ?? now) < 10 * 60_000))
  for (const a of loose) items.push({ rows: 2, node: agentCard($, els, a, now, a.label) })

  let shown = items
  let more = 0
  if (shown.reduce((n, it) => n + it.rows, 0) > budget) {
    const kept: Item[] = []
    let used = 0
    for (const it of shown) {
      if (used + it.rows > budget - 1) { more += 1; continue }
      kept.push(it)
      used += it.rows
    }
    shown = kept
  }

  const children = [
    ...shown.map(it => it.node),
    ...(more > 0 ? [<Text key="more" dimColor>{`+${more} more · pin for the full list`}</Text>] : []),
  ]
  return isBand ? frame(els, 'full', children) : <Box key="full" flexDirection="column" rowGap={sp.row}>{children}</Box>
}

async function pin($: Dollar) {
  await update($, isPinned, () => true)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}
