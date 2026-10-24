import { PHYS } from './carPhysics.js'

export const BRAKE_ASSIST = {
  off: { label: 'Off' },
  light: { label: 'Light', margin: 0.95, trigger: 1.1 },
  full: { label: 'Full', margin: 0.92, trigger: 1.0 },
}

const REACTION = 0.15

export function safeSpeed(entry, line, margin) {
  const { n, step } = line
  const ahead = Math.max(1, Math.round((entry.car.speed * REACTION) / step))
  let v = Infinity
  for (let k = 0; k <= ahead; k++) v = Math.min(v, entry.profile[(entry.idx + k) % n])
  const top = entry.stats.top
  const slowness = Math.min(1, Math.max(0, (top - v) / (top * 0.4)))
  return v * (1 - (1 - margin) * slowness)
}

export function applyBrakeAssist(entry, input, line, level) {
  const cfg = BRAKE_ASSIST[level]
  if (!cfg?.margin || entry.car.spin) return { input, active: false }
  const target = safeSpeed(entry, line, cfg.margin)
  const speed = entry.car.speed
  if (speed <= target * cfg.trigger) return { input, active: false }
  const over = speed - target
  const brake = Math.min(1, Math.max(0.25, over * 1.8))
  return {
    input: { ...input, throttle: 0, brake: Math.max(input.brake ?? 0, brake) },
    active: true,
  }
}

export function brakingLine(profile, line, top) {
  const { n, step } = line
  const kind = new Array(n)
  const brakeDecel = PHYS.brake * 0.3
  for (let i = 0; i < n; i++) {
    const v = profile[i]
    const next = profile[(i + 1) % n]
    const decel = (v * v - next * next) / (2 * step)
    if (decel > brakeDecel) kind[i] = 'brake'
    else if (v < top * 0.93) kind[i] = 'lift'
    else kind[i] = 'flat'
  }

  for (let i = 0; i < n; i++) {
    const a = kind[(i - 1 + n) % n]
    const b = kind[(i + 1) % n]
    if (a === b && kind[i] !== a) kind[i] = a
  }
  const runs = []
  let start = 0
  for (let i = 1; i <= n; i++) {
    if (i === n || kind[i] !== kind[start]) {
      runs.push({ from: start, to: i, kind: kind[start] })
      start = i
    }
  }
  return runs
}

export const LINE_COLOURS = {
  flat: 'rgba(60, 220, 110, 0.55)',
  lift: 'rgba(255, 196, 0, 0.6)',
  brake: 'rgba(255, 50, 40, 0.65)',
}
