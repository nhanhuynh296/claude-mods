import { atom, read, update } from 'claude-code'
import type { AgentInfo, AgentStatus, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { LastReply, Task, Usage, Window } from '../types'

const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_WARN_MS = 5 * 60 * 1000

const TASK_LABEL_MAX = 24
const TASK_TYPE_SUBAGENT = 'subagent'
const LIVE_AGENT: readonly AgentStatus[] = ['pending', 'running', 'waiting']

// Theme keys: the surface picks each one's light or dark shade, so text
// keeps its contrast on either background.
type Level = 'success' | 'warning' | 'error'
const LIMIT_LABEL = 'permission'
const RESET = 'suggestion'
const TASKS = 'warning'

// An SVG reads no theme: mid shades that hold on light and dark alike.
const RING_HEX: Record<Level, string> = { success: '#1F9D55', warning: '#D97706', error: '#DC2626' }
const RING_TRACK = '#80808066'

const RING_PX = 14
const RING_GLYPHS = ['○', '◔', '◑', '◕', '●'] as const

const usage = atom({ plugin: 'usage-row', key: 'usage' } as const, { tokens: null, window: null, contextPercent: null, fiveHour: null })
const lastRequestAt = atom({ plugin: 'usage-row', key: 'lastRequestAt' } as const, null)
const lastReply = atom({ plugin: 'usage-row', key: 'lastReply' } as const, null)
const clockNow = atom({ plugin: 'usage-row', key: 'now' } as const, 0)
const tasks = atom({ plugin: 'usage-row', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'usage-row', key: 'agents' } as const, [])

type TaskSummary = { id: string; type: string; status: string; description: string; command?: string; name?: string }

const clip = (s: string) => (s.length > TASK_LABEL_MAX ? `${s.slice(0, TASK_LABEL_MAX - 1)}…` : s)

// The Stop snapshot of background work. Subagents come live from
// `$.agent.list()` instead, so they are left out here.
export function toTasks(summaries: readonly TaskSummary[] | undefined): Task[] {
  return (summaries ?? [])
    .filter(t => t.type !== TASK_TYPE_SUBAGENT)
    .map(t => ({ id: t.id, type: t.type, label: clip(t.name || t.description || t.command || t.type) }))
}

export function toAgentTasks(list: readonly AgentInfo[]): Task[] {
  return list
    .filter(a => LIVE_AGENT.includes(a.status))
    .map(a => ({ id: a.id, type: TASK_TYPE_SUBAGENT, label: clip(a.description || a.type) }))
}

// The first task by name, the rest as a count, so the row stays one line.
export function tasksLabel(list: readonly Task[]): string {
  const [first, ...rest] = list
  if (!first) return ''
  return rest.length > 0 ? `${first.label} +${rest.length}` : first.label
}

const sameTasks = (a: readonly Task[], b: readonly Task[]) =>
  a.length === b.length && a.every((t, i) => t.id === b[i]?.id && t.label === b[i]?.label)

export function formatTokens(n: number | null): string {
  if (n === null) return '--'
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${parseFloat((n / 1_000_000).toFixed(2))}M`
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

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// Whether a drawn reply block is the main thread's last reply. Surfaces name a
// block by the API message id (`msg_…-t0`), not the transcript row, so the
// text is what ties them: the last block of the reply ends the stored text.
export function isLastReply(drawnText: string, last: LastReply | null): boolean {
  if (!last) return false
  const drawn = norm(drawnText)
  return drawn.length > 0 && (drawn === last.text || last.text.endsWith(drawn))
}

function toWindow(limits: SessionRateLimit[], kind: string): Window | null {
  const found = limits.find(l => l.kind === kind)
  if (!found) return null
  const resetsAt = found.resetsAt ? Date.parse(found.resetsAt) : NaN
  return { percent: found.percentUsed, resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
}

function toUsage(context: SessionContextUsage, limits: SessionRateLimit[]): Usage {
  return {
    tokens: context.tokens ?? null,
    window: context.window,
    contextPercent: context.percent ?? null,
    fiveHour: toWindow(limits, 'five_hour'),
  }
}

// Green while there is room, amber from 75%, red from 90%.
export function levelColor(percent: number | null): Level | undefined {
  if (percent === null) return undefined
  if (percent >= 90) return 'error'
  if (percent >= 75) return 'warning'
  return 'success'
}

// A quarter-step ring glyph for the terminal, which draws no SVG.
export function ringGlyph(percent: number | null): string {
  if (percent === null) return RING_GLYPHS[0]
  const step = Math.min(RING_GLYPHS.length - 1, Math.round((percent / 100) * (RING_GLYPHS.length - 1)))
  return RING_GLYPHS[step] ?? RING_GLYPHS[0]
}

// The ring as SVG: a dim track and an arc from 12 o'clock, clockwise. The
// arc's pathLength of 100 makes its dash the percent itself; at 0 it is left
// out, as its round cap would still draw a dot.
export function ringSvg(percent: number | null, color: string): string {
  const filled = Math.round(Math.max(0, Math.min(100, percent ?? 0)))
  const ring = 'cx="8" cy="8" r="6"'
  const arc = filled > 0
    ? `<circle ${ring} stroke="${color}" stroke-linecap="round" pathLength="100" stroke-dasharray="${filled} 100" transform="rotate(-90 8 8)"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="2.5"><circle ${ring} stroke="${RING_TRACK}"/>${arc}</svg>`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.session.usage()
    await update($, usage, () => toUsage(now.context, now.rateLimits))
    $.clock.every(1000, async () => {
      const at = await $.clock.now()
      await update($, clockNow, () => at)
      const live = toAgentTasks(await $.agent.list())
      await update($, agents, prev => (sameTasks(prev, live) ? prev : live))
    })
    return next(e)
  })

  // Each turn end lists the background work still in flight.
  on('classic.Stop', async ($, e, next) => {
    await update($, tasks, () => toTasks(e.background_tasks))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => toUsage(e.context, e.rateLimits))
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
      .map(b => b as { type: string; text?: string })
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text ?? '')
      .join('\n')
    if (norm(text)) {
      try {
        const reply: LastReply = { id: stored.uuid ?? e.uuid, text: norm(text) }
        await update($, lastReply, () => reply)
      } catch {
        // The row is stored either way; a missed countdown is all that is lost.
      }
    }
    return stored
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    if (e.props.hasSurvey) return below

    const elements = $.ui.resolve(e)
    const { Box, Text } = elements
    // The terminal's table names Svg too but draws it as an empty box.
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined
    const u = await read($, usage)
    const now = (await read($, clockNow)) || (await $.clock.now())
    const resetMs = u.fiveHour?.resetsAt != null ? u.fiveHour.resetsAt - now : null
    const running = [...(await read($, tasks)), ...(await read($, agents))]
    const sep = <Text dimColor>{' │ '}</Text>
    // State kept from before 0.4.0 has no window or percent.
    const ctxPercent = u.contextPercent ?? null
    const ctxColor = levelColor(ctxPercent) ?? 'success'
    const ctxLabel = ctxPercent === null ? '--' : `${ctxPercent}%`

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" gap={1}>
            {Svg ? (
              <Svg source={ringSvg(ctxPercent, RING_HEX[ctxColor])} alt={`Context ${ctxLabel} used`} width={RING_PX} height={RING_PX} />
            ) : (
              <Text color={ctxColor}>{ringGlyph(ctxPercent)}</Text>
            )}
            <Text mono tabular wrap="truncate">
              <Text color={ctxColor} bold>{ctxLabel.padStart(4)}</Text>
              <Text>{` ${formatTokens(u.tokens)}/${formatTokens(u.window ?? null)}`}</Text>
              {sep}
              <Text color={LIMIT_LABEL} bold>5h </Text>
              <Text color={levelColor(u.fiveHour?.percent ?? null)}>{(u.fiveHour ? `${Math.round(u.fiveHour.percent)}%` : '--').padStart(4)}</Text>
              {sep}
              <Text color={RESET} bold>↻ </Text>
              <Text color={RESET}>{(resetMs === null ? '--' : formatCountdown(resetMs)).padStart(5)}</Text>
            </Text>
          </Box>
          {running.length > 0 && (
            <Text wrap="truncate">
              <Text color={TASKS} bold>{`◉ ${running.length} `}</Text>
              <Text>{tasksLabel(running)}</Text>
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  // The prompt-cache countdown, as a last line of the main thread's last reply.
  // It rewrites the block's text, so each surface draws the reply its own way.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (!isLastReply(e.props.text, await read($, lastReply))) return next(e)
    const at = await read($, lastRequestAt)
    if (at === null) return next(e)

    const now = (await read($, clockNow)) || (await $.clock.now())
    const left = at + CACHE_TTL_MS - now
    const label = left > 0 ? formatCountdown(left).padStart(5) : ' cold'
    const warn = left > 0 && left < CACHE_WARN_MS ? ' · expiring' : ''
    const line = '`◷ cache ' + label + '`' + warn
    return next({ ...e, props: { ...e.props, text: e.props.text + '\n\n' + line } })
  })
}
