import { analyseTrack } from '../track/analyse.js'
import { buildSurface } from '../race/surface.js'
import { RaceSim } from '../race/raceSim.js'
import {
  calibrate,
  simulateQualifying,
  gridOrder,
  estimateLap,
} from '../race/qualifying.js'
import { stopTime, pitWindow } from '../race/pits.js'
import { POINTS } from '../data/grid.js'
import { formatTime } from '../race/laps.js'

export const QUICK = {
  form: 0.011,
  lapNoise: 0.004,
  trafficPerPlace: 0.3,
  spinPerLap: { clean: 0.006, normal: 0.012, ragged: 0.025 },
  spinCost: [2.5, 7],
  penaltyChance: { calm: 0.01, normal: 0.035, aggressive: 0.09 },
  bestLapEdge: 0.006,
}

function gauss(rng) {
  return (rng() + rng() + rng() + rng() - 2) / 2
}

export async function simulateRound({
  track,
  laps,
  qualifying = true,
  difficulty = 'normal',
  rng = Math.random,
  seats = undefined,
  points = POINTS,
}) {
  const analysis = analyseTrack(track)
  if (!analysis.ok) throw new Error('Circuit is not raceable')
  const loop = analysis.loop
  const surface = buildSurface(track)
  const scale = await calibrate({
    loop,
    surface,
    difficulty,
    key: JSON.stringify(track.toJSON().pieces),
  })
  const sim = new RaceSim({
    loop,
    surface,
    playerIndex: null,
    laps,
    difficulty,
    seed: Math.floor(rng() * 1e9),
    seats,
  })
  const entries = sim.entries
  const line = sim.line

  const order = qualifying
    ? gridOrder(
        simulateQualifying(entries, line, {
          rng,
          difficulty: sim.difficulty,
          scale,
        }),
      )
    : [...entries].sort((a, b) => a.grid - b.grid).map((e) => e.index)
  const gridPos = new Map(order.map((index, i) => [index, i + 1]))

  const window = pitWindow(laps)
  const rows = entries.map((e) => {
    const lap = estimateLap(e, line, sim.difficulty) * scale
    const d = e.driver
    const form = 1 + gauss(rng) * QUICK.form
    const grid = gridPos.get(e.index)
    let time = 0
    let best = Infinity
    for (let l = 0; l < laps; l++) {
      let t = lap * form * (1 + gauss(rng) * QUICK.lapNoise)
      if (rng() < (QUICK.spinPerLap[d.consistency] ?? QUICK.spinPerLap.normal))
        t +=
          QUICK.spinCost[0] + rng() * (QUICK.spinCost[1] - QUICK.spinCost[0])
      else best = Math.min(best, t * (1 - rng() * QUICK.bestLapEdge))
      time += t
    }
    time += (grid - 1) * QUICK.trafficPerPlace + lap * 0.25
    let stop = null
    if (window) {
      const st = stopTime(e.team, rng)
      stop = {
        lap: window.from + Math.floor(rng() * (window.to - window.from + 1)),
        time: st.time,
        fumble: st.fumble,
      }
      time += st.time + lap * 0.5
    }
    let penalty = 0
    if (
      rng() < (QUICK.penaltyChance[d.aggression] ?? QUICK.penaltyChance.normal)
    )
      penalty = rng() < 0.7 ? 5 : 10
    return {
      e,
      grid,
      lap,
      time: time + penalty,
      best: Number.isFinite(best) ? best : lap,
      stop,
      penalty,
    }
  })

  rows.sort((a, b) => a.time - b.time)
  const win = rows[0]
  return rows.map((r, i) => {
    const down = Math.floor((r.time - win.time) / win.lap)
    const gap =
      i === 0
        ? formatTime(r.time)
        : down >= 1
          ? `+${down} lap${down > 1 ? 's' : ''}`
          : `+${(r.time - win.time).toFixed(3)}`
    return {
      code: r.e.driver.code,
      name: r.e.driver.name,
      team: r.e.driver.team,
      pos: i + 1,
      points: points[i] ?? 0,
      dsq: false,
      grid: r.grid,
      gap,
      best: r.best,
      penalty: r.penalty,
      stop: r.stop,
    }
  })
}
