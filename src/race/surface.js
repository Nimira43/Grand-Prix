import { drawPieces } from '../track/render.js'

export const GRASS = 0
export const ROAD = 1
export const KERB = 2
export const BARRIER = 3

export const SURFACE_RES = 16 

export function buildSurface(track) {
  const R = SURFACE_RES
  const w = track.cols * R
  const h = track.rows * R
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, 0, w, h)

  drawPieces(ctx, track.pieces, R, { details: false })
  const { data } = ctx.getImageData(0, 0, w, h)
  const cells = new Uint8Array(w * h)
  for (let i = 0; i < cells.length; i++) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    if (g > r + 40 && g > b + 40) cells[i] = GRASS
    else if (r > 150 && g < 100 && b < 100) cells[i] = KERB
    else cells[i] = ROAD
  }
  return { cols: track.cols, rows: track.rows, res: R, w, h, cells }
}

export function surfaceAt(surface, x, y) {
  const px = Math.floor(x * surface.res)
  const py = Math.floor(y * surface.res)
  if (px < 0 || py < 0 || px >= surface.w || py >= surface.h) return BARRIER
  return surface.cells[py * surface.w + px]
}
