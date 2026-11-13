// The Clawd-Usage-HUD state contract: what the card and the crew draw from.
// Held by the session in $.state; each session keeps its own.

export type ClawdPose =
  | 'parado'
  | 'pensando'
  | 'lendo'
  | 'editando'
  | 'terminal'
  | 'web'
  | 'orquestrando'
  | 'trabalhando'
  | 'esperando'
  | 'aguardando'
  | 'compactando'
  | 'concluido'
  | 'interrompido'
  | 'erro'

export type UsageReading = {
  // The rate-limit windows, null until a response reports them.
  fiveHourPct: number | null
  fiveHourResetsAt: string | null
  weekPct: number | null
  weekResetsAt: string | null
  // The live context window; null until the session's first response.
  contextPct: number | null
  contextTokens: number | null
  contextWindow: number | null
}

// The context by layer, in tokens, from the /context breakdown after the last main turn.
export type ContextLayers = {
  conversa: number
  ferramentas: number
  arquivos: number
  sistema: number
} | null

export type ClawdState = { kind: ClawdPose; at: number }

// `waiting`: its turn ended, but it holds on background work and resumes under the same id.
export type CrewStatus = 'working' | 'thinking' | 'waiting' | 'done' | 'error'
export type CrewOutcome = 'answer' | 'aborted' | 'error'
export type CrewLog = { at: number; tool: string; target: string }
export type TodoStatus = 'pending' | 'in_progress' | 'completed'
export type CrewTask = { id: string; isDone: boolean; isActive: boolean }

// One subagent, from its spawn to its turn's end.
export type CrewMember = {
  id: string
  type: string
  description: string
  model: string
  window: number
  startedAt: number
  endedAt: number | null
  status: CrewStatus
  outcome: CrewOutcome | null
  tool: string | null
  target: string
  tools: number
  tokens: number
  todos: TodoStatus[] | null
  tasks: CrewTask[]
  log: CrewLog[]
}

export type PeerStatus = 'working' | 'asking' | 'idle'

// One session as it writes itself to the shared folder, for the band of the session that opened it.
export type PeerSession = {
  id: string
  // The desktop app's id for the session (`local_…`), which the session that opened it holds.
  hostId?: string
  project: string
  title: string
  name?: string
  status: PeerStatus
  pose: string
  activity: string
  model: string
  subagents: number
  contextPct: number | null
  tokens: number | null
  window: number | null
  todos: TodoStatus[] | null
  turnStartedAt: number | null
  turnEndedAt: number | null
  startedAt: number
  changedAt: number
  updatedAt: number
  halted?: boolean
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'clawd-usage-hud': {
      now: number
      usage: UsageReading
      layers: ContextLayers
      clawd: ClawdState
      // When the main thread's last model response came back: the prompt cache counts from it.
      lastResponseAt: number
      // The cache warning already asked the session to save its pendências in this idle stretch.
      cacheSaved: boolean
      // Folded: everything starts folded in a new session.
      cardFolded: boolean
      crewFolded: boolean
      nestFolded: boolean
      crew: CrewMember[]
      self: PeerSession | null
      peers: PeerSession[]
      // The desktop ids (`local_…`) of the sessions this one opened.
      children: string[]
      halted: { at: number; from: string } | null
    }
  }
}
