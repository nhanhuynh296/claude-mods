import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Register } from 'claude-code'

import { endedTaskIds, formatCountdown, formatTokens, isLastReply, lastReplyOf, levelColor, ringGlyph, ringSvg, showsContent, tasksLabel, toAgentTasks, withTask } from '../hooks/register'

test('countdown shows h/m from an hour, mm:ss below', async () => {
  expect(formatCountdown(2 * 3600_000 + 14 * 60_000)).toBe('2h14m')
  expect(formatCountdown(38 * 60_000 + 12_000)).toBe('38:12')
  expect(formatCountdown(0)).toBe('now')
})

test('tokens format compactly', async () => {
  expect(formatTokens(850)).toBe('850')
  expect(formatTokens(9_840)).toBe('9.8k')
  expect(formatTokens(124_310)).toBe('124k')
  expect(formatTokens(1_020_000)).toBe('1.02M')
  expect(formatTokens(1_000_000)).toBe('1M')
})

test('the row shows tokens, the 5h limit and its reset on terminal and desktop', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'usage-row',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { top: 0, bodyRows: 19 }, view: {} },
    } as never)
    for (const label of [/5h/, /↻/]) {
      expect(await band.find({ type: 'Text', text: label })).toBeDefined()
    }
    expect(await band.find({ type: 'Text', text: /wk|running|ctx/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /◉/ })).toBeUndefined()
    await band.unmount()
  }
})

test('the last reply is found by its text, whatever its id or spacing', async () => {
  const last = { id: 'row-uuid', text: 'First block. Second block ends here.' }
  expect(isLastReply('Second  block\nends here.', last)).toBe(true)
  expect(isLastReply('First block. Second block ends here.', last)).toBe(true)
  expect(isLastReply('Something earlier.', last)).toBe(false)
  expect(isLastReply('   ', last)).toBe(false)
})

const row = (role: 'user' | 'assistant', text: string, handle?: string) => ({ role, text, toolUses: [], handle })

test('the last reply is the newest assistant row with text', async () => {
  const rows = [row('user', 'Fix it'), row('assistant', 'Done.  Tests\npass.', 'h1'), row('assistant', ' '), row('user', 'Thanks')]
  expect(lastReplyOf(rows)).toEqual({ id: 'h1', text: 'Done. Tests pass.' })
  expect(lastReplyOf([row('user', 'Fix it')])).toBeNull()
})

test('the last reply ends with a dim monospace cache countdown, not a code span', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  const turn = { turnId: 't1', index: 0 }
  on('turn.step', async function* () {
    return { ...turn, answer: 'All done.', toolUses: [], stopReason: 'end_turn', usage: null }
  } as never)
  for await (const _ of $.turn.step({ ...turn, model: 'claude-opus-5-5', messageCount: 1 }));
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'All done.' }] }, door: 'response', origin: { kind: 'model', model: 'm' }, uuid: 'r1' } as never)
  await clock.advance(60_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const reply = await $.ui.mount({ plugin: 'usage-row', surface, component: 'AssistantMessage', props: { text: 'All done.', isFirstOfReply: true } } as never)
    const line = await reply.find({ type: 'Text', text: /^cache 59:00$/ })
    expect(line?.props).toMatchObject({ mono: true, dimColor: true })
    expect(await reply.find({ type: 'Text', text: /`/ })).toBeUndefined()
    await reply.unmount()
  }
})

test('a rewind moves the cache countdown to the reply that is now last', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  let rows = [row('user', 'first'), row('assistant', 'First answer.'), row('user', 'second'), row('assistant', 'Second answer.')]
  on('session.turns', () => ({ value: rows.filter(r => r.role === 'user').length }) as never)
  on('session.messages', () => ({ value: rows }) as never)
  on('session.usage', () => ({ value: { context: { tokens: 1000, window: 1_000_000, percent: 0 }, rateLimits: [] } }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  const written: unknown[] = []
  on('state.set', { plugin: 'usage-row', key: 'lastReply' }, ($, e, next) => {
    written.push(e.value)
    return next(e)
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  expect(written.at(-1)).toEqual({ id: '3', text: 'Second answer.' })

  await clock.advance(1000)
  rows = rows.slice(0, 2)
  await clock.advance(1000)
  expect(written.at(-1)).toEqual({ id: '1', text: 'First answer.' })
})

const notification = (id: string, status: string) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_01</tool-use-id>\n<output-file>/tmp/tasks/${id}.output</output-file>\n<status>${status}</status>\n<summary>Background command "dev server" ${status} (exit code 0)</summary>\n</task-notification>`

test('a notification ends its task once completed, failed, killed or stopped', async () => {
  for (const status of ['completed', 'failed', 'killed', 'stopped']) {
    expect(endedTaskIds(notification('b1', status))).toEqual(['b1'])
  }
  expect(endedTaskIds(notification('m1', 'running'))).toEqual([])
  expect(endedTaskIds(`${notification('b1', 'completed')}\n${notification('b2', 'failed')}`)).toEqual(['b1', 'b2'])
  expect(endedTaskIds('An answer that names no task.')).toEqual([])
})

test('a task started again keeps one entry, the newest last', async () => {
  const t = (id: string, label: string) => ({ id, type: 'shell', label })
  expect(withTask([t('b1', 'old'), t('b2', 'tail log')], t('b1', 'npm run dev'))).toEqual([t('b2', 'tail log'), t('b1', 'npm run dev')])
})

test('live agents count while pending, running or waiting', async () => {
  const agent = (id: string, status: string) => ({ id, status, description: `job ${id}`, type: 'Explore' }) as never
  expect(toAgentTasks([agent('1', 'running'), agent('2', 'completed'), agent('3', 'waiting')]).map(t => t.id)).toEqual(['1', '3'])
})

const mountBand = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({
    plugin: 'usage-row',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { top: 0, bodyRows: 19 }, view: {} },
  } as never)

test('a background Bash call shows on the right of the row until its notification', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'npm run dev', description: 'dev server', run_in_background: true } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await mountBand($, surface)
    expect(await band.find({ type: 'Text', text: /◉ 1/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /dev server/ })).toBeDefined()
    await band.unmount()
  }

  await $.session.append({
    message: { type: 'user', role: 'user', content: [{ type: 'text', text: notification('b1', 'completed') }] },
    door: 'prompt',
    origin: { kind: 'task-notification' },
    uuid: 'n1',
  } as never)
  const band = await mountBand($, 'terminal')
  expect(await band.find({ type: 'Text', text: /◉/ })).toBeUndefined()
  await band.unmount()
})

test('a foreground Bash call adds no task, and TaskStop removes one', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } }) as never)
  on('tool.call', { tool: 'Monitor' }, () => ({ result: { taskId: 'm1', timeoutMs: 60_000 } }) as never)
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: { message: 'stopped', task_id: 'm1', task_type: 'monitor' } }) as never)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  await $.tool.call({ tool: 'Monitor', description: 'deploy log', timeout_ms: 60_000 } as never)
  let band = await mountBand($, 'terminal')
  expect(await band.find({ type: 'Text', text: /◉ 1/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /deploy log/ })).toBeDefined()
  await band.unmount()

  await $.tool.call({ tool: 'TaskStop', task_id: 'm1' } as never)
  band = await mountBand($, 'terminal')
  expect(await band.find({ type: 'Text', text: /◉/ })).toBeUndefined()
  await band.unmount()
})

test('three tasks show the first by name and the rest as a count', async () => {
  const t = (id: string, label: string) => ({ id, type: 'shell', label })
  expect(tasksLabel([t('1', 'npm run dev'), t('2', 'tail log'), t('3', 'Explore repo')])).toBe('npm run dev +2')
  expect(tasksLabel([t('1', 'npm run dev')])).toBe('npm run dev')
  expect(tasksLabel([])).toBe('')
})

test('the context ring fills by quarter glyphs on the terminal', async () => {
  expect([null, 0, 20, 50, 80, 100].map(ringGlyph)).toEqual(['○', '○', '◔', '◑', '◕', '●'])
})

test('the context ring is an SVG arc of the used share', async () => {
  const svg = ringSvg(23, '#1F9D55')
  expect(svg).toContain('pathLength="100" stroke-dasharray="23 100"')
  expect(svg).toContain('stroke="#1F9D55"')
  expect(svg.length).toBeLessThanOrEqual(285)
  expect(ringSvg(150, '#1F9D55')).toContain('stroke-dasharray="100 100"')
})

test('an empty context draws the track alone, with no dot', async () => {
  for (const p of [0, null]) {
    expect(ringSvg(p, '#1F9D55')).not.toContain('#1F9D55')
    expect(ringSvg(p, '#1F9D55').match(/<circle/g)).toHaveLength(1)
  }
})

test('levels are green, amber from 75%, red from 90%', async () => {
  expect([null, 10, 75, 90].map(levelColor)).toEqual([undefined, 'success', 'warning', 'error'])
})

test('the band draws an SVG ring on desktop and a glyph ring on the terminal', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { top: 0, bodyRows: 19 }, view: {} }
  const desk = await $.ui.mount({ plugin: 'usage-row', surface: 'desktop', component: 'AbovePrompt', props } as never)
  const deskTree = JSON.stringify(await desk.findAll({}))
  expect(deskTree).toContain('"type":"Svg"')
  expect(deskTree).not.toMatch(/[○◔◑◕●]/)
  await desk.unmount()
  const term = await $.ui.mount({ plugin: 'usage-row', surface: 'terminal', component: 'AbovePrompt', props } as never)
  const termTree = JSON.stringify(await term.findAll({}))
  expect(termTree).toMatch(/[○◔◑◕●]/)
  expect(termTree).not.toContain('"type":"Svg"')
  await term.unmount()
})

test('a tree shows content when it holds text or a control', async () => {
  expect(showsContent({ type: 'Box', children: [] })).toBe(false)
  expect(showsContent({ type: 'Box', children: [{ type: 'Text', children: ['  '] }] })).toBe(false)
  expect(showsContent({ type: 'Box', children: [{ type: 'Text', children: ['Heads up'] }] })).toBe(true)
  expect(showsContent({ type: 'Box', children: [{ type: 'Button', props: { label: 'Dismiss' } }] })).toBe(true)
})

const drawTip: Register = on => {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text>Heads up · a tip</Text>
        <Button key="dismiss" label="Dismiss" onPress={() => {}} />
      </Box>
    )
  })
}
const tipsStandIn = { name: 'tips-stand-in', tier: 'builtin' as const, register: drawTip }

test('a tip beneath and the row draw as two bordered cards', { plugins: [tipsStandIn] }, async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await mountBand($, surface)
    const drawn = (await band.drawn()) as unknown as { children: { props: Record<string, unknown> }[] }
    expect(drawn.children).toHaveLength(2)
    for (const card of drawn.children) expect(card.props).toMatchObject({ borderStyle: 'round', borderDimColor: true, paddingX: 1 })
    expect(await band.find({ type: 'Text', text: /Heads up/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /5h/ })).toBeDefined()
    await band.unmount()
  }
})

test('with no tip the row draws with no border', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  const band = await mountBand($, 'terminal')
  expect(JSON.stringify(await band.drawn())).not.toContain('borderStyle')
  await band.unmount()
})
