import { DRIVERS, TEAMS, TEAM_ORDER, ENGINES } from './grid.js'
import { CHAMPION_DRIVERS, CHAMPION_TEAMS, CHAMPION_ENGINES } from './champions.js'

const FIELDS = {
  grid: {
    label: '2026 Grid',
    drivers: [...DRIVERS],
    teams: { ...TEAMS },
    engines: { ...ENGINES },
  },
  champions: {
    label: 'Champions',
    drivers: CHAMPION_DRIVERS,
    teams: CHAMPION_TEAMS,
    engines: { ...ENGINES, ...CHAMPION_ENGINES },
  },
}

let current = 'grid'

export const FIELD_LABELS = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, f.label]))

export function useField(name = 'grid') {
  const f = FIELDS[name] ? name : 'grid'
  if (f === current) return
  const field = FIELDS[f]
  DRIVERS.splice(0, DRIVERS.length, ...field.drivers)
  for (const k of Object.keys(TEAMS)) delete TEAMS[k]
  Object.assign(TEAMS, field.teams)
  TEAM_ORDER.splice(0, TEAM_ORDER.length, ...Object.keys(field.teams))
  for (const k of Object.keys(ENGINES)) delete ENGINES[k]
  Object.assign(ENGINES, field.engines)
  current = f
}

export const currentField = () => current

export function withField(name, fn) {
  const before = current
  useField(name)
  try {
    return fn()
  } finally {
    useField(before)
  }
}
