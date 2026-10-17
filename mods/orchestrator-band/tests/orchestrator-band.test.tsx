import { expect, mock, test } from 'claude-code/testing'

import { applyPlan, describeAction, formatElapsed, fromTodos, taskIdFrom } from '../hooks/register'

const BAND = {
  plugin: 'orchestrator-band',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: true, maxRows: 30, bodyColumns: 80, scroll: { top: 0, bodyRows: 29 }, view: {} },
} as const

test('elapsed times keep a fixed width', async () => {
  expect(formatElapsed(42_000)).toBe('   42s')
  expect(formatElapsed(134_000)).toBe(' 2m14s')
  expect(formatElapsed(3_900_000)).toBe(' 1h05m')
})

test('the desktop plan advances one step at a time', async () => {
  const list = applyPlan([], { items: [
    { content: 'Map auth flow', status: 'in_progress' },
    { content: 'Draft plan', status: 'pending' },
    { content: 'Review', status: 'pending' },
  ] })
  const after = applyPlan(list, { advance: true })
  expect(after.map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
  expect(applyPlan(after, { done: [2], start: 3 }).map(t => t.status)).toEqual(['completed', 'completed', 'in_progress'])
})

test('todos, task ids and agent actions read as expected', async () => {
  expect(fromTodos([{ content: 'A', status: 'completed' }]).at(0)?.status).toBe('completed')
  expect(taskIdFrom('Task #7 created successfully')).toBe('7')
  expect(describeAction('Edit', { file_path: '/repo/src/auth/session.ts' })).toBe('Edit session.ts')
  expect(describeAction('Bash', { command: 'npm test -- refresh\necho done' })).toBe('Bash npm test -- refresh')
})

test('the band tracks todos and agents, peeks, expands, and keeps usage on its row', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-17T10:00:00Z') })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: {} as never }))
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'a1' }))

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'Map auth flow', status: 'completed', activeForm: 'Mapping' },
      { content: 'Update session middleware', status: 'in_progress', activeForm: 'Updating' },
      { content: 'Review changes', status: 'pending', activeForm: 'Reviewing' },
    ],
  })
  await $.agent.spawn({ prompt: 'Edit the middleware', description: 'session middleware', subagentType: 'general-purpose' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ ...BAND, surface } as never)
    expect(await band.find({ type: 'Text', text: /1\/3/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /5h/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /session middleware/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /Next: Review changes/ })).toBeDefined()

    await band.press({ key: 'toggle' })
    expect(await band.find({ type: 'Text', text: /Map auth flow/ })).toBeDefined()
    expect(await band.find({ key: 'pin' })).toBeDefined()
    await band.press({ key: 'toggle' })
    await band.unmount()
  }
})
