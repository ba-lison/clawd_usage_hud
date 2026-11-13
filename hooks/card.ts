import { miniClawd } from './clawd'

// The card, drawn as one SVG on surfaces that take it: three hairline bars of the same length
// (Janela 5h, Semana, Contexto) with a walking mini Clawd at each tip, the figures in one column,
// the detail in two aligned columns, and a foot line with the context's layers and the cache.
export const CARD = {
  width: 620,
  label: 0,
  bar: 80,
  barWidth: 200,
  pct: 294,
  detail: 344,
  tail: 470, // the detail's second column, so the rows' "faltam" line up
  rowGap: 22,
  top: 13,
} as const

const FONT = 13
const SMALL = 11
const GAP = 14 // between a text's end and the next column
const SEP_GAP = 14 // from the separator dot to the second column

export const INK = {
  label: '#7c7c82',
  detail: '#85858b',
  sep: '#3f3f44',
  faded: '#6e6e73',
  quiet: '#5f5f64',
  remaining: '#a1a1a6',
} as const

export type Run = { text: string; color: string }

// One stretch of a bar: how much of the whole it fills, and its color.
export type Segment = { pct: number; color: string }

export type Row = {
  id: string
  label: string
  // The whole bar's fill, which the mini Clawd walks at the tip of; null before a reading.
  pct: number | null
  figure: Run
  lead: Run | null
  tail: readonly Run[]
  // The fill: one segment for a gauge, one per layer for the context.
  segments: readonly Segment[]
  // The mini Clawd's color.
  tip: string
  isHopping: boolean
}

// The foot line: the context's layers on the left, the cache on the right.
export type Foot = {
  legend: readonly { label: string; pct: number; color: string }[]
  cache: { dot: string; text: string } | null
}

// The last percent each bar was drawn at, so a new figure grows from the old one.
const drawnAt = new Map<string, number>()

export function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A generous guess of a text's width in a UI sans (Inter, Segoe UI), in ems per character,
// so the columns err toward a little extra space instead of an overlap.
function em(ch: string): number {
  if (/[0-9]/.test(ch)) return 0.62 // tabular figures
  if (ch === ' ') return 0.3
  if (/[.,:;·'|!il]/.test(ch)) return 0.32
  if (/[/()\-–fjrt]/.test(ch)) return 0.42
  if (/[mwMW%]/.test(ch)) return 0.9
  if (/[A-Z]/.test(ch)) return 0.7
  return 0.58
}

export function textWidth(text: string, size = FONT, bold = false): number {
  let w = 0
  for (const ch of text) w += em(ch)
  return w * size * (bold ? 1.05 : 1)
}

function runsWidth(runs: readonly Run[]): number {
  return runs.reduce((w, run) => w + textWidth(run.text), 0)
}

function legendWidth(foot: Foot): number {
  return foot.legend.reduce((w, item) => w + 12 + textWidth(`${item.label} ${item.pct}%`, SMALL) + 14, 0)
}

// Where each column starts, shared by every row so they stay aligned.
export function layout(rows: readonly Row[], foot: Foot): { detail: number; tail: number; width: number } {
  const detail = Math.max(CARD.detail, ...rows.map(row => CARD.pct + textWidth(row.figure.text, FONT, true) + GAP))
  const tail = Math.max(CARD.tail, ...rows.map(row => (row.lead ? detail + textWidth(row.lead.text) + GAP + SEP_GAP : 0)))
  const rowsWidth = Math.max(...rows.map(row => Math.ceil((row.tail.length > 0 ? tail : detail) + runsWidth(row.tail) + 4)))
  const footWidth = CARD.bar + legendWidth(foot) + (foot.cache ? textWidth(foot.cache.text, SMALL) + 24 : 0)
  return { detail, tail, width: Math.ceil(Math.max(CARD.width, rowsWidth, footWidth)) }
}

function hairline(row: Row, cy: number): string {
  const p = Math.min(Math.max(row.pct ?? 0, 0), 100)
  const prev = drawnAt.get(row.id) ?? 0
  drawnAt.set(row.id, p)
  const x = CARD.bar
  const w = (p / 100) * CARD.barWidth
  const w0 = (prev / 100) * CARD.barWidth
  const ease = 'dur=".7s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".16 1 .3 1"'
  let at = x
  const fills = row.segments.map(seg => {
    const sw = (Math.min(Math.max(seg.pct, 0), 100) / 100) * CARD.barWidth
    const rect = `<rect x="${at.toFixed(1)}" y="${cy - 1}" width="${sw.toFixed(1)}" height="2" fill="${seg.color}"/>`
    at += sw
    return rect
  })
  const walker =
    row.pct !== null
      ? [
          `<g transform="translate(${x + w} ${cy - 1})">`,
          `<animateTransform attributeName="transform" type="translate" from="${x + w0} ${cy - 1}" to="${x + w} ${cy - 1}" ${ease}/>`,
          miniClawd(row.tip, row.isHopping),
          '</g>',
        ].join('')
      : ''
  return [
    `<rect x="${x}" y="${cy - 1}" width="${CARD.barWidth}" height="2" rx="1" fill="#ffffff" fill-opacity=".07"/>`,
    fills.join(''),
    walker,
  ].join('')
}

function texts(row: Row, cy: number, at: { detail: number; tail: number }): string {
  const y = `y="${cy}" dominant-baseline="central"`
  const tail = row.tail.map(run => `<tspan fill="${run.color}">${esc(run.text)}</tspan>`).join('')
  return [
    `<text x="${CARD.label}" ${y} fill="${INK.label}">${esc(row.label)}</text>`,
    `<text x="${CARD.pct}" ${y} fill="${row.figure.color}" font-weight="500">${esc(row.figure.text)}</text>`,
    row.lead ? `<text x="${at.detail}" ${y} fill="${row.lead.color}">${esc(row.lead.text)}</text>` : '',
    row.tail.length > 0
      ? `<text x="${at.tail - SEP_GAP}" ${y} fill="${INK.sep}">·</text><text x="${at.tail}" ${y}>${tail}</text>`
      : '',
  ].join('')
}

function footLine(foot: Foot, cy: number, width: number): string {
  const y = `y="${cy}" dominant-baseline="central" font-size="${SMALL}"`
  let x: number = CARD.bar
  const legend = foot.legend.map(item => {
    const text = `${item.label} ${item.pct}%`
    const out = `<rect x="${x}" y="${cy - 4}" width="8" height="8" rx="2" fill="${item.color}"/><text x="${x + 12}" ${y} fill="${INK.detail}">${esc(text)}</text>`
    x += 12 + textWidth(text, SMALL) + 14
    return out
  })
  const cache = foot.cache
    ? `<text x="${width - 4}" ${y} text-anchor="end"><tspan fill="${foot.cache.dot}">●</tspan><tspan fill="${INK.quiet}" dx="5">${esc(foot.cache.text)}</tspan></text>`
    : ''
  return legend.join('') + cache
}

// The SVG, its width and height: wider than CARD.width only when a text needs the room.
export function svgCard(rows: readonly Row[], foot: Foot): { source: string; width: number; height: number } {
  const at = layout(rows, foot)
  const hasFoot = foot.legend.length > 0 || foot.cache !== null
  const height = CARD.top + (rows.length - 1) * CARD.rowGap + (hasFoot ? CARD.rowGap : 0) + 12
  const body = rows.map((row, i) => {
    const cy = CARD.top + i * CARD.rowGap
    return hairline(row, cy) + texts(row, cy, at)
  })
  const source = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${at.width}" height="${height}" viewBox="0 0 ${at.width} ${height}" overflow="visible"`,
    ` font-family="Inter, -apple-system, 'Segoe UI', system-ui, sans-serif" font-size="${FONT}" style="font-variant-numeric:tabular-nums">`,
    ...body,
    hasFoot ? footLine(foot, CARD.top + rows.length * CARD.rowGap - 2, at.width) : '',
    '</svg>',
  ].join('')
  return { source, width: at.width, height }
}
