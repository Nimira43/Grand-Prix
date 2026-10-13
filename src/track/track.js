import { PIECES, footprint } from './pieces.js'

export const MIN_COLS = 30
export const MIN_ROWS = 18
export const MAX_COLS = 60
export const MAX_ROWS = 40
export const MAX_LAPS = 30
export const FORMAT_VERSION = 1

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export class Track {
  constructor({
    name = 'Untitled Circuit',
    laps = 8,
    cols = MAX_COLS,
    rows = MAX_ROWS,
  } = {}) {
    this.name = name
    this.laps = clamp(Math.round(laps) || 8, 1, MAX_LAPS)
    this.cols = clamp(Math.round(cols) || MAX_COLS, MIN_COLS, MAX_COLS)
    this.rows = clamp(Math.round(rows) || MAX_ROWS, MIN_ROWS, MAX_ROWS)
    this.pieces = []
    this.nextId = 1
    this.cells = new Int32Array(this.cols * this.rows).fill(0)
  }

  inBounds(cx, cy) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows
  }

  pieceAt(cx, cy) {
    if (!this.inBounds(cx, cy)) return null
    const id = this.cells[cy * this.cols + cx]
    return id ? (this.pieces.find((p) => p.id === id) ?? null) : null
  }

  get startPiece() {
    return this.pieces.find((p) => p.type === 'start') ?? null
  }

  canPlace(type, x, y, rot) {
    const def = PIECES[type]
    if (!def) return { ok: false, reason: 'Unknown piece' }
    const { w, h } = footprint(type, rot)
    if (x < 0 || y < 0 || x + w > this.cols || y + h > this.rows) {
      return { ok: false, reason: 'Off the edge of the map' }
    }
    if (def.unique && this.pieces.some((p) => p.type === type)) {
      return {
        ok: false,
        reason: `Only one ${def.label.toLowerCase()} per track`,
      }
    }
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) {
        if (this.cells[j * this.cols + i])
          return { ok: false, reason: 'Overlaps another piece' }
      }
    }
    return { ok: true, reason: '' }
  }

  place(type, x, y, rot = 0, mirror = false) {
    if (!this.canPlace(type, x, y, rot).ok) return null
    const piece = {
      id: this.nextId++,
      type,
      x,
      y,
      rot: rot & 3,
      mirror: !!mirror,
    }
    this.pieces.push(piece)
    this.#mark(piece, piece.id)
    return piece
  }

  remove(id) {
    const i = this.pieces.findIndex((p) => p.id === id)
    if (i < 0) return false
    this.#mark(this.pieces[i], 0)
    this.pieces.splice(i, 1)
    return true
  }

  clear() {
    this.pieces = []
    this.cells.fill(0)
  }

  resize(cols, rows) {
    cols = clamp(Math.round(cols) || this.cols, MIN_COLS, MAX_COLS)
    rows = clamp(Math.round(rows) || this.rows, MIN_ROWS, MAX_ROWS)
    const fits = this.pieces.every((p) => {
      const { w, h } = footprint(p.type, p.rot)
      return p.x + w <= cols && p.y + h <= rows
    })
    if (!fits) return false
    this.cols = cols
    this.rows = rows
    this.cells = new Int32Array(cols * rows).fill(0)
    for (const p of this.pieces) this.#mark(p, p.id)
    return true
  }

  #mark(piece, value) {
    const { w, h } = footprint(piece.type, piece.rot)
    for (let j = piece.y; j < piece.y + h; j++) {
      for (let i = piece.x; i < piece.x + w; i++)
        this.cells[j * this.cols + i] = value
    }
  }

  toJSON() {
    return {
      format: 'grand-prix-track',
      version: FORMAT_VERSION,
      name: this.name,
      laps: this.laps,
      cols: this.cols,
      rows: this.rows,
      pieces: this.pieces.map(({ type, x, y, rot, mirror }) => ({
        type,
        x,
        y,
        rot,
        mirror,
      })),
    }
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.pieces)) {
      throw new Error('Not a Grand Prix track file')
    }
    const track = new Track(data)
    let skipped = 0
    for (const p of data.pieces) {
      const ok =
        p &&
        PIECES[p.type] &&
        track.place(p.type, p.x | 0, p.y | 0, p.rot | 0, !!p.mirror)
      if (!ok) skipped++
    }
    track.skipped = skipped
    return track
  }

  clone() {
    return Track.fromJSON(this.toJSON())
  }
}
