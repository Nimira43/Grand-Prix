import { PHYS, wrapAngle, stepCar } from './carPhysics.js'
import { ROAD } from './surface.js'
import { ROAD_WIDTH } from '../track/pieces.js'

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

const PREDICT_SURFACE = {
  cols: 1e9,
  rows: 1e9,
  res: 0,
  w: 1,
  h: 1,
  cells: new Uint8Array([ROAD]),
}

export const AI = {
  gripUse: 0.92, 
  steerUse: 0.6, 
  brakeUse: 0.78, 
  steerOptions: [-1, -0.6, -0.3, -0.1, 0, 0.1, 0.3, 0.6, 1],
  horizon: 0.5, 
  planSplit: 0.4,
  headingWeight: 1.5, 
  predictStep: 1 / 30,
  decideEvery: 3,
  laneLimit: ROAD_WIDTH / 2 - 0.13, 
  edgeMargin: 0.13, 
  pace: (rating) => 0.94 + 0.007 * (rating - 5),
  mistakeRate: { clean: 0.0025, normal: 0.005, ragged: 0.01 },
  lap1Factor: 3, 
  pressureFactor: 2, 
  mistakeMix: [0.62, 0.3, 0.08],
  racecraft: {
    calm: { passGap: 0.7, commit: 0.55, followGap: 0.62 },
    normal: { passGap: 0.9, commit: 0.75, followGap: 0.5 },
    aggressive: { passGap: 1.15, commit: 0.95, followGap: 0.38 },
  },
}

export const DIFFICULTY = {
  easy: { label: 'Easy', pace: 0.9 },
  normal: { label: 'Normal', pace: 0.96 },
  hard: { label: 'Hard', pace: 1.0 },
}

export function prepareLine(points, centre) {
  const n = points.length
  const step =
    points.reduce((sum, p, i) => {
      const q = points[(i + 1) % n]
      return sum + Math.hypot(q[0] - p[0], q[1] - p[1])
    }, 0) / n
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  const dir = new Float64Array(n)
  const curv = new Float64Array(n)
  const signed = new Float64Array(n)
  const k = 3
  for (let i = 0; i < n; i++) {
    const a = points[(i - k + n) % n]
    const b = points[i]
    const c = points[(i + k) % n]
    const prev = points[(i - 1 + n) % n]
    const next = points[(i + 1) % n]
    let tx = next[0] - prev[0]
    let ty = next[1] - prev[1]
    const l = Math.hypot(tx, ty) || 1
    nx[i] = -ty / l
    ny[i] = tx / l
    dir[i] = Math.atan2(ty, tx)
    const h1 = Math.atan2(b[1] - a[1], b[0] - a[0])
    const h2 = Math.atan2(c[1] - b[1], c[0] - b[0])
    signed[i] = wrapAngle(h2 - h1) / (k * step)
  }

  const smoothSigned = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let j = -2; j <= 2; j++) s += signed[(i + j + n) % n]
    smoothSigned[i] = s / 5
    curv[i] = Math.abs(smoothSigned[i])
  }

  const fromCentre = new Float64Array(n)
  if (centre && centre.length === n) {
    for (let i = 0; i < n; i++) {
      fromCentre[i] =
        (points[i][0] - centre[i][0]) * nx[i] +
        (points[i][1] - centre[i][1]) * ny[i]
    }
  }
  return {
    points,
    n,
    step,
    nx,
    ny,
    dir,
    curv,
    signed: smoothSigned,
    fromCentre,
  }
}

export function nearestIndex(line, x, y, guess, back = 12, ahead = 60) {
  let best = Infinity
  let bi = guess
  for (let k = -back; k <= ahead; k++) {
    const j = (guess + k + line.n) % line.n
    const p = line.points[j]
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2
    if (d < best) {
      best = d
      bi = j
    }
  }
  return bi
}

export function globalNearest(line, x, y) {
  let best = Infinity
  let bi = 0
  for (let j = 0; j < line.n; j++) {
    const p = line.points[j]
    const d = (p[0] - x) ** 2 + (p[1] - y) ** 2
    if (d < best) {
      best = d
      bi = j
    }
  }
  return bi
}

function noseRate(v, top) {
  return (
    (PHYS.steerLow + (PHYS.steerHigh - PHYS.steerLow) * Math.min(1, v / top)) *
    Math.min(1, PHYS.pivotMin + v)
  )
}

export function speedProfile(line, stats) {
  const { n, step, curv } = line
  const v = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const k = Math.max(curv[i], 1e-4)
    const grip = Math.sqrt((stats.grip * AI.gripUse) / k)

    let s = stats.top
    for (let it = 0; it < 6; it++)
      s = Math.min(stats.top, (noseRate(s, stats.top) * AI.steerUse) / k)
    v[i] = Math.min(stats.top, grip, s)
  }

  const decel = PHYS.brake * AI.brakeUse + PHYS.coast
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n]
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * decel * step))
    }
  }
  return v
}

export class AIDriver {
  constructor({ driver, line, profile, rng, difficulty = 1 }) {
    this.driver = driver
    this.line = line
    this.profile = profile
    this.rng = rng
    this.pace = AI.pace(driver.rating) * difficulty
    this.craft = AI.racecraft[driver.aggression] ?? AI.racecraft.normal
    this.mistakeRate =
      AI.mistakeRate[driver.consistency] ?? AI.mistakeRate.normal
    this.idx = 0
    this.lane = 0
    this.laneTarget = 0
    this.wobblePhase = rng() * Math.PI * 2
    this.wobbleAmp = 0.03 + (9 - driver.rating) * 0.012
    this.mistake = null
    this.reaction = 0.12 + rng() * 0.18 + (9 - driver.rating) * 0.02
    this.launch = null
  }

  start(rng) {
    const r = rng()
    this.launch = r < 0.15 ? 'good' : r > 0.86 ? 'bogged' : 'normal'
    if (this.launch === 'good')
      this.reaction = Math.max(0.05, this.reaction - 0.12)
  }

  drive(car, ctx, dt) {
    const line = this.line
    const { n } = line
    this.idx = nearestIndex(line, car.x, car.y, this.idx)
    const i = this.idx

    if (ctx.raceTime < this.reaction)
      return { steer: 0, throttle: 0, brake: 0 }
    let throttleCap = 1
    if (this.launch === 'bogged' && ctx.raceTime < this.reaction + 1.3)
      throttleCap = 0.45

    this.maybeMistake(car, ctx, dt)
    const m = this.mistake
    let paceNow = this.pace
    let laneBias = 0
    if (m) {
      if (ctx.time > m.until) this.mistake = null
      else if (m.kind === 'lockup') paceNow *= 1.18
      else if (m.kind === 'off') {
        paceNow *= 1.3
        laneBias = m.side * 0.5
      }
    }

    let followSpeed = Infinity
    const wantLane =
      Math.sin(ctx.time * 0.9 + this.wobblePhase) * this.wobbleAmp
    const myLat = this.lateral(car)
    let pressure = false
    let squeeze = 0
    const blocked = { left: false, right: false }
    for (const o of ctx.others) {
      if (o.car === car) continue
      const ds = ((o.idx - i + n + n / 2) % n) - n / 2
      const d = ds * line.step
      if (d < -2 || d > 3) continue
      const lat = o.lateral
      const dLat = lat - myLat
      const side = Math.abs(dLat)
      if (d > -0.6 && d < 0.25 && side < 0.45) pressure = true

      if (Math.abs(d) < 0.55 && side < 0.5) {
        if (dLat > 0) blocked.right = true
        else blocked.left = true
        if (side < 0.3) squeeze += -Math.sign(dLat || 1) * (0.3 - side) * 1.5
      }
      if (d <= 0.05 || side > 0.3) continue
      const closing = car.speed - o.speed
      const need =
        this.craft.followGap +
        Math.max(0, closing) ** 2 / (2 * PHYS.brake * 0.6) +
        0.15
      if (d < need) {
        const goingRound =
          o.speed < 1.2 &&
          this.laneHold > ctx.time &&
          Math.abs(this.laneTarget - lat) > 0.3
        if (goingRound) {
          followSpeed = Math.min(
            followSpeed,
            Math.max(o.speed, 0) + 0.8 + Math.max(0, d - 0.3) * 3,
          )
        } else {
          followSpeed = Math.min(
            followSpeed,
            o.speed - Math.max(0, this.craft.followGap - d) * 2,
          )
        }
      }
      const crawling = o.speed < 1.2
      if (
        (d < this.craft.passGap + Math.max(0, closing) * 0.5 || crawling) &&
        (closing > -0.1 || crawling) &&
        !(this.laneHold > ctx.time)
      ) {
        if (this.rng() < this.craft.commit * dt * 20) {
          const goRight = lat < 0
          const sideFree = goRight ? !blocked.right : !blocked.left
          if (sideFree) {
            this.laneTarget = clamp(
              lat + (goRight ? 0.4 : -0.4),
              -AI.laneLimit,
              AI.laneLimit,
            )
            this.laneHold = ctx.time + 1.4
          }
        }
      }
    }
    this.pressure = pressure
    if (!(this.laneHold > ctx.time)) this.laneTarget = 0
    this.lane += clamp(
      this.laneTarget + wantLane - this.lane,
      -0.6 * dt,
      0.6 * dt,
    )

    const half = ROAD_WIDTH / 2 - AI.edgeMargin
    const off = line.fromCentre[i]
    let lane = clamp(
      this.lane + clamp(squeeze, -0.25, 0.25),
      -half - off,
      half - off,
    )
    lane += laneBias

    const ahead = (i + Math.round((0.3 + car.speed * 0.08) / line.step)) % n
    let target = Math.min(this.profile[i], this.profile[ahead]) * paceNow
    target = Math.min(target, followSpeed)
    if (car.grassFrac > 0.4) target = Math.min(target, 3.2)
    let throttle = 0
    let brake = 0
    const err = car.speed - target
    if (err > 0.12) brake = clamp(err * 1.6, 0.2, 1)
    else if (err > -0.05) throttle = 0.35
    else throttle = 1
    if (car.slip > 0.85) throttle = Math.min(throttle, 0.3)
    throttle *= throttleCap

    if (!this.stepCount || this.stepCount % AI.decideEvery === 0) {
      this.steerChoice = this.chooseSteer(car, lane, throttle, brake)
    }
    this.stepCount = (this.stepCount ?? 0) + 1
    return { steer: this.steerChoice, throttle, brake }
  }

  chooseSteer(car, lane, throttle, brake) {
    const line = this.line
    const dt = AI.predictStep
    const steps = Math.round(AI.horizon / dt)
    let best = Infinity
    let choice = 0

    const split = Math.round(steps * AI.planSplit)
    for (const first of AI.steerOptions) {
      for (const then of [first, 0]) {
        if (then === first && first === 0 && this._zeroDone) continue
        const c = { ...car }
        let idx = this.idx
        let cost = Math.abs(first - (this.steerChoice ?? 0)) * 0.02
        for (let k = 1; k <= steps; k++) {
          stepCar(
            c,
            { steer: k <= split ? first : then, throttle, brake },
            dt,
            PREDICT_SURFACE,
          )
          if (k % 2 && k !== steps) continue
          idx = nearestIndex(line, c.x, c.y, idx, 4, 40)
          const p = line.points[idx]
          const lat =
            (c.x - p[0]) * line.nx[idx] + (c.y - p[1]) * line.ny[idx] - lane
          cost += lat * lat
          if (k === steps)
            cost += AI.headingWeight * wrapAngle(line.dir[idx] - c.travel) ** 2
        }
        if (cost < best) {
          best = cost
          choice = first
        }
      }
    }
    return choice
  }

  lateral(car) {
    const i = this.idx
    const p = this.line.points[i]
    return (car.x - p[0]) * this.line.nx[i] + (car.y - p[1]) * this.line.ny[i]
  }
  maybeMistake(car, ctx, dt) {
    if (this.mistake || car.speed < 3 || ctx.finished) return
    let rate = this.mistakeRate
    if (ctx.lap <= 1) rate *= AI.lap1Factor
    if (this.pressure) rate *= AI.pressureFactor
    if (this.rng() >= rate * dt) return
    const r = this.rng()
    const [lock, off] = AI.mistakeMix
    if (r < lock) this.mistake = { kind: 'lockup', until: ctx.time + 0.8 }
    else if (r < lock + off)
      this.mistake = {
        kind: 'off',
        until: ctx.time + 1.0,
        side: this.rng() < 0.5 ? -1 : 1,
      }
    else {
      this.mistake = { kind: 'spin', until: ctx.time + 0.1 }
      ctx.spinNow(car)
    }
  }
}
