import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, Timer } from 'claude-code'

import type { ClawdState, ContextLayers, CrewMember, CrewStatus, PeerSession, PeerStatus, TodoStatus, UsageReading } from '../types'
import {
  ASKS,
  CLAUDE,
  CLAUDE_ORANGE,
  CLAWD_LABEL,
  CLAWD_SIZE,
  CONTEXT_BLUE,
  KING_SIZE,
  TRANSIENT,
  WEEK_PEACH,
  baseColor,
  clawdSvg,
  miniClawd,
  rampColor,
  toolKind,
} from './clawd'
import type { ClawdKind } from './clawd'
import { INK, svgCard } from './card'
import type { Foot, Row, Segment } from './card'
import { HEARTBEAT_MS, PEER_MS, STOP_MS, peersDir, projectOf, readPeers, readStop, requestStop, since, titleFrom, writePeer } from './sessoes'

const FIVE_HOUR = 'five_hour'
const SEVEN_DAY = 'seven_day'
const TICK_MS = 4000 // the crew's clock, only while someone works
const CARD_TICK_MS = 30_000 // the card's clock: resets and the cache move by the minute
const SETTLE_MS = 5_000 // how long concluído, interrompido and erro stay before the king settles
const BAND_LINGER_MS = 6000 // a finished subagent stays in the band this long
const KEEP = 30
const LOG_SIZE = 8
const CELLS = 10 // a terminal bar
const BAR_WIDTH = 140 // a crew row's bar, in px

// The prompt cache lives this long after the main thread's last model call. Claude Code on a
// subscription caches for an hour; a session on the five-minute cache reads short.
const CACHE_TTL_MS = 60 * 60_000
const CACHE_WARN_MS = 5 * 60_000

// What the mod asks the session when the cache is about to go cold and the person sent nothing:
// the folder's own rules say where the pendências live (Bali_Brain lists, a project's .memory/).
const SAVE_PROMPT = [
  '[Clawd-Usage-HUD] O cache desta sessão esfria em menos de 5 minutos e não chegou mensagem nova.',
  'Pause aqui: atualize a pendência desta tarefa conforme as regras desta pasta (a lista de pendências',
  'do AGENTS.md, ou o .memory/ do projeto de código), sem começar trabalho novo e sem perguntar.',
  'Se não houver nada novo a registrar, diga só isso. Responda em até 3 linhas: feito, falta, onde está.',
].join(' ')

const NO_USAGE: UsageReading = {
  fiveHourPct: null,
  fiveHourResetsAt: null,
  weekPct: null,
  weekResetsAt: null,
  contextPct: null,
  contextTokens: null,
  contextWindow: null,
}

const nowAt = atom({ plugin: 'clawd-usage-hud', key: 'now' } as const, 0)
const usage = atom({ plugin: 'clawd-usage-hud', key: 'usage' } as const, NO_USAGE)
const layers = atom({ plugin: 'clawd-usage-hud', key: 'layers' } as const, null as ContextLayers)
const clawd = atom({ plugin: 'clawd-usage-hud', key: 'clawd' } as const, { kind: 'parado', at: 0 } as ClawdState)
const lastResponseAt = atom({ plugin: 'clawd-usage-hud', key: 'lastResponseAt' } as const, 0)
const cacheSaved = atom({ plugin: 'clawd-usage-hud', key: 'cacheSaved' } as const, false)
// Everything starts folded: $.state is the session's, so each new session starts over.
const cardFolded = atom({ plugin: 'clawd-usage-hud', key: 'cardFolded' } as const, true)
const crewFolded = atom({ plugin: 'clawd-usage-hud', key: 'crewFolded' } as const, true)
const nestFolded = atom({ plugin: 'clawd-usage-hud', key: 'nestFolded' } as const, true)
const crew = atom({ plugin: 'clawd-usage-hud', key: 'crew' } as const, [] as CrewMember[])
const self = atom({ plugin: 'clawd-usage-hud', key: 'self' } as const, null as PeerSession | null)
const peers = atom({ plugin: 'clawd-usage-hud', key: 'peers' } as const, [] as PeerSession[])
const children = atom({ plugin: 'clawd-usage-hud', key: 'children' } as const, [] as string[])
const halted = atom({ plugin: 'clawd-usage-hud', key: 'halted' } as const, null as { at: number; from: string } | null)

// The subagents a Parar stopped: a tool any of them still tries is refused.
const stoppedAgents = new Set<string>()
const HALT_TEXT = 'Parado pelo Clawd-Usage-HUD: o usuário mandou parar. Não use mais ferramentas, não continue a tarefa e encerre a resposta agora.'
const ENDING_TOOLS = new Set(['TaskStop', 'KillShell'])

const STATUS: Record<CrewStatus, { label: string; color: string }> = {
  working: { label: 'Trabalhando', color: '#e07a5f' },
  thinking: { label: 'Pensando', color: '#5aa7e8' },
  waiting: { label: 'Aguardando', color: '#e0b04a' },
  done: { label: 'Concluído', color: '#a3e635' },
  error: { label: 'Erro', color: '#e5484d' },
}

const SHORT_TYPE: Record<string, string> = {
  'general-purpose': 'general',
  'security-review': 'security',
  'code-review': 'review',
  'claude-code-guide': 'guide',
  'statusline-setup': 'statusline',
}

// The context's layers, in the bar's order, with their colors.
type LayerKey = 'conversa' | 'ferramentas' | 'arquivos' | 'sistema'
const LAYERS: readonly { key: LayerKey; label: string; rgb: readonly [number, number, number]; isShown: boolean }[] = [
  { key: 'conversa', label: 'conversa', rgb: CONTEXT_BLUE, isShown: true },
  { key: 'ferramentas', label: 'ferramentas', rgb: [157, 124, 232], isShown: true },
  { key: 'arquivos', label: 'arquivos', rgb: [47, 179, 163], isShown: true },
  { key: 'sistema', label: 'sistema', rgb: [107, 107, 112], isShown: false },
]

const CURRENT_WINDOW = 1_000_000
const OLD_WINDOW = 200_000
const OLD_MODEL = /haiku-[34]\b|haiku-4-5|sonnet-4-5|sonnet-4-\d{8}|sonnet-4$|-3-|claude-3/i
const WINDOWS = [200_000, 500_000, 1_000_000, 2_000_000]

/* ---------------- figures ---------------- */

export function prettyModel(id: string): string {
  const m = /(opus|sonnet|haiku|fable)(?:[-_ ]?(\d+)(?:[-.](\d{1,2})(?!\d))?)?/i.exec(id)
  if (m === null) return id.replace(/^claude-/, '')
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  if (m[2] === undefined) return family
  return m[3] === undefined ? `${family} ${m[2]}` : `${family} ${m[2]}.${m[3]}`
}

export function windowOf(model: string, parentModel: string, sessionWindow: number | undefined): number {
  if (/\[1m\]|-1m\b/i.test(model)) return 1_000_000
  if (sessionWindow !== undefined && prettyModel(model) === prettyModel(parentModel)) return sessionWindow
  return OLD_MODEL.test(model) ? OLD_WINDOW : CURRENT_WINDOW
}

function grownWindow(window: number, tokens: number): number {
  return tokens <= window ? window : WINDOWS.find(w => w >= tokens) ?? tokens
}

function shortType(type: string): string {
  return SHORT_TYPE[type] ?? type.split(':').pop() ?? type
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n)}`
}

export function formatWindow(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const hh = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return hh > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function clockLabel(at: number): string {
  const when = new Date(at)
  return `${pad(when.getHours())}:${pad(when.getMinutes())}`
}

const WEEKDAY = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

// "23:00" today, "seg 09:00" within the week, "18/11 09:00" past it.
export function resetLabel(reset: number, at: number): string {
  const when = new Date(reset)
  if (when.toDateString() === new Date(at).toDateString()) return clockLabel(reset)
  if (reset - at < 6 * 24 * 3600_000) return `${WEEKDAY[when.getDay()]} ${clockLabel(reset)}`
  return `${pad(when.getDate())}/${pad(when.getMonth() + 1)} ${clockLabel(reset)}`
}

// "38min", "4h 32min", "4d 14h".
export function timeLeft(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  return hours > 0 ? `${hours}h ${pad(minutes % 60)}min` : `${minutes}min`
}

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

function shortPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : parts.join('/')
}

export function targetOf(tool: string, input: Readonly<Record<string, unknown>>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return shortPath(s('file_path') || s('notebook_path'))
    case 'Bash':
    case 'PowerShell':
      return (s('description') || s('command')).split('\n')[0] ?? ''
    case 'Grep':
      return `"${s('pattern')}"${s('path') ? ` em ${shortPath(s('path'))}` : ''}`
    case 'Glob':
      return s('pattern')
    case 'WebFetch':
      try {
        return new URL(s('url')).host
      } catch {
        return s('url')
      }
    case 'WebSearch':
      return s('query')
    default:
      return s('description') || s('query') || s('pattern') || s('file_path')
  }
}

export function progressOf(m: CrewMember): number | null {
  if (m.status === 'done') return 100
  const items: TodoStatus[] =
    m.tasks.length > 0 ? m.tasks.map(t => (t.isDone ? 'completed' : t.isActive ? 'in_progress' : 'pending')) : m.todos ?? []
  if (items.length === 0) return null
  const score = items.reduce((s, t) => s + (t === 'completed' ? 1 : t === 'in_progress' ? 0.5 : 0), 0)
  return Math.min(99, Math.round((score / items.length) * 100))
}

export function listProgress(todos: readonly TodoStatus[] | null): number | null {
  if (todos === null || todos.length === 0) return null
  const score = todos.reduce((s, t) => s + (t === 'completed' ? 1 : t === 'in_progress' ? 0.5 : 0), 0)
  return Math.round((score / todos.length) * 100)
}

function isTodoStatus(v: unknown): v is TodoStatus {
  return v === 'pending' || v === 'in_progress' || v === 'completed'
}

export function isPlanTool(tool: string): boolean {
  return /^mcp__.*__update_plan$/.test(tool)
}

export function applyPlan(list: readonly TodoStatus[] | null, input: Readonly<Record<string, unknown>>): TodoStatus[] | null {
  let next: TodoStatus[] | null = list === null ? null : [...list]
  if (Array.isArray(input.items)) {
    next = (input.items as readonly { status?: unknown }[]).map(t => (isTodoStatus(t?.status) ? t.status : 'pending'))
  }
  if (next === null) return null
  if (input.advance === true) {
    const at = next.indexOf('in_progress')
    if (at >= 0) next[at] = 'completed'
    const after = next.indexOf('pending', Math.max(at, 0))
    if (after >= 0) next[after] = 'in_progress'
  }
  if (Array.isArray(input.done)) {
    for (const n of input.done) if (typeof n === 'number' && next[n - 1] !== undefined) next[n - 1] = 'completed'
  }
  if (typeof input.start === 'number' && next[input.start - 1] !== undefined) {
    next = next.map((s, i) => (i === (input.start as number) - 1 ? 'in_progress' : s === 'in_progress' ? 'pending' : s))
  }
  return next
}

export function kindOf(m: CrewMember): ClawdKind {
  switch (m.status) {
    case 'working':
      return m.tool === null ? 'trabalhando' : toolKind(m.tool)
    case 'thinking':
      return 'pensando'
    case 'waiting':
      return 'aguardando'
    case 'done':
      return 'concluido'
    case 'error':
      return m.outcome === 'aborted' ? 'interrompido' : 'erro'
  }
}

function activity(m: CrewMember): string {
  return m.tool === null ? m.target : `${m.tool} ${m.target}`.trim()
}

function toolName(tool: string): string {
  return tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool
}

/* ---------------- usage ---------------- */

export function readingOf(
  context: { tokens?: number; window: number; percent?: number },
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[],
): UsageReading {
  const five = rateLimits.find(limit => limit.kind === FIVE_HOUR)
  const week = rateLimits.find(limit => limit.kind === SEVEN_DAY)
  return {
    fiveHourPct: five ? Math.round(five.percentUsed) : null,
    fiveHourResetsAt: five?.resetsAt ?? null,
    weekPct: week ? Math.round(week.percentUsed) : null,
    weekResetsAt: week?.resetsAt ?? null,
    contextPct: context.percent ?? null,
    contextTokens: context.tokens ?? null,
    contextWindow: context.window,
  }
}

// The /context categories, folded into the card's four layers. Branch on the row's kind, and
// on its name only to tell the used rows apart.
export function layersOf(categories: readonly { name: string; tokens: number; kind: string }[]): ContextLayers {
  const out = { conversa: 0, ferramentas: 0, arquivos: 0, sistema: 0 }
  for (const c of categories) {
    if (c.kind !== 'used') continue
    const name = c.name.toLowerCase()
    if (/message/.test(name)) out.conversa += c.tokens
    else if (/memory|file/.test(name)) out.arquivos += c.tokens
    else if (/tool|skill|agent|command|mcp/.test(name)) out.ferramentas += c.tokens
    else out.sistema += c.tokens
  }
  return out.conversa + out.ferramentas + out.arquivos + out.sistema > 0 ? out : null
}

// Each layer's share of the context's percent, so the segments add up to the figure.
export function layerPcts(total: number | null, l: ContextLayers): Record<LayerKey, number> | null {
  if (total === null || l === null) return null
  const sum = l.conversa + l.ferramentas + l.arquivos + l.sistema
  const f = (n: number) => (n / sum) * total
  return { conversa: f(l.conversa), ferramentas: f(l.ferramentas), arquivos: f(l.arquivos), sistema: f(l.sistema) }
}

async function seed($: EngineInterface) {
  const session = await $.session.usage()
  await update($, usage, () => readingOf(session.context, session.rateLimits))
}

async function measureLayers($: EngineInterface) {
  try {
    const u = await $.session.usage({ breakdown: 'summary' })
    const l = u.context.breakdown ? layersOf(u.context.breakdown.categories) : null
    if (l !== null) await update($, layers, () => l)
  } catch {
    // the bar stays one color
  }
}

async function stamp($: EngineInterface) {
  const at = await $.clock.now()
  await update($, nowAt, () => at)
}

async function drawnAt($: EngineInterface): Promise<number> {
  const [ticked, at] = await Promise.all([read($, nowAt), $.clock.now()])
  return Math.max(ticked, at)
}

// The cache's state: null before the first response; else how long until it goes cold.
export function cacheLeft(last: number, at: number): number | null {
  return last === 0 ? null : last + CACHE_TTL_MS - at
}

export function cacheText(left: number | null): { dot: string; text: string; short: string } | null {
  if (left === null) return null
  if (left <= 0) return { dot: '#60a5fa', text: 'cache frio · a próxima mensagem relê tudo', short: 'frio' }
  const t = timeLeft(left)
  if (left <= CACHE_WARN_MS) return { dot: '#ffd34d', text: `cache esfriando · ${t}`, short: t }
  return { dot: '#a3e635', text: `cache quente · esfria em ${t}`, short: t }
}

/* ---------------- the Rei Clawd ---------------- */

let settleTimer: Timer | undefined

async function setClawd($: EngineInterface, kind: ClawdKind) {
  try {
    settleTimer?.cancel()
    settleTimer = undefined
    const was = await read($, clawd)
    if (was.kind !== kind) {
      const at = await $.clock.now()
      await update($, clawd, () => ({ kind, at }))
    }
    if (TRANSIENT.has(kind)) settleTimer = $.clock.after(SETTLE_MS, () => void settle($))
  } catch {
    // decoration only
  }
}

async function settle($: EngineInterface) {
  const agents = await $.agent.list().catch(() => [])
  const isBusy = agents.some(a => a.status === 'running' || a.status === 'pending')
  await setClawd($, isBusy ? 'aguardando' : 'parado')
}

/* ---------------- the crew ---------------- */

async function patch($: EngineInterface, id: string, fn: (m: CrewMember) => CrewMember) {
  const list = await read($, crew)
  if (!list.some(m => m.id === id)) return
  await update($, crew, all => all.map(m => (m.id === id ? fn(m) : m)))
}

async function stopMember($: EngineInterface, id: string) {
  await patch($, id, m => (m.endedAt === null ? { ...m, tool: null, target: 'Parando…' } : m))
  stoppedAgents.add(id)
  try {
    await $.tool.call({ tool: 'TaskStop', task_id: id })
  } catch (err) {
    await patch($, id, m => (m.endedAt === null ? { ...m, target: 'Não parou' } : m))
    $.ui.toast(`Clawd-Usage-HUD: não consegui parar o subagente (${err instanceof Error ? err.message : String(err)})`)
    return
  }
  const at = await $.clock.now()
  await patch($, id, m =>
    m.endedAt === null ? { ...m, status: 'error', outcome: 'aborted', endedAt: at, tool: null, target: 'Interrompido' } : m,
  )
  await update($, nowAt, () => at)
}

function bandRows(list: readonly CrewMember[], now: number): CrewMember[] {
  return list.filter(m => m.endedAt === null || now - m.endedAt < BAND_LINGER_MS)
}

/* ---------------- nested sessions ---------------- */

const TITLE_MAX = 60
let hostId: string | null = null

function newSelf(id: string, project: string, at: number): PeerSession {
  return {
    id,
    hostId: hostId ?? undefined,
    project,
    title: '',
    status: 'idle',
    pose: 'parado',
    activity: 'Começando',
    model: '',
    subagents: 0,
    contextPct: null,
    tokens: null,
    window: null,
    todos: null,
    turnStartedAt: null,
    turnEndedAt: null,
    startedAt: at,
    changedAt: at,
    updatedAt: 0,
    endedAt: null,
  }
}

async function markMain($: EngineInterface, status: PeerStatus, pose: ClawdKind, act: string) {
  const me = await read($, self)
  if (me === null || (me.status === status && me.pose === pose && me.activity === act)) return
  const at = await $.clock.now()
  await update($, self, p => (p === null ? p : { ...p, status, pose, activity: act, changedAt: at }))
}

// The desktop ids a start_session or hand-off result names: the sessions this one opened.
export function idsIn(result: unknown, own: string | null): string[] {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? '')
  const found = text.match(/local_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? []
  return [...new Set(found)].filter(id => id !== own)
}

export function isOpenerTool(tool: string): boolean {
  return /(^|__)(start_session|hand_off_to_session)$/.test(tool)
}

let lastWrite = 0
let lastWritten = ''
let runningTurn: string | null = null
let lastStopAt = 0

async function obeyStop($: EngineInterface, dir: string, id: string) {
  const stop = await readStop($, dir, id)
  if (stop === null || stop.at <= lastStopAt) return
  lastStopAt = stop.at
  await update($, halted, () => ({ at: stop.at, from: stop.from }))
  if (runningTurn !== null) await $.turn.abort({ turnId: runningTurn }).catch(() => undefined)
  const agents = await $.agent.list().catch(() => [])
  for (const a of agents) {
    if (a.status === 'completed' || a.status === 'failed' || a.status === 'killed') continue
    stoppedAgents.add(a.id)
    await $.tool.call({ tool: 'TaskStop', task_id: a.id }).catch(() => undefined)
  }
  await markMain($, 'idle', 'interrompido', `Parada por ${stop.from}`).catch(() => undefined)
  $.ui.toast(`Clawd-Usage-HUD: a sessão ${stop.from} parou esta. Ela fica parada até você mandar uma mensagem.`)
}

async function checkStop($: EngineInterface) {
  if (hostId === null) return
  try {
    const dir = await peersDir($)
    if (dir === null) return
    await obeyStop($, dir, await $.session.id())
  } catch {
    // the next check tries again
  }
}

async function stopPeer($: EngineInterface, peer: PeerSession) {
  try {
    const dir = await peersDir($)
    const me = await read($, self)
    if (dir === null) throw new Error('sem pasta de sessões')
    const at = await $.clock.now()
    await requestStop($, dir, peer.id, { at, from: me?.name || me?.project || 'a sessão-mãe' })
    await update($, peers, list => list.map(p => (p.id === peer.id ? { ...p, activity: 'Parando…' } : p)))
  } catch (err) {
    $.ui.toast(`Clawd-Usage-HUD: não consegui pedir a parada (${err instanceof Error ? err.message : String(err)})`)
  }
}

// Only desktop sessions take part: a session writes itself so the one that opened it can show it,
// and reads only the sessions it opened. A terminal session opens none and writes nothing.
async function syncPeers($: EngineInterface) {
  if (hostId === null) return
  try {
    const dir = await peersDir($)
    if (dir === null) return
    const at = await $.clock.now()
    const id = await $.session.id()
    let me = await read($, self)
    if (me === null) return
    if (me.id !== id) me = newSelf(id, me.project, at)
    const list = await read($, crew)
    const context = await $.session.usage().then(u => u.context, () => null)
    const model = await $.session.model().then(prettyModel, () => me.model)
    const next: PeerSession = {
      ...me,
      hostId: hostId,
      model,
      subagents: list.filter(m => m.endedAt === null).length,
      contextPct: context?.percent ?? null,
      halted: (await read($, halted)) !== null,
      tokens: context?.tokens ?? null,
      window: context?.window ?? null,
    }
    const key = JSON.stringify({ ...next, updatedAt: 0 })
    if (key !== lastWritten || at - lastWrite >= HEARTBEAT_MS) {
      next.updatedAt = at
      await writePeer($, dir, next)
      lastWrite = at
      lastWritten = key
    }
    await update($, self, () => next)
    const mine = await read($, children)
    const found = mine.length === 0 ? [] : (await readPeers($, dir, id, at)).filter(p => p.hostId !== undefined && mine.includes(p.hostId))
    const old = await read($, peers)
    if (JSON.stringify(found) !== JSON.stringify(old)) await update($, peers, () => found)
  } catch {
    // no peers this round
  }
}

const PEER_ACT_COLOR: Record<PeerStatus, string> = { working: 'subtle', asking: '#e0b04a', idle: 'inactive' }
const POSES = new Set<string>(Object.keys(CLAWD_LABEL))

export function isShown(p: PeerSession, now: number): boolean {
  const isHalted = p.halted === true || p.activity.startsWith('Parada por')
  return !isHalted || now - p.changedAt < BAND_LINGER_MS
}

function poseOf(p: PeerSession): ClawdKind {
  if (typeof p.pose === 'string' && POSES.has(p.pose)) return p.pose as ClawdKind
  return p.status === 'idle' ? 'parado' : 'trabalhando'
}

function peerTime(p: PeerSession, now: number): string {
  const from = p.turnStartedAt ?? null
  if (from === null) return formatTime(now - p.startedAt)
  return formatTime((p.status === 'idle' ? p.turnEndedAt ?? now : now) - from)
}

function peerActivity(p: PeerSession, now: number): string {
  if (p.status !== 'idle') return p.activity
  const ago = since(now - p.changedAt)
  return ago === 'agora' ? p.activity : `${p.activity} há ${ago}`
}

async function takeTitle($: EngineInterface, title: unknown): Promise<void> {
  const name = typeof title === 'string' ? cut(title.replace(/\s+/g, ' ').trim(), TITLE_MAX) : ''
  const me = await read($, self)
  if (me !== null && name !== '' && me.name !== name) await update($, self, p => (p === null ? p : { ...p, name }))
}

/* ---------------- the cache warning ---------------- */

// Once per idle stretch: the session is between turns, nothing runs, the cache goes cold in under
// five minutes, and the person has not written since. The session saves its pendências.
async function watchCache($: EngineInterface) {
  try {
    if (runningTurn !== null || (await read($, cacheSaved)) || (await read($, halted)) !== null) return
    const left = cacheLeft(await read($, lastResponseAt), await $.clock.now())
    if (left === null || left <= 0 || left > CACHE_WARN_MS) return
    const agents = await $.agent.list().catch(() => [])
    if (agents.some(a => a.status === 'running' || a.status === 'pending')) return
    await update($, cacheSaved, () => true)
    await $.prompt.submit({ text: SAVE_PROMPT })
  } catch {
    // next tick
  }
}

/* ---------------- SVG pieces ---------------- */

function taskBar(id: string, pct: number, isHopping: boolean, isKing = false): string {
  const w = (Math.min(Math.max(pct, 0), 100) / 100) * BAR_WIDTH
  const top = isKing ? 16 : 10
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BAR_WIDTH + 8}" height="${top + 4}" viewBox="0 -${top} ${BAR_WIDTH + 8} ${top + 4}">`,
    `<linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${baseColor(CLAUDE_ORANGE, 0.45)}"/><stop offset="1" stop-color="${CLAUDE}"/></linearGradient>`,
    `<rect x="0" y="-1" width="${BAR_WIDTH}" height="2" rx="1" fill="#ffffff" fill-opacity=".07"/>`,
    `<rect x="0" y="-1" width="${w}" height="2" rx="1" fill="url(#${id})"/>`,
    `<g transform="translate(${Math.max(w, 8)} 0)">${miniClawd(CLAUDE, isHopping, isKing)}</g>`,
    '</svg>',
  ].join('')
}

/* ---------------- the card's rows ---------------- */

function gaugeRow(id: string, label: string, pct: number | null, resetsAt: string | null, base: readonly [number, number, number], at: number, isHopping: boolean): Row {
  const color = rampColor(base, pct)
  const reset = resetsAt === null ? Number.NaN : Date.parse(resetsAt)
  const left = reset - at
  const isTimed = pct !== null && !Number.isNaN(reset) && at !== 0
  return {
    id,
    label,
    pct,
    figure: { text: pct === null ? '–' : `${pct}%`, color },
    lead:
      pct === null
        ? { text: 'aguardando a primeira resposta', color: INK.detail }
        : !isTimed
          ? null
          : left <= 0
            ? { text: 'já renovou', color: INK.detail }
            : { text: `renova ${id === 'week' ? '' : 'às '}${resetLabel(reset, at)}`, color: INK.detail },
    tail: isTimed && left > 0 ? [{ text: `faltam ${timeLeft(left)}`, color: INK.detail }] : [],
    segments: pct === null ? [] : [{ pct, color }],
    tip: color,
    isHopping,
  }
}

function contextRow(reading: UsageReading, split: Record<LayerKey, number> | null, isHopping: boolean): Row {
  const pct = reading.contextPct
  const color = rampColor(CONTEXT_BLUE, pct)
  const segments: Segment[] =
    pct === null ? [] : split === null ? [{ pct, color }] : LAYERS.map(l => ({ pct: split[l.key], color: rampColor(l.rgb, pct) }))
  const isKnown = reading.contextTokens !== null && reading.contextWindow !== null
  return {
    id: 'context',
    label: 'Contexto',
    pct,
    figure: { text: pct === null ? '–' : `${pct}%`, color },
    lead: isKnown
      ? { text: `${formatTokens(reading.contextTokens!)} de ${formatWindow(reading.contextWindow!)}`, color: INK.detail }
      : { text: 'aguardando a primeira resposta', color: INK.detail },
    tail: [],
    segments,
    tip: color,
    isHopping,
  }
}

/* ---------------- the hooks ---------------- */

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    hostId = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID').catch(() => undefined)) || null
    const [id, cwd, at] = await Promise.all([$.session.id(), $.session.cwd(), $.clock.now()])
    const me = await read($, self)
    await update($, self, () => (me === null || me.id !== id ? newSelf(id, projectOf(cwd), at) : { ...newSelf(id, me.project, at), ...me }))
    lastWritten = ''
    lastStopAt = at
    await Promise.all([seed($).catch(() => undefined), stamp($), setClawd($, 'parado')])
    void measureLayers($)
    $.clock.every(PEER_MS, () => void syncPeers($))
    $.clock.every(STOP_MS, () => void checkStop($))
    void syncPeers($)
    $.clock.every(CARD_TICK_MS, () => {
      void stamp($)
      void seed($).catch(() => undefined)
      void watchCache($)
      // Loaded mid-session (a reload, an install), the layers wait for no turn to end.
      void read($, layers).then(l => (l === null ? measureLayers($) : undefined))
    })
    // The crew's clock moves only while someone works or has just finished.
    $.clock.every(TICK_MS, () => {
      void (async () => {
        const list = await read($, crew)
        const at = await $.clock.now()
        const others = await read($, peers)
        const isBusy = list.some(m => m.endedAt === null || at - m.endedAt < BAND_LINGER_MS + TICK_MS)
        if (isBusy || others.length > 0) await update($, nowAt, () => at)
      })()
    })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      const me = await read($, self)
      const dir = await peersDir($)
      if (hostId !== null && me !== null && dir !== null && me.id === e.sessionId) {
        const at = await $.clock.now()
        await writePeer($, dir, { ...me, endedAt: at, updatedAt: at })
      }
    } catch {
      // the file goes stale instead
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, () => readingOf(e.context, e.rateLimits))
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const kind = e.origin?.kind
    const isPerson = kind === 'composer' || kind === 'bridge' || kind === 'sdk'
    const halt = await read($, halted)
    if (halt !== null) {
      if (!isPerson) return { drop: `Clawd-Usage-HUD: sessão parada por ${halt.from}` }
      await update($, halted, () => null)
    }
    // The person wrote: the cache warning may fire again in the next idle stretch.
    if (isPerson) await update($, cacheSaved, () => false)
    const text = titleFrom(String(e.text ?? ''))
    const me = await read($, self)
    if (me !== null && me.title === '' && text !== '') await update($, self, p => (p === null ? p : { ...p, title: cut(text, TITLE_MAX) }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('classic.SessionStart', async ($, e, next) => {
    await takeTitle($, e.session_title)
    return next(e)
  }).catch(($, e, next) => next(e))
  on('classic.UserPromptSubmit', async ($, e, next) => {
    await takeTitle($, e.session_title)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, halted)) !== null) {
      const started = await next(e)
      await $.turn.abort({ turnId: e.turnId }).catch(() => undefined)
      return started
    }
    if (e.agentId === undefined) {
      runningTurn = e.turnId
      await setClawd($, 'pensando')
      try {
        const at = await $.clock.now()
        const me = await read($, self)
        if (me !== null && me.status === 'idle') await update($, self, p => (p === null ? p : { ...p, turnStartedAt: at, turnEndedAt: null }))
        await markMain($, 'working', 'pensando', 'Pensando…')
      } catch {
        // decoration only
      }
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny !== undefined || started.agentId === undefined || e.isTeammate) return started
    const id = started.agentId
    const at = await $.clock.now()
    const modelId = started.model || e.model || e.parentModel
    const sessionWindow = await $.session.usage().then(u => u.context.window, () => undefined)
    const member: CrewMember = {
      id,
      type: e.subagentType,
      description: e.description,
      model: prettyModel(modelId),
      window: windowOf(modelId, e.parentModel, sessionWindow),
      startedAt: at,
      endedAt: null,
      status: 'thinking',
      outcome: null,
      tool: null,
      target: 'Lendo a tarefa…',
      tools: 0,
      tokens: 0,
      todos: null,
      tasks: [],
      log: [],
    }
    await update($, crew, list => [...list.filter(m => m.id !== id), member].slice(-KEEP))
    await update($, nowAt, () => at)
    return started
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId
    if (id === undefined) {
      const was = await read($, clawd).catch(() => null)
      if (was?.kind !== 'esperando') await setClawd($, 'pensando')
      const answered = yield* next(e)
      // The main thread's model call came back: the prompt cache counts from now.
      const at = await $.clock.now()
      await update($, lastResponseAt, () => at).catch(() => undefined)
      return answered
    }
    await patch($, id, m => (m.endedAt === null ? { ...m, status: 'thinking', tool: null, target: 'Pensando…' } : m))
    const answered = yield* next(e)
    const u = answered.usage
    if (u !== null) {
      const tokens = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens + u.output_tokens
      await patch($, id, m => ({ ...m, tokens, window: grownWindow(m.window, tokens), model: prettyModel(u.model) || m.model }))
    }
    return answered
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (!ENDING_TOOLS.has(String(e.tool))) {
      if ((id !== undefined && stoppedAgents.has(id)) || (await read($, halted)) !== null) return { deny: HALT_TEXT }
    }
    if (id === undefined) {
      const name = String(e.tool)
      const input = e as unknown as Record<string, unknown>
      const what = targetOf(name, input)
      await setClawd($, toolKind(name))
      try {
        if (isPlanTool(name)) await update($, self, p => (p === null ? p : { ...p, todos: applyPlan(p.todos, input) }))
        if (name === 'TodoWrite' && Array.isArray(input.todos)) {
          const todos = (input.todos as readonly { status?: unknown }[]).map(t => (isTodoStatus(t?.status) ? t.status : 'pending'))
          await update($, self, p => (p === null ? p : { ...p, todos }))
        }
        if (!ASKS.has(name)) await markMain($, 'working', toolKind(name), `${toolName(name)} ${what}`.trim())
        else await markMain($, 'asking', 'esperando', 'Esperando sua resposta')
      } catch {
        // decoration only
      }
      const done = await next(e)
      // A session this one opened: its desktop id, so the band can show it nested.
      if (isOpenerTool(name)) {
        const ids = idsIn(done.result, hostId)
        if (ids.length > 0) await update($, children, list => [...new Set([...list, ...ids])]).catch(() => undefined)
      }
      if (ASKS.has(name)) {
        await setClawd($, 'pensando')
        await markMain($, 'working', 'pensando', 'Pensando…').catch(() => undefined)
      }
      return done
    }
    const at = await $.clock.now()
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const target = targetOf(tool, input)
    await patch($, id, m =>
      m.endedAt !== null
        ? m
        : { ...m, status: 'working', tool, target, tools: m.tools + 1, log: [{ at, tool, target }, ...m.log].slice(0, LOG_SIZE) },
    )
    if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
      const todos = input.todos as readonly { status?: unknown }[]
      await patch($, id, m => ({ ...m, todos: todos.map(t => (isTodoStatus(t?.status) ? t.status : 'pending')) }))
    }
    // The desktop app refuses update_plan in a subagent; the band answers it and keeps the list.
    if (isPlanTool(tool)) {
      await patch($, id, m => ({ ...m, todos: applyPlan(m.todos, input) }))
      return { result: 'Lista atualizada.' }
    }
    if (tool === 'TaskUpdate' && typeof input.taskId === 'string') {
      const taskId = input.taskId
      const status = input.status
      await patch($, id, m => ({
        ...m,
        tasks:
          status === 'deleted'
            ? m.tasks.filter(t => t.id !== taskId)
            : m.tasks.map(t =>
                t.id === taskId && typeof status === 'string' ? { ...t, isDone: status === 'completed', isActive: status === 'in_progress' } : t,
              ),
      }))
    }
    const done = await next(e)
    if (tool === 'TaskCreate') {
      const taskId = (done.result as { task?: { id?: unknown } } | undefined)?.task?.id
      if (typeof taskId === 'string') await patch($, id, m => ({ ...m, tasks: [...m.tasks, { id: taskId, isDone: false, isActive: false }] }))
    }
    return done
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await setClawd($, 'compactando')
    try {
      return await next(e)
    } finally {
      void settle($)
      void measureLayers($)
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id === undefined) {
      runningTurn = null
      await setClawd($, e.reason === 'answer' ? 'concluido' : e.reason === 'aborted' ? 'interrompido' : 'erro')
      void measureLayers($)
      const note = e.reason === 'answer' ? 'Respondeu' : e.reason === 'aborted' ? 'Interrompido' : 'Parou com erro'
      const pose: ClawdKind = e.reason === 'answer' ? 'parado' : e.reason === 'aborted' ? 'interrompido' : 'erro'
      try {
        const at = await $.clock.now()
        await update($, self, p => (p === null ? p : { ...p, turnEndedAt: at }))
        await markMain($, 'idle', pose, note)
      } catch {
        // decoration only
      }
      return next(e)
    }
    const was = await read($, clawd).catch(() => null)
    if (was?.kind === 'aguardando') void settle($)
    const at = await $.clock.now()
    const info = await $.agent.list().then(all => all.find(a => a.id === id), () => undefined)
    if (info?.status === 'waiting' && e.reason === 'answer') {
      await patch($, id, m => (m.endedAt === null ? { ...m, status: 'waiting', tool: null, target: 'Aguardando trabalho em segundo plano' } : m))
    } else {
      const outcome = e.reason === 'answer' ? 'answer' : e.reason === 'aborted' ? 'aborted' : 'error'
      const note = outcome === 'answer' ? 'Devolveu o resultado' : outcome === 'aborted' ? 'Interrompido' : 'Falhou'
      await patch($, id, m => ({ ...m, status: outcome === 'answer' ? 'done' : 'error', outcome, endedAt: at, tool: null, target: note }))
    }
    await update($, nowAt, () => at)
    return next(e)
  })

  /* ----- above the prompt: the card, then the crew and the nested sessions ----- */
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Svg = e.surface !== 'terminal' && 'Svg' in elements ? elements.Svg : undefined

    const now = await drawnAt($)
    const reading = await read($, usage)
    const split = layerPcts(reading.contextPct, await read($, layers))
    const king = await read($, clawd)
    const cache = cacheText(cacheLeft(await read($, lastResponseAt), now))
    const isCardFolded = await read($, cardFolded)
    const isCrewFolded = await read($, crewFolded)
    const isNestFolded = await read($, nestFolded)
    const list = await read($, crew)
    const rows = bandRows(list, now)
    const live = await read($, peers)
    const nested = live.filter(p => isShown(p, now))
    const active = list.filter(m => m.endedAt === null).length
    const isBusy = king.kind !== 'parado' && king.kind !== 'concluido'

    const five = reading.fiveHourPct
    const week = reading.weekPct
    const context = reading.contextPct
    const fiveColor = rampColor(CLAUDE_ORANGE, five)
    const weekColor = rampColor(WEEK_PEACH, week)
    const contextColor = rampColor(CONTEXT_BLUE, context)
    const pctText = (p: number | null) => (p === null ? '–' : `${p}%`)

    const fold = (key: string, isFolded: boolean, onPress: () => void) => (
      <Button key={key} label={isFolded ? '▸ Mostrar' : '▾ Ocultar'} variant="secondary" plain={Svg ? undefined : true} dimColor onPress={onPress} />
    )
    const cardFold = fold('fold-card', isCardFolded, () => void update($, cardFolded, v => !v))
    const counts = [rows.length > 0 ? `${active} ${active === 1 ? 'subagente' : 'subagentes'}` : '', nested.length > 0 ? `${nested.length} ${nested.length === 1 ? 'aninhada' : 'aninhadas'}` : '']
      .filter(Boolean)
      .join(' · ')

    // One row per subagent or nested session, with the same columns, so every Parar lines up.
    const memberRow = (m: CrewMember, i: number) => {
      const st = STATUS[m.status]
      const kind = kindOf(m)
      const shown = progressOf(m)
      const pct = shown ?? 0
      const n = Math.round((pct / 100) * 14)
      return (
        <Box key={`band:${m.id}`} flexDirection="row" alignItems="center" marginTop={Svg ? 1 : 0}>
          {Svg ? (
            <Box flexShrink={0} width={5} alignItems="center">
              <Svg source={clawdSvg(kind)} alt={`Clawd ${CLAWD_LABEL[kind]}`} width={CLAWD_SIZE.width} height={CLAWD_SIZE.height} isInteractive />
            </Box>
          ) : (
            <Box width={2} flexShrink={0}><Text color={CLAUDE}>■</Text></Box>
          )}
          <Box width={24} flexShrink={0}><Text color="subtle" wrap="truncate-end">{shortType(m.type)}</Text></Box>
          <Box width={11} flexShrink={0}><Text color={CLAUDE}>{m.model}</Text></Box>
          {Svg ? (
            <Box flexShrink={0}>
              <Svg source={taskBar(`t${i}`, pct, m.status === 'working')} alt={shown === null ? 'Sem lista de tarefas' : `${pct}% da tarefa`} width={BAR_WIDTH + 8} height={14} isInteractive />
            </Box>
          ) : (
            <Box flexShrink={0}>
              <Text color={CLAUDE}>{'━'.repeat(n)}</Text>
              <Text color="inactive">{'─'.repeat(14 - n)}</Text>
            </Box>
          )}
          <Box width={5} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text color={shown === null ? 'inactive' : CLAUDE}>{shown === null ? '—' : `${pct}%`}</Text></Box>
          <Box width={11} flexShrink={0} justifyContent="flex-end"><Text color="subtle">{`${formatTokens(m.tokens)} / ${formatWindow(m.window)}`}</Text></Box>
          <Box width={8} flexShrink={0} marginLeft={1}><Text color="subtle">{formatTime((m.endedAt ?? Math.max(now, m.startedAt)) - m.startedAt)}</Text></Box>
          <Box flexGrow={1} flexShrink={1} marginLeft={1} overflow="hidden">
            <Text color={m.status === 'working' ? 'subtle' : st.color} wrap="truncate-end">{cut(activity(m) || st.label, 40)}</Text>
          </Box>
          <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
            {m.endedAt === null && <Button key={`stop:${m.id}`} label="■ Parar" plain dimColor onPress={() => void stopMember($, m.id)} />}
          </Box>
        </Box>
      )
    }

    const peerRow = (p: PeerSession, i: number) => {
      const kind = poseOf(p)
      const shown = listProgress(p.todos ?? null)
      const pct = shown ?? 0
      const n = Math.round((pct / 100) * 14)
      return (
        <Box key={`peer:${p.id}`} flexDirection="row" alignItems="center" marginTop={Svg ? 1 : 0}>
          {Svg ? (
            <Box flexShrink={0} width={5} alignItems="center">
              <Svg source={clawdSvg(kind, true)} alt={`Rei Clawd ${CLAWD_LABEL[kind]}`} width={CLAWD_SIZE.width} height={CLAWD_SIZE.height} isInteractive />
            </Box>
          ) : (
            <Box width={2} flexShrink={0}><Text color="subtle">└</Text></Box>
          )}
          <Box width={24} flexShrink={0}><Text wrap="truncate-end">{`${Svg ? '└ ' : '♛ '}${p.name || p.title || p.project}`}</Text></Box>
          <Box width={11} flexShrink={0}><Text color={CLAUDE}>{p.model || '—'}</Text></Box>
          {Svg ? (
            <Box flexShrink={0}>
              <Svg source={taskBar(`s${i}`, pct, p.status === 'working', true)} alt={shown === null ? 'Sem lista de tarefas' : `${pct}% da lista`} width={BAR_WIDTH + 8} height={20} isInteractive />
            </Box>
          ) : (
            <Box flexShrink={0}>
              <Text color={CLAUDE}>{'━'.repeat(n)}</Text>
              <Text color="inactive">{'─'.repeat(14 - n)}</Text>
            </Box>
          )}
          <Box width={5} flexShrink={0} marginLeft={1} justifyContent="flex-end"><Text color={shown === null ? 'inactive' : CLAUDE}>{shown === null ? '—' : `${shown}%`}</Text></Box>
          <Box width={11} flexShrink={0} justifyContent="flex-end">
            <Text color="subtle">{p.tokens != null && p.window != null ? `${formatTokens(p.tokens)} / ${formatWindow(p.window)}` : '—'}</Text>
          </Box>
          <Box width={8} flexShrink={0} marginLeft={1}><Text color="subtle">{peerTime(p, now)}</Text></Box>
          <Box flexGrow={1} flexShrink={1} marginLeft={1} overflow="hidden">
            <Text color={PEER_ACT_COLOR[p.status] ?? 'subtle'} wrap="truncate-end">{cut(peerActivity(p, now), 40)}</Text>
          </Box>
          <Box width={9} flexShrink={0} marginLeft={1} justifyContent="flex-end">
            <Button key={`stop-peer:${p.id}`} label="■ Parar" plain dimColor onPress={() => void stopPeer($, p)} />
          </Box>
        </Box>
      )
    }

    const sectionHead = (title: string, button: RenderChildren) => (
      <Box flexDirection="row" alignItems="center" justifyContent="space-between" marginTop={Svg ? 1 : 0}>
        <Box flexGrow={1} flexShrink={1}><Text color="subtle" wrap="truncate-end">{title}</Text></Box>
        <Box width={11} flexShrink={0} justifyContent="flex-end">{button}</Box>
      </Box>
    )

    const crewBlock =
      rows.length > 0 || nested.length > 0 ? (
        <Box flexDirection="column" paddingX={1}>
          {rows.length > 0 && sectionHead(`Subagentes · ${active} ${active === 1 ? 'ativo' : 'ativos'} · ${formatTokens(list.reduce((s, m) => s + m.tokens, 0))} tokens`, fold('fold-crew', isCrewFolded, () => void update($, crewFolded, v => !v)))}
          {rows.length > 0 && !isCrewFolded && rows.map(memberRow)}
          {nested.length > 0 && sectionHead(`Sessões que esta abriu · ${nested.length}`, fold('fold-nest', isNestFolded, () => void update($, nestFolded, v => !v)))}
          {nested.length > 0 && !isNestFolded && nested.map(peerRow)}
        </Box>
      ) : null

    /* ----- folded: one line ----- */
    if (isCardFolded) {
      const parts = (
        <Box flexDirection="row" flexGrow={1} flexShrink={1} gap={1} alignItems="center" overflow="hidden">
          <Text color="subtle">5h</Text><Text color={fiveColor}>{pctText(five)}</Text>
          <Text color="inactive">·</Text>
          <Text color="subtle">{Svg ? 'Semana' : 'semana'}</Text><Text color={weekColor}>{pctText(week)}</Text>
          <Text color="inactive">·</Text>
          <Text color="subtle">{Svg ? 'Contexto' : 'contexto'}</Text><Text color={contextColor}>{pctText(context)}</Text>
          {cache && <Text color={cache.dot}>●</Text>}
          {cache && <Text color="subtle">{cache.short}</Text>}
          {counts !== '' && <Text color="subtle" wrap="truncate-end">{`· ${counts}`}</Text>}
        </Box>
      )
      return (
        <Box flexDirection="row" alignItems="center" paddingX={1} gap={1}>
          {Svg ? (
            <Svg key={`clawd-mini:${king.kind}`} source={clawdSvg(king.kind, true)} alt={`Rei Clawd: ${CLAWD_LABEL[king.kind]}`} width={30} height={29} isInteractive />
          ) : (
            <Text color={CLAUDE}>♛</Text>
          )}
          {parts}
          <Box flexShrink={0}>{cardFold}</Box>
        </Box>
      )
    }

    /* ----- open, on surfaces that draw SVG: the king beside the card ----- */
    if (Svg) {
      const cardRows = [
        gaugeRow('five', 'Janela 5h', five, reading.fiveHourResetsAt, CLAUDE_ORANGE, now, false),
        gaugeRow('week', 'Semana', week, reading.weekResetsAt, WEEK_PEACH, now, false),
        contextRow(reading, split, isBusy),
      ]
      const foot: Foot = {
        legend:
          split !== null
            ? LAYERS.filter(l => l.isShown).map(l => ({ label: l.label, pct: Math.round(split[l.key]), color: rampColor(l.rgb, context) }))
            : [],
        cache: cache === null ? null : { dot: cache.dot, text: cache.text },
      }
      const card = svgCard(cardRows, foot)
      const alt = `Janela 5h ${pctText(five)}, semana ${pctText(week)}, contexto ${pctText(context)}${cache ? `, ${cache.text}` : ''}`
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" alignItems="center" gap={1}>
            <Box flexShrink={0} flexDirection="column" alignItems="center" width={9}>
              <Svg key={`clawd:${king.kind}`} source={clawdSvg(king.kind, true, true)} alt={`Rei Clawd: ${CLAWD_LABEL[king.kind]}`} width={KING_SIZE.width} height={KING_SIZE.height} isInteractive />
              <Text color="subtle" wrap="truncate-end">{CLAWD_LABEL[king.kind]}</Text>
            </Box>
            <Box flexGrow={1} flexDirection="row" alignItems="flex-start" justifyContent="space-between" backgroundColor="#151517" borderStyle="round" borderColor="#2a2a2d" paddingX={1}>
              <Svg source={card.source} alt={alt} width={card.width} height={card.height} isInteractive />
              <Box flexShrink={0} marginLeft={1}>{cardFold}</Box>
            </Box>
          </Box>
          {crewBlock}
        </Box>
      )
    }

    /* ----- open, in the terminal: one line for the three gauges, then the crew ----- */
    const gauge = (label: string, pct: number | null, color: string) => {
      const p = Math.min(Math.max(pct ?? 0, 0), 100)
      const n = p > 0 ? Math.max(1, Math.round((p / 100) * CELLS)) : 0
      return (
        <Box flexDirection="row" flexShrink={0} marginRight={3} gap={1}>
          <Text color="subtle">{label}</Text>
          <Box flexDirection="row">
            <Text color={color}>{'━'.repeat(n)}</Text>
            <Text color="inactive">{'─'.repeat(CELLS - n)}</Text>
          </Box>
          <Text color={pct === null ? 'subtle' : color}>{pctText(pct)}</Text>
        </Box>
      )
    }
    const contextBar = () => {
      const p = Math.min(Math.max(context ?? 0, 0), 100)
      if (split === null) {
        const n = p > 0 ? Math.max(1, Math.round((p / 100) * CELLS)) : 0
        return [<Text key="c" color={contextColor}>{'━'.repeat(n)}</Text>, <Text key="r" color="inactive">{'─'.repeat(CELLS - n)}</Text>]
      }
      let used = 0
      const parts = LAYERS.map(l => {
        const n = Math.round((split[l.key] / 100) * CELLS)
        used += n
        return <Text key={l.key} color={rampColor(l.rgb, context)}>{'━'.repeat(n)}</Text>
      })
      return [...parts, <Text key="r" color="inactive">{'─'.repeat(Math.max(0, CELLS - used))}</Text>]
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" paddingX={1}>
          {gauge('5h', five, fiveColor)}
          {gauge('semana', week, weekColor)}
          <Box flexDirection="row" flexShrink={0} marginRight={3} gap={1}>
            <Text color="subtle">contexto</Text>
            <Box flexDirection="row">{contextBar()}</Box>
            <Text color={context === null ? 'subtle' : contextColor}>{pctText(context)}</Text>
          </Box>
          {cache && <Text color={cache.dot}>● </Text>}
          {cache && <Text color="subtle">{cache.short}</Text>}
          <Box flexGrow={1} />
          <Box width={11} flexShrink={0} justifyContent="flex-end">{cardFold}</Box>
        </Box>
        {crewBlock}
      </Box>
    )
  })
}
