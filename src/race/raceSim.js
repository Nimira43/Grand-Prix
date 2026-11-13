import { DRIVERS, TEAMS, POINTS } from '../data/grid.js'
import { carStats, createCar, stepCar } from './carPhysics.js'
import {
  AIDriver,
  AI,
  DIFFICULTY,
  prepareLine,
  speedProfile,
  nearestIndex,
  globalNearest,
} from './ai.js'
import { resolveCollisions } from './collisions.js'
import { LapTimer } from './laps.js'
import { applyBrakeAssist } from './assists.js'
import { TrackLimits } from './trackLimits.js'
import { simulateQualifying, gridOrder } from './qualifying.js'
import { PIT, PitLane, pitWindow, stopTime, railGearbox } from './pits.js'
import { currentField } from '../data/fields.js'

const LIGHTS_ON = 0.6
const LIGHT_GAP = 1
const SPIN_TIME = 1.3

export function makeRng(seed = Date.now()) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class RaceSim {
  constructor({
    loop,
    surface,
    playerIndex = 0,
    field = true,
    laps = 8,
    difficulty = 'normal',
    seed,
    seats,
    brakeAssist = 'off',
    grid = null,
    flying = false,
    start = null,
    points = POINTS,
  }) {
    this.points = points
    this.loop = loop
    this.surface = surface
    this.field = field
    this.laps = laps
    this.rng = makeRng(seed ?? Math.floor(Math.random() * 2 ** 31))
    this.line = prepareLine(loop.racingLine, loop.centre)
    this.finishIdx = globalNearest(
      this.line,
      loop.checkpoints[0].x,
      loop.checkpoints[0].y,
    )
    this.difficulty = DIFFICULTY[difficulty]?.pace ?? 1
    this.brakeAssist = brakeAssist
    this.time = 0
    this.phase = 'lights'
    this.lightsOutAt = LIGHTS_ON + LIGHT_GAP * 5 + 0.2 + this.rng() * 2.3
    this.firstCross = new Map()
    this.finishOrder = []
    this.flagTime = null
    this.events = []
    this.limitEvents = []
    this.contacts = 0
    this.touching = new Map()
    this.spins = 0

    seats = seats ?? (field ? DRIVERS.map((_, i) => i) : [playerIndex])
    this.entries = seats.map((index) =>
      this.makeEntry(index, index === playerIndex),
    )
    this.gridOrder = grid
    this.gridUp()
    if (flying) this.flyingStart()
    this.setupPits(start, flying)
  }

  setupPits(start, flying) {
    this.pitLane = null
    this.pitWindow = null
    if (!start || flying) return
    const lane = new PitLane(start)
    const mid = lane.at((lane.laneStart + lane.laneEnd) / 2)
    const i = globalNearest(this.line, mid.x, mid.y)
    if (Math.cos(this.line.dir[i] - mid.heading) < 0.5) return
    this.pitLane = lane

    if (currentField() === 'champions') {
      const pairs = Math.min(
        lane.garages.length,
        Math.ceil(this.entries.length / 2),
      )
      for (const e of this.entries) {
        e.pit.garage = ((e.grid - 1) % pairs) + 1
        e.pit.box = lane.garage(e.pit.garage)
      }
    }
    this.pitJoinIdx = globalNearest(
      this.line,
      lane.joinPoint[0],
      lane.joinPoint[1],
    )
    if (this.field) this.pitWindow = pitWindow(this.laps)
    const w = this.pitWindow
    for (const e of this.entries) {
      e.pit.plan = null
      if (!w || e.isPlayer) continue
      const laps = []
      for (let l = w.from; l <= w.to; l++) laps.push(l)
      const weights = laps.map(
        (l, k) => 1 + (k > 0 && k < laps.length - 1 ? 0.6 : 0),
      )
      let r = this.rng() * weights.reduce((a, b) => a + b, 0)
      let k = 0
      while (r > weights[k] && k < laps.length - 1) r -= weights[k++]
      e.pit.plan = laps[k]
    }
  }

  requestPit(e = this.player) {
    if (!e || !this.pitLane || e.finished || e.pit.rail) return null
    e.pit.request = !e.pit.request
    return e.pit.request
  }

  nextPitLap(e) {
    const lap = e.timer?.lap ?? 0
    const lapLen = this.line.n * this.line.step
    return lap === 0 || this.toPitJoin(e) > lapLen - 10 ? lap + 1 : lap
  }

  stopCounts(e, lap) {
    if (!this.field) return true
    const w = this.pitWindow
    return !!w && !e.pit.done && lap >= w.from && lap <= w.to
  }

  owesStop(e) {
    return !!this.pitWindow && !e.pit.done
  }

  flyingStart() {
    const { n, step, curv } = this.line
    const back = Math.round(Math.min(25, n * step * 0.25) / step)
    let best = (this.finishIdx - back + n) % n
    for (let k = -20; k <= 20; k++) {
      const i = (this.finishIdx - back + k + n) % n
      if (curv[i] < curv[best]) best = i
    }
    this.phase = 'race'
    this.lightsOutAt = 0
    for (const e of this.entries) {
      const [x, y] = this.line.points[best]
      e.car = createCar(e.stats, x, y, this.line.dir[best])
      e.car.id = e.index
      e.car.speed = e.profile[best] * 0.85
      e.idx = best
      if (e.ai) e.ai.idx = best
      e.timer = new LapTimer(this.loop, 0, { flying: true })
      e.ai?.start(this.rng)
    }
    this.updateProgress()
  }

  makeEntry(index, isPlayer) {
    const driver = DRIVERS[index]
    const stats = carStats(driver.team)
    const profile = speedProfile(this.line, stats)
    return {
      index,
      driver,
      team: TEAMS[driver.team],
      stats,
      profile,
      isPlayer,
      ai: isPlayer
        ? null
        : new AIDriver({
            driver,
            line: this.line,
            profile,
            rng: this.rng,
            difficulty: this.difficulty,
          }),
      car: null,
      timer: null,
      idx: 0,
      progress: 0,
      finished: false,
      finishTime: null,
      lastKey: null,
      lastCross: 0,
      grid: 0,
      limits: new TrackLimits(),
      pit: {
        plan: null,
        done: false,
        stops: 0,
        rail: null,
        last: null,
        outUntil: 0,
        request: false,
      },
    }
  }

  gridUp() {
    let indices = this.gridOrder
    if (!indices)
      indices = gridOrder(
        simulateQualifying(this.entries, this.line, {
          rng: this.rng,
          difficulty: this.difficulty,
        }),
      )
    const rank = new Map(indices.map((idx, pos) => [idx, pos]))
    const order = [...this.entries].sort(
      (a, b) => (rank.get(a.index) ?? 99) - (rank.get(b.index) ?? 99),
    )
    order.forEach((e, pos) => {
      const slots = this.loop.grid
      const slot = slots[Math.min(pos, slots.length - 1)]
      e.grid = pos + 1
      e.car = createCar(e.stats, slot.x, slot.y, slot.heading)
      e.car.id = e.index
      e.idx = nearestIndex(this.line, slot.x, slot.y, this.finishIdx, 80, 10)
    })
    this.updateProgress()
  }

  get player() {
    return this.entries.find((e) => e.isPlayer) ?? null
  }

  get raceTime() {
    return this.phase === 'lights' ? 0 : this.time - this.lightsOutAt
  }

  get lightsLit() {
    if (this.phase !== 'lights') return -1
    return Math.max(
      0,
      Math.min(5, Math.floor((this.time - LIGHTS_ON) / LIGHT_GAP) + 1),
    )
  }

  step(dt, playerInput = {}) {
    this.time += dt
    if (this.phase === 'lights') {
      if (this.time < this.lightsOutAt) return
      this.phase = 'race'
      for (const e of this.entries) {
        e.timer = new LapTimer(this.loop, this.time)
        e.ai?.start(this.rng)
      }
      this.event('LIGHTS OUT!')
    }

    const others = this.entries
      .filter((e) => !e.pit.rail)
      .map((e) => ({
        car: e.car,
        idx: e.idx,
        lateral: this.lateral(e),
        speed: e.car.speed,
      }))

    for (const e of this.entries) {
      const car = e.car
      const x0 = car.x
      const y0 = car.y
      if (!e.pit.rail && this.pitLane && !car.spin) this.maybeEnterPits(e)
      if (e.pit.rail) {
        this.stepRails(e, dt)
      } else if (car.spin) {
        this.stepSpin(car, dt)
      } else {
        let input
        if (e.isPlayer) {
          const assisted = applyBrakeAssist(
            e,
            playerInput,
            this.line,
            this.brakeAssist,
          )
          input = assisted.input
          e.assistActive = assisted.active
          const cap = this.pitApproachSpeed(e)
          if (car.speed > cap + 0.1)
            input = {
              ...input,
              throttle: 0,
              brake: Math.min(1, Math.max(0.3, (car.speed - cap) * 1.6)),
            }
        } else {
          const ctx = {
            time: this.time,
            raceTime: this.raceTime,
            lap: e.timer.lap,
            finished: e.finished,
            others,
            spinNow: () => this.spin(e, 'mistake'),
            maxSpeed: this.pitApproachSpeed(e),
          }
          input = e.ai.drive(car, ctx, dt)
          if (e.finished) input.throttle = Math.min(input.throttle, 0.6)
        }
        stepCar(car, input, dt, this.surface)
      }
      if (e.pit.rail) {
        e.idx = nearestIndex(this.line, car.x, car.y, e.idx)
        if (e.ai) e.ai.idx = e.idx
      } else if (!e.isPlayer) e.idx = e.ai.idx
      else {
        e.idx = nearestIndex(this.line, car.x, car.y, e.idx)
        const p = this.line.points[e.idx]
        if ((p[0] - car.x) ** 2 + (p[1] - car.y) ** 2 > 2.25)
          e.idx = globalNearest(this.line, car.x, car.y)
      }

      const hit = e.timer.update(x0, y0, car.x, car.y, this.time, dt)
      if (hit) this.crossed(e)

      if (!e.finished && !e.pit.rail && this.time > e.pit.outUntil) {
        const verdict = e.limits.update(
          e,
          this.line,
          this.time,
          dt,
          this.field,
        )
        if (verdict) this.trackLimits(e, verdict)
      }
    }

    resolveCollisions(
      this.entries.filter((e) => !e.pit.rail).map((e) => e.car),
      (a, b, impact) => this.contact(a, b, impact),
    )
    this.updateProgress()
    if (this.phase === 'race' && this.flagTime != null) {
      const allIn = this.entries.every((e) => e.finished)
      if (allIn || this.time > this.flagTime + 45) this.phase = 'done'
    }
  }

  wantsToPit(e) {
    if (!this.pitLane || e.finished || !e.timer) return false
    if (e.isPlayer) return e.pit.request
    if (!this.pitWindow || e.pit.done) return false
    const lap = e.timer.lap
    return lap >= e.pit.plan && lap <= this.pitWindow.to
  }

  toPitJoin(e) {
    const n = this.line.n
    return ((this.pitJoinIdx - e.idx + n) % n) * this.line.step
  }

  pitApproachSpeed(e) {
    if (!this.wantsToPit(e)) return Infinity
    const d = this.toPitJoin(e)
    if (d > 15) return Infinity
    return Math.sqrt(PIT.joinSpeed ** 2 + 2 * PIT.approachDecel * d)
  }

  maybeEnterPits(e) {
    const lane = this.pitLane
    const car = e.car
    if (!e.timer || e.timer.lap < 1) return
    if (this.phase !== 'race') return
    let s = null
    if (e.isPlayer && !e.pit.request)
      s = lane.turningIn(car.x, car.y, car.heading)
    else if (this.wantsToPit(e)) {
      const d = this.toPitJoin(e)
      if (d < 0.25 || d > this.line.n * this.line.step - 0.4)
        s = lane.nearest(car.x, car.y).s
    }
    if (s == null) return
    const p = lane.at(s)
    const lap = e.timer.lap
    const counts = this.stopCounts(e, lap)
    e.pit.rail = {
      s,
      s0: s,
      ox: car.x - p.x,
      oy: car.y - p.y,
      phase: counts ? 'in' : 'through',
      box: e.pit.box ?? lane.boxes[e.driver.team],
      wait: 0,
      lap,
      side: 0,
      speed: car.speed,
    }
    car.spin = null
    e.pit.request = false
    if (e.isPlayer) {
      if (counts) this.event('PIT LANE · LIMITER ON', e, true)
      else if (e.pit.done)
        this.event("DRIVE-THROUGH: YOU'VE ALREADY STOPPED", e, true)
      else if (!this.pitWindow)
        this.event('DRIVE-THROUGH: NO STOP NEEDED', e, true)
      else
        this.event(
          `DRIVE-THROUGH: PIT WINDOW IS LAPS ${this.pitWindow.from}–${this.pitWindow.to}`,
          e,
          true,
        )
    }
  }

  stepRails(e, dt) {
    const lane = this.pitLane
    const r = e.pit.rail
    const car = e.car
    let v = r.speed
    if (r.phase === 'box') {
      v = 0
      r.wait -= dt
      if (r.wait <= 0) {
        r.phase = 'out'
        if (e.isPlayer) this.event('GO, GO, GO!', e, true)
      }
    } else {
      let want =
        r.s < lane.laneStart
          ? Math.sqrt(
              PIT.limiter ** 2 + 2 * PIT.entryDecel * (lane.laneStart - r.s),
            )
          : PIT.limiter
      if (r.s > lane.laneEnd) want = Infinity
      if (r.phase === 'in')
        want = Math.min(
          want,
          Math.sqrt(2 * PIT.boxDecel * Math.max(0, r.box - r.s)),
        )
      for (const o of this.entries) {
        const q = o.pit.rail
        if (!q || o === e || q.s <= r.s) continue
        if (q.side > 0.05 && q.box !== r.box) continue
        if (q.phase === 'box' && q.box !== r.box) continue
        const gap = q.s - r.s - PIT.gap
        want = Math.min(
          want,
          q.speed +
            Math.sqrt(2 * PIT.boxDecel * Math.max(0, gap)) -
            (gap < 0 ? 1 : 0),
        )
      }
      want = Math.max(0, want)
      if (v > want) v = Math.max(want, v - PIT.hardDecel * dt)
      else
        v = Math.min(
          want,
          v + (r.s > lane.laneEnd ? PIT.exitAccel * 2.5 : PIT.exitAccel) * dt,
          r.s > lane.laneEnd ? car.stats.top : Infinity,
        )
      r.s += v * dt
      if (r.phase === 'in' && r.s >= r.box - 0.02 && v < 0.6) {
        r.s = r.box
        v = 0
        r.phase = 'box'
        const st = stopTime(e.team, this.rng)
        r.wait = st.time
        r.stopTime = st.time
        r.fumble = st.fumble
        e.pit.stops++
        e.pit.done = true
        e.pit.last = { lap: r.lap, time: st.time, fumble: st.fumble }
        const name = e.driver.name.toUpperCase()
        if (!e.isPlayer && this.field)
          this.event(
            st.fumble
              ? `${name}: SLOW STOP (${st.time.toFixed(1)}s)`
              : `${name} PITS (${st.time.toFixed(1)}s)`,
          )
        else if (e.isPlayer && st.fumble)
          this.event('PROBLEM WITH THE WHEEL NUT!', e, true)
      }
    }
    r.speed = v
    const nearBox =
      r.phase === 'in' || r.phase === 'box'
        ? Math.max(0, 1 - Math.abs(r.box - r.s) / 0.5)
        : 0
    const sideWant = r.phase === 'box' ? 1 : nearBox
    r.side += Math.max(-dt * 2.5, Math.min(dt * 2.5, sideWant - r.side))

    const p = lane.at(r.s)
    const fade = Math.max(0, 1 - (r.s - r.s0) / 1.0)
    const bx = p.x + r.ox * fade
    const by = p.y + r.oy * fade
    const nx = bx + lane.garageDir[0] * r.side * PIT.baySide
    const ny = by + lane.garageDir[1] * r.side * PIT.baySide
    const mx = bx - (r.bx ?? car.x)
    const my = by - (r.by ?? car.y)
    r.bx = bx
    r.by = by
    if (mx * mx + my * my > 1e-8) {
      const moveDir = fade > 0 ? Math.atan2(my, mx) : p.heading
      const d = Math.atan2(
        Math.sin(moveDir - car.heading),
        Math.cos(moveDir - car.heading),
      )
      car.heading += d * Math.min(1, dt * 12)
    }
    car.x = nx
    car.y = ny
    car.speed = v
    car.travel = car.heading
    car.slip = 0
    car.steer = 0
    car.throttle = r.phase === 'box' ? 0 : 0.3
    car.grassFrac = 0
    railGearbox(car)
    if (r.s >= lane.exitAt) this.releaseFromPits(e)
  }

  releaseFromPits(e) {
    const car = e.car
    const p = this.pitLane.at(this.pitLane.exitAt)
    car.heading = p.heading
    car.travel = p.heading
    car.steer = 0
    e.pit.rail = null
    e.pit.outUntil = this.time + 1
    e.idx = globalNearest(this.line, car.x, car.y)
    if (e.ai) {
      e.ai.idx = e.idx
      e.ai.lane = 0
      e.ai.laneTarget = 0
    }
  }

  stepSpin(car, dt) {
    const s = car.spin
    s.t += dt
    car.x += Math.cos(car.travel) * car.speed * dt
    car.y += Math.sin(car.travel) * car.speed * dt
    car.speed = Math.max(0, car.speed - 6.5 * dt)
    car.heading += s.rate * dt
    car.slip = 1
    car.steer = 0
    car.x = Math.max(0.2, Math.min(this.surface.cols - 0.2, car.x))
    car.y = Math.max(0.2, Math.min(this.surface.rows - 0.2, car.y))
    if (s.t >= SPIN_TIME) {
      car.spin = null
      car.travel = car.heading
      car.speed *= 0.3
    }
  }

  spin(e, cause = 'contact') {
    if (e.car.spin || e.isPlayer) return
    this.spinCauses = this.spinCauses ?? {}
    this.spinCauses[cause] = (this.spinCauses[cause] ?? 0) + 1
    const dir = this.rng() < 0.5 ? -1 : 1
    e.car.spin = {
      t: 0,
      rate: (dir * Math.PI * 2 * (0.9 + this.rng() * 0.5)) / SPIN_TIME,
    }
    this.spins++
    this.event(`${e.driver.name.toUpperCase()} SPINS!`)
  }

  contact(a, b, impact) {
    const key = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`
    const last = this.touching.get(key)
    this.touching.set(key, this.time)
    if (last != null && this.time - last < 0.25) return
    this.contacts++
    if (impact > 1) this.hardContacts = (this.hardContacts ?? 0) + 1
    if (impact < 1.8) return
    for (const car of [a, b]) {
      const e = this.entries.find((x) => x.car === car)
      if (!e || e.isPlayer) continue
      const chance =
        { clean: 0.08, normal: 0.14, ragged: 0.22 }[e.driver.consistency] ??
        0.14
      if (this.rng() < chance * Math.min(1, impact / 3.5)) this.spin(e)
    }
  }

  crossed(e) {
    const t = e.timer
    const gate = (t.next - 1 + t.gates.length) % t.gates.length
    const key = `${t.lap}:${gate}`
    if (!this.firstCross.has(key)) this.firstCross.set(key, this.time)
    e.lastKey = key
    e.lastCross = this.time
    if (gate !== 0 || !this.field || e.finished) return

    const done = t.laps.length >= this.laps
    if (done || this.flagTime != null) {
      if (this.flagTime == null) {
        this.flagTime = this.time
        this.event(`${e.driver.name.toUpperCase()} WINS!`)
      }
      e.finished = true
      e.finishTime = this.time - this.lightsOutAt
      this.finishOrder.push(e)
      if (this.owesStop(e))
        this.event(`${e.driver.name.toUpperCase()} DISQUALIFIED: NO PIT STOP`)
    }
  }

  trackLimits(e, verdict) {
    e.timer.invalidate()
    this.limitEvents.push({ entry: e, verdict, time: this.time })
    if (e.isPlayer) return
    const name = e.driver.name.toUpperCase()
    if (verdict.kind === 'cut')
      this.event(`${name}: ${verdict.seconds}-SEC PENALTY (CUTTING THE TRACK)`)
    else if (verdict.kind === 'penalty')
      this.event(`${name}: ${verdict.seconds}-SEC PENALTY (TRACK LIMITS)`)
    else if (verdict.kind === 'final')
      this.event(`${name}: BLACK-AND-WHITE FLAG`)
  }

  lateral(e) {
    const p = this.line.points[e.idx]
    return (
      (e.car.x - p[0]) * this.line.nx[e.idx] +
      (e.car.y - p[1]) * this.line.ny[e.idx]
    )
  }

  updateProgress() {
    const n = this.line.n
    for (const e of this.entries) {
      let dist = (e.idx - this.finishIdx + n) % n
      const lap = e.timer?.lap ?? 0
      const next = e.timer?.next ?? 0
      if (next === 1 && dist > n / 2) dist -= n
      if (next === 0 && lap > 0 && dist < n / 2) dist += n
      if (lap === 0 && dist < n / 2) dist += n
      e.progress = lap * n + dist
    }
  }

  standings() {
    const running = this.entries
      .filter((e) => !e.finished)
      .sort((a, b) => b.progress - a.progress)
    return [...this.finishOrder, ...running]
  }

  gapText(e, leader) {
    if (e === leader) return 'LEADER'
    if (this.phase === 'lights' || !e.timer || e.timer.lap === 0) return ''
    const lapsDown = Math.floor((leader.progress - e.progress) / this.line.n)
    if (lapsDown >= 1 && !e.finished)
      return `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`
    if (e.finished && leader.finished) {
      const d = e.finishTime - leader.finishTime
      return e.timer.laps.length < leader.timer.laps.length
        ? `+${leader.timer.laps.length - e.timer.laps.length} LAP`
        : `+${d.toFixed(3)}`
    }
    const first = this.firstCross.get(e.lastKey)
    return first == null ? '' : `+${(e.lastCross - first).toFixed(1)}`
  }

  results() {
    const dsq = (e) => this.owesStop(e)
    const finished = this.entries
      .filter((e) => e.finished && !dsq(e))
      .sort(
        (a, b) =>
          b.timer.laps.length - a.timer.laps.length ||
          a.finishTime + a.limits.penalty - (b.finishTime + b.limits.penalty),
      )
    const running = this.entries
      .filter((e) => !e.finished && !dsq(e))
      .sort((a, b) => b.progress - a.progress)
    const out = this.entries
      .filter(dsq)
      .sort((a, b) => b.progress - a.progress)
    return [...finished, ...running, ...out].map((e, i) => ({
      pos: i + 1,
      entry: e,
      points: e.finished && !dsq(e) ? (this.points[i] ?? 0) : 0,
      best: e.timer?.bestLap ?? null,
      laps: e.timer?.laps.length ?? 0,
      penalty: e.limits.penalty,
      time: e.finished ? e.finishTime + e.limits.penalty : null,
      crossed: e.finished ? this.finishOrder.indexOf(e) + 1 : null,
      dsq: dsq(e),
      stops: e.pit.stops,
      stop: e.pit.last,
    }))
  }

  event(text, entry = null, isPrivate = false) {
    this.events.push({ time: this.time, text, entry, private: isPrivate })
  }
}
