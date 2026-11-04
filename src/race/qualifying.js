import { AI } from './ai.js'

export const QUALI = {
  noise: 0.004,
  binned: { clean: 0.03, normal: 0.07, ragged: 0.15 },
  deleted: { clean: 0.01, normal: 0.02, ragged: 0.04 },
}

export function estimateLap(entry, line, difficulty = 1) {
  const pace = AI.pace(entry.driver.rating) * difficulty
  let lap = 0
  for (let i = 0; i < line.n; i++) lap += line.step / (entry.profile[i] * pace)
  return lap
}

export function simulateQualifying(
  entries,
  line,
  { rng, difficulty = 1, scale = 1 } = {},
) {
  return entries.map((e) => {
    let time = estimateLap(e, line, difficulty) * scale
    time *= 1 + (rng() * 2 - 1) * QUALI.noise
    let note = null
    const c = e.driver.consistency
    if (rng() < (QUALI.binned[c] ?? 0.07)) {
      time *= 1.025 + rng() * 0.025
      note = 'scrappy'
    }
    if (rng() < (QUALI.deleted[c] ?? 0.02)) {
      time = null
      note = 'deleted'
    }
    return {
      index: e.index,
      entry: e,
      time,
      note,
      estimate: estimateLap(e, line, difficulty),
    }
  })
}

export function gridOrder(results) {
  return [...results]
    .sort(
      (a, b) =>
        (a.time ?? Infinity) - (b.time ?? Infinity) || a.estimate - b.estimate,
    )
    .map((r) => r.index)
}

const scaleCache = new Map()

export async function calibrate({
  loop,
  surface,
  difficulty = 'normal',
  key = '',
}) {
  const cacheKey = `${key}|${difficulty}|${loop.length.toFixed(2)}`
  if (scaleCache.has(cacheKey)) return scaleCache.get(cacheKey)
  const { RaceSim } = await import('./raceSim.js')
  const { DRIVERS } = await import('../data/grid.js')
  const saved = AI.mistakeRate
  AI.mistakeRate = { clean: 0, normal: 0, ragged: 0 }
  try {
    const probe = new RaceSim({
      loop,
      surface,
      playerIndex: null,
      seats: DRIVERS.map((_, i) => i),
      difficulty,
      seed: 1,
    })
    const ref = probe.entries.reduce((a, b) =>
      estimateLap(a, probe.line, probe.difficulty) <
      estimateLap(b, probe.line, probe.difficulty)
        ? a
        : b,
    )
    const sim = new RaceSim({
      loop,
      surface,
      playerIndex: null,
      field: false,
      seats: [ref.index],
      flying: true,
      difficulty,
      seed: 2,
    })
    const e = sim.entries[0]
    while (e.timer.laps.length < 1 && sim.time < 300) sim.step(1 / 120)
    const real = e.timer.laps[0]
    const scale = real ? real / estimateLap(e, sim.line, sim.difficulty) : 1
    scaleCache.set(cacheKey, scale)
    return scale
  } finally {
    AI.mistakeRate = saved
  }
}
