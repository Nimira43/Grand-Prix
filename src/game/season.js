import { DRIVERS, TEAMS, POINTS } from '../data/grid.js'
import { formatTime } from '../race/laps.js'

export const SEASON_VERSION = 1

export function newSeason({
  kind,
  driverCode,
  calendar,
  laps,
  qualifying,
  difficulty,
  assists,
}) {
  return {
    version: SEASON_VERSION,
    kind,
    created: Date.now(),
    driver: driverCode,
    laps,
    qualifying: kind === 'player' && qualifying,
    difficulty,
    assists: { ...assists },
    calendar: calendar.map((t) => ({ name: t.name, data: t.toJSON() })),
    rounds: calendar.map(() => null),
    lineup: DRIVERS.map((d) => ({ code: d.code, name: d.name, team: d.team })),
  }
}

export const nextRound = (season) => season.rounds.findIndex((r) => r == null)
export const isOver = (season) => nextRound(season) === -1
export const roundsRun = (season) => season.rounds.filter(Boolean).length

export function driverIndexOf(code) {
  const i = DRIVERS.findIndex((d) => d.code === code)
  return i >= 0 ? i : 0
}

export function driverInfo(season, code) {
  const now = DRIVERS.find((d) => d.code === code)
  if (now) return { code, name: now.name, team: now.team }
  for (const r of season.rounds) {
    const row = r?.results.find((x) => x.code === code)
    if (row) return { code, name: row.name, team: row.team }
  }
  return (
    season.lineup.find((d) => d.code === code) ?? {
      code,
      name: code,
      team: 'haas',
    }
  )
}

export function recordFromRace(results) {
  const winner = results[0]
  const winnerLaps = winner?.entry.timer.laps.length ?? 0
  return results.map((r) => {
    const e = r.entry
    let gap
    if (r.dsq) gap = 'DSQ'
    else if (r.pos === 1) gap = formatTime(r.time)
    else if (!e.finished) gap = 'DNF'
    else if (r.laps < winnerLaps)
      gap = `+${winnerLaps - r.laps} lap${winnerLaps - r.laps > 1 ? 's' : ''}`
    else gap = `+${(r.time - winner.time).toFixed(3)}`
    return {
      code: e.driver.code,
      name: e.driver.name,
      team: e.driver.team,
      pos: r.pos,
      points: r.points,
      dsq: !!r.dsq,
      grid: e.grid,
      gap,
      best: r.best,
      penalty: r.penalty || 0,
      stop: r.stop
        ? { lap: r.stop.lap, time: r.stop.time, fumble: !!r.stop.fumble }
        : null,
    }
  })
}

export function roundFromRecord(results, simulated = false) {
  let fastest = null
  for (const r of results)
    if (r.best != null && (!fastest || r.best < fastest.best)) fastest = r
  const pole = results.find((r) => r.grid === 1)
  return {
    results,
    simulated,
    pole: pole?.code ?? null,
    fastest: fastest ? { code: fastest.code, time: fastest.best } : null,
  }
}

function countback(a, b) {
  for (let p = 0; p < 22; p++) {
    const d = (b.finishes[p] ?? 0) - (a.finishes[p] ?? 0)
    if (d) return d
  }
  return 0
}

export function driverStandings(season) {
  const table = new Map()
  const row = (code) => {
    if (!table.has(code)) {
      const info = driverInfo(season, code)
      table.set(code, {
        ...info,
        points: 0,
        wins: 0,
        podiums: 0,
        finishes: [],
        perRound: season.rounds.map(() => null),
      })
    }
    return table.get(code)
  }

  for (const d of DRIVERS) row(d.code)
  season.rounds.forEach((round, i) => {
    if (!round) return
    for (const r of round.results) {
      const t = row(r.code)
      t.team = r.team
      t.points += r.points
      t.perRound[i] = r.dsq ? 'DSQ' : r.pos
      if (!r.dsq) {
        t.finishes[r.pos - 1] = (t.finishes[r.pos - 1] ?? 0) + 1
        if (r.pos === 1) t.wins++
        if (r.pos <= 3) t.podiums++
      }
    }
  })
  return [...table.values()].sort(
    (a, b) =>
      b.points - a.points || countback(a, b) || a.name.localeCompare(b.name),
  )
}

export function constructorStandings(season) {
  const table = new Map()
  for (const id of Object.keys(TEAMS))
    table.set(id, {
      id,
      ...TEAMS[id],
      points: 0,
      wins: 0,
      podiums: 0,
      finishes: [],
      drivers: new Set(),
    })
  for (const round of season.rounds) {
    if (!round) continue
    for (const r of round.results) {
      const t = table.get(r.team)
      if (!t) continue
      t.points += r.points
      t.drivers.add(r.code)
      if (!r.dsq) {
        t.finishes[r.pos - 1] = (t.finishes[r.pos - 1] ?? 0) + 1
        if (r.pos === 1) t.wins++
        if (r.pos <= 3) t.podiums++
      }
    }
  }
  return [...table.values()].sort(
    (a, b) =>
      b.points - a.points || countback(a, b) || a.name.localeCompare(b.name),
  )
}

export function titleDecided(season) {
  const left = season.rounds.filter((r) => r == null).length
  const [a, b] = driverStandings(season)
  return !!a && !!b && a.points - b.points > left * POINTS[0]
}

const SEASON_KEYS = { player: 'grand-prix.season', tv: 'grand-prix.season.tv' }

export function loadSeason(kind) {
  try {
    const s = JSON.parse(localStorage.getItem(SEASON_KEYS[kind]) || 'null')
    return s &&
      s.version === SEASON_VERSION &&
      Array.isArray(s.calendar) &&
      s.calendar.length
      ? s
      : null
  } catch {
    return null
  }
}

export function saveSeason(season) {
  try {
    localStorage.setItem(SEASON_KEYS[season.kind], JSON.stringify(season))
    return true
  } catch {
    return false
  }
}

export function clearSeason(kind) {
  try {
    localStorage.removeItem(SEASON_KEYS[kind])
  } catch {}
}

const SETUP_KEYS = {
  race: 'grand-prix.setup.race',
  tv: 'grand-prix.setup.tv',
  season: 'grand-prix.setup.season',
  tvSeason: 'grand-prix.setup.tvSeason',
}

export function loadSetup(kind) {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEYS[kind]) || 'null')
  } catch {
    return null
  }
}

export function saveSetup(kind, setup) {
  try {
    localStorage.setItem(SETUP_KEYS[kind], JSON.stringify(setup))
  } catch {}
}
