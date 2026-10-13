import {
  PIECES,
  ROAD_WIDTH,
  START_LAYOUT,
  START_WIDTH,
  localMatrix,
} from './pieces.js'
import { TEAMS, TEAM_ORDER } from '../data/grid.js'

export const COLOURS = {
  grassA: '#2e8b3a',
  grassB: '#2a8235',
  asphalt: '#4a4e55',
  pitLane: '#5a5e66',
  edge: '#f2f2f2',
  kerbRed: '#d2232a',
  kerbWhite: '#f4f4f4',
  garageRoof: '#24272d',
}

const EXTEND = 0.03

export function drawGrass(ctx, cols, rows, T) {
  ctx.fillStyle = COLOURS.grassA
  ctx.fillRect(0, 0, cols * T, rows * T)
  ctx.fillStyle = COLOURS.grassB
  for (let x = 0; x < cols; x += 4) ctx.fillRect(x * T, 0, 2 * T, rows * T)
}

export function drawPieces(ctx, pieces, T) {
  const withLocal = (piece, fn) => {
    const [a, b, c, d, e, f] = localMatrix(piece)
    ctx.save()
    ctx.transform(a * T, b * T, c * T, d * T, e * T, f * T)
    fn(PIECES[piece.type])
    ctx.restore()
  }

  ctx.lineJoin = 'round'
  ctx.lineCap = 'butt'

  for (const piece of pieces) {
    withLocal(piece, (def) => {
      if (piece.type === 'start') return startEdges(ctx)
      tracePath(ctx, def)
      if (def.kerbs) {
        ctx.lineWidth = ROAD_WIDTH + 0.16
        ctx.strokeStyle = COLOURS.kerbRed
        ctx.stroke()
        ctx.setLineDash([0.2, 0.2])
        ctx.strokeStyle = COLOURS.kerbWhite
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.lineWidth = ROAD_WIDTH + 0.08
        ctx.strokeStyle = COLOURS.edge
        ctx.stroke()
      }
    })
  }

  for (const piece of pieces) {
    withLocal(piece, (def) => {
      if (piece.type === 'start') return startSurface(ctx)
      tracePath(ctx, def)
      ctx.lineWidth = ROAD_WIDTH
      ctx.strokeStyle = COLOURS.asphalt
      ctx.stroke()
    })
  }

  for (const piece of pieces) {
    if (piece.type === 'start') withLocal(piece, () => startDetails(ctx))
  }
}

function tracePath(ctx, def) {
  const pts = def.path
  const [p0, p1] = def.ports
  ctx.beginPath()
  ctx.moveTo(pts[0][0] + p0.dx * EXTEND, pts[0][1] + p0.dy * EXTEND)
  for (const [x, y] of pts) ctx.lineTo(x, y)
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0] + p1.dx * EXTEND, last[1] + p1.dy * EXTEND)
}

const MID = 1.5
const { taperIn, taperOut } = START_LAYOUT
const LEN = PIECES.start.w

function startOutline(side) {
  const n = (ROAD_WIDTH / 2) * side
  const wide = (START_WIDTH / 2) * side
  return [
    [-EXTEND, MID + n],
    [0, MID + n],
    [taperIn, MID + wide],
    [taperOut, MID + wide],
    [LEN, MID + n],
    [LEN + EXTEND, MID + n],
  ]
}

function polyline(ctx, pts) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
}

function startEdges(ctx) {
  ctx.strokeStyle = COLOURS.edge
  polyline(ctx, START_LAYOUT.pitLane)
  ctx.lineWidth = 0.36
  ctx.stroke()
  ctx.lineWidth = 0.08
  polyline(ctx, startOutline(-1))
  ctx.stroke()
  polyline(ctx, startOutline(1))
  ctx.stroke()
}

function startSurface(ctx) {
  polyline(ctx, START_LAYOUT.pitLane)
  ctx.lineWidth = 0.3
  ctx.strokeStyle = COLOURS.pitLane
  ctx.stroke()

  const top = startOutline(-1)
  const bottom = startOutline(1).reverse()
  polyline(ctx, [...top, ...bottom])
  ctx.closePath()
  ctx.fillStyle = COLOURS.asphalt
  ctx.fill()
}

function startDetails(ctx) {
  polyline(ctx, START_LAYOUT.pitWall)
  ctx.lineWidth = 0.06
  ctx.strokeStyle = '#d9d9d9'
  ctx.stroke()

  const g0 = 1.9
  const g1 = 8.1
  ctx.fillStyle = COLOURS.garageRoof
  ctx.fillRect(g0, 0.04, g1 - g0, 0.32)
  const gw = (g1 - g0) / TEAM_ORDER.length
  TEAM_ORDER.forEach((id, i) => {
    const team = TEAMS[id]
    const x = g0 + i * gw + 0.04
    ctx.fillStyle = team.colour
    ctx.fillRect(x, 0.08, gw - 0.08, 0.2)
    ctx.fillStyle = team.accent
    ctx.fillRect(x, 0.26, gw - 0.08, 0.04)
  })

  ctx.strokeStyle = COLOURS.edge
  ctx.lineWidth = 0.035
  for (const [u, v] of START_LAYOUT.gridSlots) {
    ctx.beginPath()
    ctx.moveTo(u + 0.06, v - 0.13)
    ctx.lineTo(u + 0.22, v - 0.13)
    ctx.lineTo(u + 0.22, v + 0.13)
    ctx.lineTo(u + 0.06, v + 0.13)
    ctx.stroke()
  }

  const u = START_LAYOUT.finishU
  const top = MID - START_WIDTH / 2
  const rows = 16
  const sq = START_WIDTH / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 2; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#111111' : '#ffffff'
      ctx.fillRect(u - sq + c * sq, top + r * sq, sq, sq)
    }
  }
}

export function drawCar(ctx, x, y, heading, teamId, T) {
  const team = TEAMS[teamId]
  ctx.save()
  ctx.translate(x * T, y * T)
  ctx.rotate(heading)
  ctx.scale(T, T)

  ctx.fillStyle = '#111'
  for (const [tx, ty] of [
    [0.1, -0.085],
    [0.1, 0.085],
    [-0.11, -0.09],
    [-0.11, 0.09],
  ]) {
    ctx.fillRect(tx - 0.035, ty - 0.03, 0.07, 0.06)
  }
  ctx.fillStyle = team.accent
  ctx.fillRect(0.16, -0.1, 0.035, 0.2)
  ctx.fillRect(-0.2, -0.085, 0.04, 0.17)
  ctx.fillStyle = team.colour
  ctx.beginPath()
  ctx.moveTo(0.19, 0)
  ctx.lineTo(0.06, -0.045)
  ctx.lineTo(-0.06, -0.06)
  ctx.lineTo(-0.17, -0.04)
  ctx.lineTo(-0.17, 0.04)
  ctx.lineTo(-0.06, 0.06)
  ctx.lineTo(0.06, 0.045)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#111'
  ctx.fillRect(-0.04, -0.022, 0.06, 0.044)
  ctx.restore()
}
