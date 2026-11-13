// Gera as 14 poses do Rei Clawd (SVG) para embutir no protótipo.
// Uso: node --experimental-strip-types gerar-poses.mjs  (Node 22+)
// Enquanto o mod não tiver hooks/clawd.ts próprio, lê o do usage-hud.
import { clawdSvg, CLAWD_LABEL } from '../../../usage-hud/hooks/clawd.ts'
import { writeFileSync } from 'node:fs'
const out = {}
for (const k of Object.keys(CLAWD_LABEL)) out[k] = { label: CLAWD_LABEL[k], svg: clawdSvg(k) }
writeFileSync('poses.js', 'const POSES=' + JSON.stringify(out) + ';\n')
console.log(Object.keys(out).length, 'poses')
