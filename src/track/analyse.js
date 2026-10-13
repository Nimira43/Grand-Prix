import {
  PIECES,
  ROAD_WIDTH,
  START_LAYOUT,
  START_WIDTH,
  TILE_METRES,
  makeXform,
  pieceGeometry,
  portKey,
  xformDir,
} from './pieces.js'

export const CHECKPOINT_SPACING = 4
const SAMPLE_STEP = 0.25

export function analyseTrack(track) {
  const result = {
    ok: false,
    errors: [],
    dangling: [],
    orphans: [],
    loop: null,
  }
  const pieces = track.pieces

  if (!pieces.length) {
    result.errors.push(
      'The map is empty. Start by placing the start straight (7).',
    )
    return result
  }

  const geo = new Map(pieces.map((p) => [p.id, pieceGeometry(p)]))

  const portMap = new Map()
  for (const piece of pieces) {
    geo.get(piece.id).ports.forEach((pt, index) => {
      const k = portKey(pt)
      if (!portMap.has(k)) portMap.set(k, [])
      portMap.get(k).push({ piece, index, pt })
    })
  }

  const partnerOf = (piece, pt) =>
    (portMap.get(portKey(pt)) ?? []).find(
      (e) => e.piece !== piece && e.pt.dx === -pt.dx && e.pt.dy === -pt.dy,
    ) ?? null

  for (const piece of pieces) {
    for (const pt of geo.get(piece.id).ports) {
      if (!partnerOf(piece, pt))
        result.dangling.push({ ...pt, pieceId: piece.id })
    }
  }
  if (result.dangling.length) {
    const n = result.dangling.length
    result.errors.push(
      `${n} open road end${n === 1 ? '' : 's'}: every road must join another piece.`,
    )
  }

  const start = track.startPiece
  if (!start) {
    result.errors.push(
      'No start straight (7). Every circuit needs exactly one.',
    )
    return result
  }

  const order = []
  const visited = new Set()
  let current = start
  let entry = 0
  let closed = false
  for (let guard = 0; guard <= pieces.length; guard++) {
    order.push({ piece: current, entry })
    visited.add(current.id)
    const exitPort = geo.get(current.id).ports[1 - entry]
    const next = partnerOf(current, exitPort)
    if (!next) break
    if (next.piece === start) {
      closed = next.index === 0
      break
    }
    if (visited.has(next.piece.id)) break
    current = next.piece
    entry = next.index
  }

  result.orphans = pieces.filter((p) => !visited.has(p.id)).map((p) => p.id)
  if (!closed && !result.dangling.length) {
    result.errors.push(
      'The road from the start straight never comes back round to it.',
    )
  }
  if (closed && result.orphans.length) {
    const n = result.orphans.length
    result.errors.push(
      `${n} piece${n === 1 ? ' is' : 's are'} not part of the circuit.`,
    )
  }

  if (!closed || result.errors.length) return result

  result.ok = true
  result.loop = buildLoop(order, geo, start, track)
  return result
}

function buildLoop(order, geo, start, track) {
  const centre = []
  for (const { piece, entry } of order) {
    let path = geo.get(piece.id).path
    if (entry === 1) path = [...path].reverse()
    const from = centre.length ? 1 : 0
    for (let i = from; i < path.length; i++) centre.push(path[i])
  }
  centre.pop()

  const samples = resampleLoop(centre, SAMPLE_STEP)
  const length = samples.length * SAMPLE_STEP

  const startLen = PIECES.start.w
  const finishS = START_LAYOUT.finishU

  const halfWidthAt = (s) => {
    const d = ((s % length) + length) % length
    if (d >= START_LAYOUT.taperIn && d <= START_LAYOUT.taperOut)
      return START_WIDTH / 2
    return ROAD_WIDTH / 2
  }

  const count = Math.max(3, Math.round(length / CHECKPOINT_SPACING))
  const checkpoints = []
  for (let k = 0; k < count; k++) {
    const s = (finishS + (k * length) / count) % length
    const p = sampleAt(samples, s, SAMPLE_STEP)
    checkpoints.push({
      index: k,
      s,
      x: p.x,
      y: p.y,
      nx: p.nx,
      ny: p.ny,
      halfWidth: halfWidthAt(s) + 0.08,
    })
  }

  const racingLine = buildRacingLine(samples)

  const xf = makeXform('start', start.rot, start.mirror, start.x, start.y)
  const [hx, hy] = xformDir(1, 0, start.rot, start.mirror)
  const heading = Math.atan2(hy, hx)
  const grid = START_LAYOUT.gridSlots.map(([u, v], i) => {
    const [x, y] = xf(u, v)
    return { position: i + 1, x, y, heading }
  })

  const corners = order.filter(({ piece }) => PIECES[piece.type].kerbs).length

  return {
    centre: samples.map((p) => [p.x, p.y]),
    length,
    lengthKm: (length * TILE_METRES) / 1000,
    raceKm: (length * TILE_METRES * track.laps) / 1000,
    startLength: startLen,
    checkpoints,
    racingLine,
    grid,
    heading,
    corners,
    pieceOrder: order.map(({ piece, entry }) => ({ id: piece.id, entry })),
  }
}

function resampleLoop(points, step) {
  const closed = [...points, points[0]]
  const segLen = []
  let total = 0
  for (let i = 0; i < closed.length - 1; i++) {
    const l = Math.hypot(
      closed[i + 1][0] - closed[i][0],
      closed[i + 1][1] - closed[i][1],
    )
    segLen.push(l)
    total += l
  }
  const n = Math.max(8, Math.round(total / step))
  const actualStep = total / n
  const out = []
  let seg = 0
  let segStart = 0
  for (let k = 0; k < n; k++) {
    const s = k * actualStep
    while (seg < segLen.length - 1 && segStart + segLen[seg] < s) {
      segStart += segLen[seg]
      seg++
    }
    const t = segLen[seg] ? (s - segStart) / segLen[seg] : 0
    const a = closed[seg]
    const b = closed[seg + 1]
    out.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t })
  }
  for (let i = 0; i < n; i++) {
    const prev = out[(i - 1 + n) % n]
    const next = out[(i + 1) % n]
    let tx = next.x - prev.x
    let ty = next.y - prev.y
    const l = Math.hypot(tx, ty) || 1
    tx /= l
    ty /= l
    out[i].tx = tx
    out[i].ty = ty
    out[i].nx = -ty
    out[i].ny = tx
  }
  return out
}

function sampleAt(samples, s, step) {
  const n = samples.length
  const f = (((s / step) % n) + n) % n
  const i = Math.floor(f)
  const t = f - i
  const a = samples[i]
  const b = samples[(i + 1) % n]
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    nx: a.nx,
    ny: a.ny,
  }
}

function buildRacingLine(samples) {
  const n = samples.length
  const limit = ROAD_WIDTH / 2 - 0.1
  const offset = new Float64Array(n)
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const place = (i) => {
    px[i] = samples[i].x + samples[i].nx * offset[i]
    py[i] = samples[i].y + samples[i].ny * offset[i]
  }
  for (let i = 0; i < n; i++) place(i);
  for (let iter = 0; iter < 400; iter++) {
    for (let i = 0; i < n; i++) {
      const a = (i - 1 + n) % n
      const b = (i + 1) % n
      const mx = (px[a] + px[b]) / 2 - samples[i].x
      const my = (py[a] + py[b]) / 2 - samples[i].y
      const o = mx * samples[i].nx + my * samples[i].ny
      offset[i] = Math.max(-limit, Math.min(limit, o))
      place(i)
    }
  }
  const line = []
  for (let i = 0; i < n; i++) line.push([px[i], py[i]])
  return line
}
