import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { PeerSession } from '../types'
import { cacheLeft, cacheText, idsIn, isOpenerTool, layerPcts, layersOf, resetLabel, timeLeft } from '../hooks/register'

const BAND = {
  plugin: 'clawd-usage-hud',
  component: 'AbovePrompt' as const,
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 12,
    bodyColumns: 140,
    scroll: { offset: 0, bodyRows: 12 },
    view: {},
  },
}

const NOW = Date.parse('2026-11-11T19:00:00')
const CHILD = 'local_11111111-2222-3333-4444-555555555555'
const STRANGER = 'local_99999999-2222-3333-4444-555555555555'

function peer(over: Partial<PeerSession>): PeerSession {
  return {
    id: 'filha',
    hostId: CHILD,
    project: '.Bali_Brain',
    title: 'Limpar arquivos',
    name: 'Limpar arquivos de sessão antigos',
    status: 'working',
    pose: 'terminal',
    activity: 'Bash apagando arquivos',
    model: 'Opus 5.5',
    subagents: 0,
    contextPct: 6,
    tokens: 64_000,
    window: 1_000_000,
    todos: ['completed', 'in_progress'],
    turnStartedAt: NOW - 60_000,
    turnEndedAt: null,
    startedAt: NOW - 120_000,
    changedAt: NOW,
    updatedAt: NOW,
    endedAt: null,
    ...over,
  }
}

// This session is a desktop one (`local_mae`) on Opus with a million window; the shared folder
// holds the peers given.
function engine(on: On, files: Record<string, PeerSession> = {}) {
  const clock = mock.clock(on, { now: NOW })
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  on('env.get', ($, e) => ({
    value: e.name === 'USERPROFILE' ? 'C:\\Users\\eu' : e.name === 'CLAUDE_CODE_HOST_SESSION_ID' ? 'local_aaaaaaaa-0000-0000-0000-000000000000' : undefined,
  }))
  on('session.id', () => ({ value: 'mae' }))
  on('session.cwd', () => ({ value: 'E:/Bali_Brain' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 1_000_000, tokens: 512_000, percent: 51 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-11-11T23:00:00' },
        { kind: 'seven_day', percentUsed: 38, resetsAt: '2026-11-16T09:00:00' },
      ],
    },
  }))
  on('agent.list', () => ({ value: [] }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: `Session started: ${CHILD}` }))
  on('fs.list', () => ({
    value: Object.keys(files).map(name => ({ name, kind: 'file' as const, size: 100, mtimeMs: NOW, isLink: false })),
  }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', ($, e) => {
    const name = String(e.path).split(/[\\/]/).pop()!
    const f = files[name]
    if (f === undefined) throw new Error('ENOENT')
    return { value: JSON.stringify(f) }
  })
  on('fs.write', () => ({ value: undefined }))
  return clock
}

const start = ($: Engine) => $.session.start({ cwd: 'E:/Bali_Brain', surface: null, isInteractive: true })

async function texts($: Engine, surface: 'terminal' | 'desktop'): Promise<string> {
  const ui = await $.ui.mount({ ...BAND, surface })
  const all = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return all.map(t => t.text).join(' | ')
}

test('everything starts folded: one line with 5h, semana, contexto and a Mostrar', async ($, on) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop'] as const) {
    const shown = await texts($, surface)
    expect(shown).toContain('42%')
    expect(shown).toContain('38%')
    expect(shown).toContain('51%')
    expect(shown).not.toContain('Janela 5h')
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Button', key: 'fold-card' }))?.props.label).toBe('▸ Mostrar')
    await ui.unmount()
  }
})

test('Mostrar opens the card: the king beside three aligned bars on the desktop, one line in the terminal', async ($, on) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'fold-card' })
  const svgs = await ui.findAll({ type: 'Svg' })
  expect(svgs.some(s => String(s.props.alt).startsWith('Rei Clawd: parado'))).toBe(true)
  const card = svgs.find(s => String(s.props.alt).startsWith('Janela 5h'))
  expect(card?.props.alt).toBe('Janela 5h 42%, semana 38%, contexto 51%')
  expect(String(card?.props.source)).toContain('Semana')
  expect((await ui.find({ type: 'Button', key: 'fold-card' }))?.props.label).toBe('▾ Ocultar')
  await ui.unmount()
  // The fold is the session's: the terminal opens too, with no "Rei Clawd" line.
  const shown = await texts($, 'terminal')
  expect(shown).toContain('semana')
  expect(shown).toContain('contexto')
  expect(shown).not.toContain('Rei Clawd')
})

test('only a session this one opened shows, under its own fold', async ($, on) => {
  const clock = engine(on, {
    'filha.json': peer({}),
    'estranha.json': peer({ id: 'estranha', hostId: STRANGER, name: 'Sessão solta' }),
  })
  await start($)
  await clock.advance(3000)
  expect(await texts($, 'desktop')).not.toContain('Sessões que esta abriu')
  await $.tool.call({ tool: 'mcp__ccd_session__start_session', tool_use_id: 's1', title: 'Limpar' } as never)
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'fold-card' })
  expect(await ui.find({ type: 'Text', text: /Sessões que esta abriu · 1/ })).toBeDefined()
  // Folded until opened.
  expect(await ui.find({ type: 'Text', text: /Limpar arquivos de sessão antigos/ })).toBeUndefined()
  await ui.press({ key: 'fold-nest' })
  expect(await ui.find({ type: 'Text', text: /Limpar arquivos de sessão antigos/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Sessão solta/ })).toBeUndefined()
  await ui.unmount()
})

test('the desktop ids a start_session result names, never this session’s own', () => {
  expect(isOpenerTool('mcp__ccd_session__start_session')).toBe(true)
  expect(isOpenerTool('mcp__ccd_session__hand_off_to_session')).toBe(true)
  expect(isOpenerTool('mcp__ccd_session__dismiss_task')).toBe(false)
  expect(idsIn({ text: `ok ${CHILD} e ${CHILD}` }, null)).toEqual([CHILD])
  expect(idsIn(`${CHILD}`, CHILD)).toEqual([])
})

test('the cache counts down from the last response and reads quiet', () => {
  expect(cacheLeft(0, NOW)).toBeNull()
  expect(cacheText(cacheLeft(NOW - 13 * 60_000, NOW))?.text).toBe('cache quente · esfria em 47min')
  expect(cacheText(cacheLeft(NOW - 56 * 60_000, NOW))?.text).toBe('cache esfriando · 4min')
  expect(cacheText(cacheLeft(NOW - 61 * 60_000, NOW))?.text).toBe('cache frio · a próxima mensagem relê tudo')
})

test('the context layers add up to the context figure', () => {
  const l = layersOf([
    { name: 'System prompt', tokens: 30, kind: 'used' },
    { name: 'System tools', tokens: 140, kind: 'used' },
    { name: 'MCP tools', tokens: 0, kind: 'deferred' },
    { name: 'Memory files', tokens: 120, kind: 'used' },
    { name: 'Messages', tokens: 220, kind: 'used' },
    { name: 'Free space', tokens: 490, kind: 'free' },
  ])
  expect(l).toEqual({ conversa: 220, ferramentas: 140, arquivos: 120, sistema: 30 })
  const p = layerPcts(51, l)!
  expect(Math.round(p.conversa + p.ferramentas + p.arquivos + p.sistema)).toBe(51)
})

test('resets read as a clock today, a weekday this week', () => {
  expect(resetLabel(Date.parse('2026-11-11T23:00:00'), NOW)).toBe('23:00')
  expect(resetLabel(Date.parse('2026-11-16T09:00:00'), NOW)).toBe('seg 09:00')
  expect(timeLeft(4 * 24 * 3600_000 + 14 * 3600_000)).toBe('4d 14h')
  expect(timeLeft(38 * 60_000)).toBe('38min')
})
