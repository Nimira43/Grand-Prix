import { drawGrass, drawPieces } from '../track/render.js'
import { analyseTrack } from '../track/analyse.js'

const cache = new Map()

export function drawPreview(canvas, track, { details = false, margin = 1.2 } = {}) {
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = Math.max(40, Math.round((rect.width || canvas.width) * dpr))
  const h = Math.max(30, Math.round((rect.height || canvas.height) * dpr))
  canvas.width = w
  canvas.height = h
  const box = bounds(track)
  const bw = box.x1 - box.x0 + margin * 2
  const bh = box.y1 - box.y0 + margin * 2
  const T = Math.min(w / bw, h / bh)
  const ctx = canvas.getContext('2d')
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.translate((w - bw * T) / 2 - (box.x0 - margin) * T, (h - bh * T) / 2 - (box.y0 - margin) * T)
  drawGrass(ctx, track.cols, track.rows, T)
  drawPieces(ctx, track.pieces, T, { details })
}

function bounds(track) {
  const key = JSON.stringify(track.pieces)
  if (cache.has(key)) return cache.get(key)
  let box = { x0: 0, y0: 0, x1: track.cols, y1: track.rows }
  const a = analyseTrack(track)
  if (a.ok) {
    const xs = a.loop.centre.map((p) => p[0])
    const ys = a.loop.centre.map((p) => p[1])
    box = { x0: Math.min(...xs) - 0.6, y0: Math.min(...ys) - 0.6, x1: Math.max(...xs) + 0.6, y1: Math.max(...ys) + 0.6 }
  }
  cache.set(key, box)
  return box
}
