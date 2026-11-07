import { START_LAYOUT, makeXform } from '../track/pieces.js'
import { TEAM_ORDER } from '../data/grid.js'

export const PIT = {
  windowFrom: 3,
  windowTo: 5,
  limiter: 2.0,
  entryDecel: 9,
  boxDecel: 6,
  exitAccel: 4,
  gap: 0.45,
  hardDecel: 28,
  joinSpeed: 5.5,
  approachDecel: 8,
  baySide: 0.1,
  stopBase: 2.3,
  stopPerPoint: 0.18,
  stopNoise: 0.25,
  fumbleChance: 0.012,
  fumbleTime: [1.5, 4],
}

export function pitWindow(laps) {
  const to = Math.min(PIT.windowTo, laps - 1)
  const from = Math.min(PIT.windowFrom, Math.max(1, laps - 2))
  return to >= from && to >= 1 ? { from, to } : null
}

const RAIL_LOCAL = [[0.0, 1.5], ...START_LAYOUT.pitLane, [9.6, 1.35]]
const LANE_START_U = START_LAYOUT.pitLane[1][0]
const LANE_END_U = START_LAYOUT.pitLane[2][0]
const G0 = 1.9
const G1 = 8.1

export class PitLane {
  constructor(startPiece) {
    const xf = makeXform(
      'start',
      startPiece.rot,
      startPiece.mirror,
      startPiece.x,
      startPiece.y,
    )
    this.points = RAIL_LOCAL.map(([u, v]) => xf(u, v))
    this.cum = [0]
    for (let i = 1; i < this.points.length; i++) {
      const [ax, ay] = this.points[i - 1]
      const [bx, by] = this.points[i]
      this.cum.push(this.cum[i - 1] + Math.hypot(bx - ax, by - ay))
    }
    this.length = this.cum.at(-1)
    const along = (u) => this.cum[2] + (u - LANE_START_U)
    this.laneStart = this.cum[2]
    this.laneEnd = this.cum[3]
    this.exitAt = this.cum[4] + 0.15
    const gw = (G1 - G0) / TEAM_ORDER.length
    this.boxes = Object.fromEntries(
      TEAM_ORDER.map((id, i) => [id, along(G0 + gw * (i + 0.5))]),
    )
    this.joinPoint = this.points[0]
    this.entryZone = { from: this.cum[1] - 0.05, to: this.laneEnd }
    this.xf = xf

    const [ax, ay] = xf(5, 1)
    const [bx, by] = xf(5, 0)
    const l = Math.hypot(bx - ax, by - ay) || 1
    this.garageDir = [(bx - ax) / l, (by - ay) / l]
  }

  at(s) {
    s = Math.max(0, Math.min(this.length, s))
    let i = 1
    while (i < this.cum.length - 1 && this.cum[i] < s) i++
    const [ax, ay] = this.points[i - 1]
    const [bx, by] = this.points[i]
    const seg = this.cum[i] - this.cum[i - 1] || 1
    const t = (s - this.cum[i - 1]) / seg
    return {
      x: ax + (bx - ax) * t,
      y: ay + (by - ay) * t,
      heading: Math.atan2(by - ay, bx - ax),
    }
  }

  nearest(x, y) {
    let best = { s: 0, dist: Infinity }
    for (let i = 1; i < this.points.length; i++) {
      const [ax, ay] = this.points[i - 1]
      const [bx, by] = this.points[i]
      const dx = bx - ax
      const dy = by - ay
      const l2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
      const px = ax + dx * t
      const py = ay + dy * t
      const dist = Math.hypot(x - px, y - py)
      if (dist < best.dist)
        best = { s: this.cum[i - 1] + t * Math.sqrt(l2), dist }
    }
    return best
  }

  turningIn(x, y, heading) {
    const n = this.nearest(x, y)
    if (
      n.dist > 0.13 ||
      n.s < this.entryZone.from ||
      n.s > this.laneStart + 0.4
    )
      return null
    const dir = this.at(n.s).heading
    const facing = Math.cos(heading - dir)
    return facing > 0.5 ? n.s : null
  }
}

export function stopTime(team, rng) {
  const below = Math.max(0, 9 - team.chassis)
  let t =
    PIT.stopBase + below * PIT.stopPerPoint + (rng() * 2 - 1) * PIT.stopNoise
  let fumble = false
  if (rng() < below * PIT.fumbleChance) {
    t += PIT.fumbleTime[0] + rng() * (PIT.fumbleTime[1] - PIT.fumbleTime[0])
    fumble = true
  }
  return { time: t, fumble }
}

const GEAR_TOPS = [0.24, 0.37, 0.5, 0.62, 0.74, 0.87, 1.02]
export function railGearbox(car) {
  const f = car.speed / car.stats.top
  let gear = GEAR_TOPS.findIndex((t) => f <= t)
  if (gear < 0) gear = GEAR_TOPS.length - 1
  const lo = gear === 0 ? 0 : GEAR_TOPS[gear - 1]
  const t = Math.min(1, Math.max(0, (f - lo) / (GEAR_TOPS[gear] - lo)))
  car.gear = gear + 1
  car.rpm = gear === 0 ? 4000 + 11000 * t : 9000 + 6000 * t
}
