import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit } from 'claude-code'

import type { LastReply, Usage, Window } from '../types'

const CACHE_TTL_MS = 60 * 60 * 1000
const CACHE_WARN_MS = 5 * 60 * 1000

const AMBER = '#F2B35E'
const RED = '#FF8A7A'

const usage = atom({ plugin: 'usage-row', key: 'usage' } as const, { tokens: null, fiveHour: null })
const lastRequestAt = atom({ plugin: 'usage-row', key: 'lastRequestAt' } as const, null)
const lastReply = atom({ plugin: 'usage-row', key: 'lastReply' } as const, null)
const clockNow = atom({ plugin: 'usage-row', key: 'now' } as const, 0)

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

function toUsage(tokens: number | undefined, limits: SessionRateLimit[]): Usage {
  return { tokens: tokens ?? null, fiveHour: toWindow(limits, 'five_hour') }
}

function limitColor(w: Window | null): string | undefined {
  if (!w) return undefined
  if (w.percent >= 90) return RED
  if (w.percent >= 75) return AMBER
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const now = await $.session.usage()
    await update($, usage, () => toUsage(now.context.tokens, now.rateLimits))
    $.clock.every(1000, async () => {
      const at = await $.clock.now()
      await update($, clockNow, () => at)
    })
    return next(e)
  })

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

    const { Box, Text } = $.ui.resolve(e)
    const u = await read($, usage)
    const now = (await read($, clockNow)) || (await $.clock.now())
    const resetMs = u.fiveHour?.resetsAt != null ? u.fiveHour.resetsAt - now : null
    const sep = <Text dimColor>{' │ '}</Text>

    return (
      <Box flexDirection="column">
        {below}
        <Box flexDirection="row" justifyContent="flex-end">
          <Text mono tabular wrap="truncate">
            <Text>{formatTokens(u.tokens).padStart(5)}</Text>
            {sep}
            <Text dimColor>5h </Text>
            <Text color={limitColor(u.fiveHour)}>{(u.fiveHour ? `${Math.round(u.fiveHour.percent)}%` : '--').padStart(4)}</Text>
            {sep}
            <Text dimColor>↻ </Text>
            <Text>{(resetMs === null ? '--' : formatCountdown(resetMs)).padStart(5)}</Text>
          </Text>
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
