import { expect, mock, test } from 'claude-code/testing'

import { formatCountdown, formatTokens, isLastReply, levelColor, ringGlyph, ringSvg, tasksLabel, toAgentTasks, toTasks } from '../hooks/register'

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

test('the Stop snapshot keeps shells and monitors and leaves subagents to the live list', async () => {
  const got = toTasks([
    { id: 'b1', type: 'shell', status: 'running', description: '', command: 'npm run dev' },
    { id: 'a1', type: 'subagent', status: 'running', description: 'Explore repo' },
    { id: 'm1', type: 'monitor', status: 'running', description: 'Watch the deploy log for errors' },
  ])
  expect(got).toEqual([
    { id: 'b1', type: 'shell', label: 'npm run dev' },
    { id: 'm1', type: 'monitor', label: 'Watch the deploy log fo…' },
  ])
  expect(toTasks(undefined)).toEqual([])
})

test('live agents count while pending, running or waiting', async () => {
  const agent = (id: string, status: string) => ({ id, status, description: `job ${id}`, type: 'Explore' }) as never
  expect(toAgentTasks([agent('1', 'running'), agent('2', 'completed'), agent('3', 'waiting')]).map(t => t.id)).toEqual(['1', '3'])
})

test('background tasks show on the right of the row', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('classic.Stop', () => ({}))
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'dev server' }] } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'usage-row',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { top: 0, bodyRows: 19 }, view: {} },
    } as never)
    expect(await band.find({ type: 'Text', text: /◉ 1/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /dev server/ })).toBeDefined()
    await band.unmount()
  }
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
