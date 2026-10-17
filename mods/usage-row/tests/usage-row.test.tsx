import { expect, mock, test } from 'claude-code/testing'

import { formatCountdown, formatTokens } from '../hooks/register'

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
    await band.unmount()
  }
})
