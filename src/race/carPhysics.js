import { TEAMS, ENGINES } from '../data/grid.js'
import { GRASS, BARRIER, surfaceAt } from './surface.js'

export const PHYS = {
  topSpeed: 8.0, // tiles/s for an engine rated 8
  accel: 5.5, // tiles/s² off the line, engine 8
  grip: 26, // lateral grip, tiles/s², chassis 7
  grassTop: 2.6, // top speed with all four wheels on grass
  grassDrag: 9, // how hard grass slows you when you're faster than that


  // steerLow: 5.0, // how fast the nose rotates at full lock, at walking pace (rad/s)
  steerLow: 2.8, // how fast the nose rotates at full lock, at walking pace (rad/s)


  //steerHigh: 3.4, // ...and at top speed (just more than the tyres can follow)
  steerHigh: 2.4, // ...and at top speed (just more than the tyres can follow)


  //steerBuild: 2.6, // how quickly lock winds on while O/P is held (full lock in ~0.4s)
  steerBuild: 2.0, // how quickly lock winds on while O/P is held (full lock in ~0.4s)


  steerReturn: 6, // how quickly the wheel self-centres when you let go
  maxSlip: 0.3, // largest gap between nose and direction of travel (rad)
  slipBrake: 14, // speed scrubbed per second when steering past the grip limit
  brake: 13, // tiles/s² with the brake fully on (320 → 0 km/h in about 0.6s)
  coast: 1.2, // tiles/s² lost off the throttle (engine braking)
  coastAero: 0.18, // ...plus this much per tile/s of speed (drag)
  pivotMin: 0.3, // share of steering you still get when nearly stopped
  turnScrub: 0.1, // gentle scrub from cornering at all
  barrierKeep: 0.35, // fraction of speed kept after hitting the tyres
  barrierMargin: 0.18, // car half-size used against the barrier (tiles)
  kmhPerTile: 40, // display only: 8 tiles/s ≈ 320 km/h
}

export function carStats(teamId) {
  const team = TEAMS[teamId]
  const engine = ENGINES[team.engine].rating
  const chassis = team.chassis
  return {
    teamId,
    top: PHYS.topSpeed * (1 + 0.006 * (engine - 8)),
    accel: PHYS.accel * (1 + 0.02 * (engine - 8)),
    grip: PHYS.grip * (1 + 0.012 * (chassis - 7)),
  }
}

export function createCar(stats, x, y, heading) {
  return {
    stats,
    x,
    y,
    heading,
    travel: heading,
    speed: 0,
    grassFrac: 0, // 0–1: share of wheels on the grass
    slip: 0, // 0–1: how far past the grip limit we're steering
    hitBarrier: 0, // >0 for a moment after a barrier hit (for effects)
    steer: 0, // current steering lock, -1 to 1: it winds on, it doesn't jump
    gear: 1,
    rpm: 4000,
  }
}

const TAU = Math.PI * 2
export const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU)
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// Wheel positions relative to the car centre: [forward, side]
const WHEELS = [
  [0.11, -0.085],
  [0.11, 0.085],
  [-0.11, -0.09],
  [-0.11, 0.09],
]

const steerRate = (car) =>
  (PHYS.steerLow +
    (PHYS.steerHigh - PHYS.steerLow) * Math.min(1, car.speed / car.stats.top)) *
  Math.min(1, PHYS.pivotMin + car.speed)

export function steerTowards(car, angle, dt) {
  return clamp(wrapAngle(angle - car.heading) / (steerRate(car) * dt), -1, 1)
}

// One fixed physics step. input = { steer, throttle, brake }
//   steer    — car-relative: -1 full left, 0 straight, +1 full right
//   throttle — 0 to 1
//   brake    — 0 to 1
export function stepCar(car, input, dt, surface) {
  const s = car.stats
  const v = car.speed
  const asked = clamp(input.steer ?? 0, -1, 1)
  const rate = (asked === 0 ? PHYS.steerReturn : PHYS.steerBuild) * dt
  car.steer += clamp(asked - car.steer, -rate, rate)
  const steer = car.steer
  const throttle = clamp(input.throttle ?? 0, 0, 1)
  const brake = clamp(input.brake ?? 0, 0, 1)
  car.braking = brake > 0 && v > 0.1
  car.throttle = throttle
  car.heading += steer * steerRate(car) * dt

  const maxTurn = s.grip / Math.max(v, 1)
  const want = wrapAngle(car.heading - car.travel)
  const turn = clamp(want, -maxTurn * dt, maxTurn * dt)
  car.travel = wrapAngle(car.travel + turn)

  let slip = wrapAngle(car.heading - car.travel)
  if (Math.abs(slip) > PHYS.maxSlip) {
    slip = Math.sign(slip) * PHYS.maxSlip
    car.heading = car.travel + slip
  }
  car.heading = wrapAngle(car.heading)

  const over = Math.abs(want) > Math.abs(turn) + 1e-6
  car.slip = over
    ? Math.min(1, Math.abs(slip) / PHYS.maxSlip)
    : (Math.abs(slip) / PHYS.maxSlip) * 0.3

  const cos = Math.cos(car.heading)
  const sin = Math.sin(car.heading)
  let onGrass = 0
  for (const [f, side] of WHEELS) {
    const kind = surfaceAt(
      surface,
      car.x + cos * f - sin * side,
      car.y + sin * f + cos * side,
    )
    if (kind === GRASS || kind === BARRIER) onGrass++
  }
  car.grassFrac = onGrass / WHEELS.length
  const top = s.top * (1 - car.grassFrac) + PHYS.grassTop * car.grassFrac

  let speed = v
  if (speed > top) {
    speed = Math.max(top, speed - PHYS.grassDrag * dt) 
  } else if (throttle > 0) {
    speed = Math.min(
      top,
      speed + throttle * s.accel * (1 - (speed / top) ** 2) * dt + 0.02 * dt,
    )
  }
  if (throttle === 0) speed -= (PHYS.coast + PHYS.coastAero * speed) * dt
  speed -= brake * PHYS.brake * dt
  if (over) speed -= PHYS.slipBrake * car.slip * dt
  speed -= PHYS.turnScrub * Math.abs(turn / dt) * speed * dt
  car.speed = Math.max(0, speed)

  let vx = Math.cos(car.travel) * car.speed
  let vy = Math.sin(car.travel) * car.speed
  let x = car.x + vx * dt
  let y = car.y + vy * dt
  const m = PHYS.barrierMargin
  let hit = false
  if (x < m || x > surface.cols - m) {
    x = clamp(x, m, surface.cols - m)
    vx = 0
    hit = true
  }
  if (y < m || y > surface.rows - m) {
    y = clamp(y, m, surface.rows - m)
    vy = 0
    hit = true
  }
  car.x = x
  car.y = y
  if (hit) {
    const along = Math.hypot(vx, vy)
    car.hitBarrier = Math.max(car.hitBarrier, car.speed / s.top)
    car.speed = along * PHYS.barrierKeep
    if (along > 0.05) car.travel = Math.atan2(vy, vx)
    slip = wrapAngle(car.heading - car.travel)
    if (Math.abs(slip) > PHYS.maxSlip)
      car.heading = wrapAngle(car.travel + Math.sign(slip) * PHYS.maxSlip)
  }
  car.hitBarrier = Math.max(0, car.hitBarrier - dt * 3)

  updateGearbox(car)
}

const GEAR_TOPS = [0.24, 0.37, 0.5, 0.62, 0.74, 0.87, 1.02]

function updateGearbox(car) {
  const f = car.speed / car.stats.top
  let gear = GEAR_TOPS.findIndex((t) => f <= t)
  if (gear < 0) gear = GEAR_TOPS.length - 1
  const lo = gear === 0 ? 0 : GEAR_TOPS[gear - 1]
  const hi = GEAR_TOPS[gear]
  const t = clamp((f - lo) / (hi - lo), 0, 1)
  car.gear = gear + 1
  car.rpm = gear === 0 ? 4000 + 11000 * t : 9000 + 6000 * t
}

export const speedKmh = (car) => Math.round(car.speed * PHYS.kmhPerTile)
