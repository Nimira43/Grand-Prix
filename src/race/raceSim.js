import { DRIVERS, TEAMS, POINTS } from '../data/grid.js'
import { carStats, createCar, stepCar } from './carPhysics.js'
import { AIDriver, AI, DIFFICULTY, prepareLine, speedProfile, nearestIndex, globalNearest } from './ai.js'
import { resolveCollisions } from './collisions.js'
import { LapTimer } from './laps.js'
import { applyBrakeAssist } from './assists.js'
import { TrackLimits } from './trackLimits.js'

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
  constructor({ loop, surface, playerIndex = 0, field = true, laps = 8, difficulty = 'normal', seed, seats, brakeAssist = 'off' }) {
    this.loop = loop
    this.surface = surface
    this.field = field
    this.laps = laps
    this.rng = makeRng(seed ?? Math.floor(Math.random() * 2 ** 31))
    this.line = prepareLine(loop.racingLine, loop.centre)
    this.finishIdx = globalNearest(this.line, loop.checkpoints[0].x, loop.checkpoints[0].y)
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
    this.entries = seats.map((index) => this.makeEntry(index, index === playerIndex))
    this.gridUp()
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
      ai: isPlayer ? null : new AIDriver({ driver, line: this.line, profile, rng: this.rng, difficulty: this.difficulty }),
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
    }
  }

  gridUp() {
    const { n, step } = this.line
    for (const e of this.entries) {
      const pace = AI.pace(e.driver.rating)
      let lap = 0
      for (let i = 0; i < n; i++) lap += step / (e.profile[i] * pace)
      lap *= 1 + (this.rng() - 0.5) * 0.012
      const binChance = { clean: 0.03, normal: 0.07, ragged: 0.15 }[e.driver.consistency] ?? 0.07
      if (this.rng() < binChance) lap *= 1.03 + this.rng() * 0.03
      e.qualiLap = lap
    }
    const order = [...this.entries].sort((a, b) => a.qualiLap - b.qualiLap)
    order.forEach((e, pos) => {
      const slot = this.loop.grid[pos]
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
    return Math.max(0, Math.min(5, Math.floor((this.time - LIGHTS_ON) / LIGHT_GAP) + 1))
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

    const others = this.entries.map((e) => ({
      car: e.car,
      idx: e.idx,
      lateral: this.lateral(e),
      speed: e.car.speed,
    }))

    for (const e of this.entries) {
      const car = e.car
      const x0 = car.x
      const y0 = car.y
      if (car.spin) {
        this.stepSpin(car, dt)
      } else {
        let input
        if (e.isPlayer) {
          const assisted = applyBrakeAssist(e, playerInput, this.line, this.brakeAssist)
          input = assisted.input
          e.assistActive = assisted.active
        }
        else {
          const ctx = {
            time: this.time,
            raceTime: this.raceTime,
            lap: e.timer.lap,
            finished: e.finished,
            others,
            spinNow: () => this.spin(e, 'mistake'),
          }
          input = e.ai.drive(car, ctx, dt)
          if (e.finished) input.throttle = Math.min(input.throttle, 0.6) // cool-down lap
        }
        stepCar(car, input, dt, this.surface)
      }
      if (!e.isPlayer) e.idx = e.ai.idx
      else {
        e.idx = nearestIndex(this.line, car.x, car.y, e.idx)
        const p = this.line.points[e.idx]
        if ((p[0] - car.x) ** 2 + (p[1] - car.y) ** 2 > 2.25) e.idx = globalNearest(this.line, car.x, car.y)
      }

      const hit = e.timer.update(x0, y0, car.x, car.y, this.time, dt)
      if (hit) this.crossed(e)

      if (!e.finished) {
        const verdict = e.limits.update(e, this.line, this.time, dt, this.field)
        if (verdict) this.trackLimits(e, verdict)
      }
    }

    resolveCollisions(
      this.entries.map((e) => e.car),
      (a, b, impact) => this.contact(a, b, impact),
    )
    this.updateProgress()
    if (this.phase === 'race' && this.flagTime != null) {
      const allIn = this.entries.every((e) => e.finished)
      if (allIn || this.time > this.flagTime + 45) this.phase = 'done'
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
    e.car.spin = { t: 0, rate: (dir * Math.PI * 2 * (0.9 + this.rng() * 0.5)) / SPIN_TIME }
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
      const chance = { clean: 0.08, normal: 0.14, ragged: 0.22 }[e.driver.consistency] ?? 0.14
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
    }
  }

  trackLimits(e, verdict) {
    e.timer.invalidate()
    this.limitEvents.push({ entry: e, verdict, time: this.time })
    if (e.isPlayer) return
    const name = e.driver.name.toUpperCase()
    if (verdict.kind === 'cut') this.event(`${name}: ${verdict.seconds}-SEC PENALTY (CUTTING THE TRACK)`)
    else if (verdict.kind === 'penalty') this.event(`${name}: ${verdict.seconds}-SEC PENALTY (TRACK LIMITS)`)
    else if (verdict.kind === 'final') this.event(`${name}: BLACK-AND-WHITE FLAG`)
  }

  lateral(e) {
    const p = this.line.points[e.idx]
    return (e.car.x - p[0]) * this.line.nx[e.idx] + (e.car.y - p[1]) * this.line.ny[e.idx]
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
    const running = this.entries.filter((e) => !e.finished).sort((a, b) => b.progress - a.progress)
    return [...this.finishOrder, ...running]
  }

  gapText(e, leader) {
    if (e === leader) return 'LEADER'
    if (this.phase === 'lights' || !e.timer || e.timer.lap === 0) return ''
    const lapsDown = Math.floor((leader.progress - e.progress) / this.line.n)
    if (lapsDown >= 1 && !e.finished) return `+${lapsDown} LAP${lapsDown > 1 ? 'S' : ''}`
    if (e.finished && leader.finished) {
      const d = e.finishTime - leader.finishTime
      return e.timer.laps.length < leader.timer.laps.length ? `+${leader.timer.laps.length - e.timer.laps.length} LAP` : `+${d.toFixed(3)}`
    }
    const first = this.firstCross.get(e.lastKey)
    return first == null ? '' : `+${(e.lastCross - first).toFixed(1)}`
  }

  results() {
    const finished = this.entries
      .filter((e) => e.finished)
      .sort(
        (a, b) =>
          b.timer.laps.length - a.timer.laps.length ||
          a.finishTime + a.limits.penalty - (b.finishTime + b.limits.penalty),
      )
    const running = this.entries.filter((e) => !e.finished).sort((a, b) => b.progress - a.progress)
    return [...finished, ...running].map((e, i) => ({
      pos: i + 1,
      entry: e,
      points: e.finished ? (POINTS[i] ?? 0) : 0,
      best: e.timer?.bestLap ?? null,
      laps: e.timer?.laps.length ?? 0,
      penalty: e.limits.penalty,
      time: e.finished ? e.finishTime + e.limits.penalty : null, 
      crossed: e.finished ? this.finishOrder.indexOf(e) + 1 : null, 
    }))
  }

  event(text) {
    this.events.push({ time: this.time, text })
  }
}
