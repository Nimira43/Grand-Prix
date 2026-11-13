import { DRIVERS, TEAMS, TEAM_ORDER } from '../data/grid.js'
import { DIFFICULTY } from '../race/ai.js'
import { BRAKE_ASSIST } from '../race/assists.js'
import { MAX_LAPS } from '../track/track.js'
import { Track } from '../track/track.js'
import { analyseTrack } from '../track/analyse.js'
import * as store from '../track/storage.js'
import { ThemeMusic } from '../audio/engineAudio.js'
import { formatTime } from '../race/laps.js'
import { drawPreview } from './preview.js'
import {
  newSeason,
  nextRound,
  isOver,
  roundsRun,
  driverIndexOf,
  driverInfo,
  recordFromRace,
  roundFromRecord,
  driverStandings,
  constructorStandings,
  titleDecided,
  seededFor,
  seedingMoves,
  originalSeeds,
  loadSeason,
  saveSeason,
  loadSetup,
  saveSetup,
} from '../game/season.js'
import { simulateRound } from '../game/simRound.js'
import { useField, withField, FIELD_LABELS } from '../data/fields.js'
import { PREQUAL_PLACES } from '../data/champions.js'

const esc = (s) => String(s).replace(/[&<>'']/g, (c) => `&#${c.charCodeAt(0)}`)
const MUSIC_KEY = 'grand-prix.menuMusic'
const DEFAULT_LAPS = 8

const KINDS = {
  race: { title: 'Single Race', tv: false, season: false, go: 'Go racing' },
  season: {
    title: 'Championship',
    tv: false,
    season: true,
    go: 'Start the season',
  },
  tv: { title: 'Watch a Race', tv: true, season: false, go: 'Watch the race' },
  tvSeason: {
    title: 'Watch a Championship',
    tv: true,
    season: true,
    go: 'Start the season',
  },
}

function readLegacy(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v == null ? fallback : v
  } catch {
    return fallback
  }
}

function defaultSetup() {
  const i = Number(readLegacy('grand-prix.testDriver', 0))
  let assists = { brake: 'off', line: false }
  try {
    assists = {
      ...assists,
      ...JSON.parse(readLegacy('grand-prix.assists', '{}')),
    }
  } catch {}
  const difficulty = readLegacy('grand-prix.difficulty', 'normal')
  return {
    field: 'grid',
    driver: (DRIVERS[i] ?? DRIVERS[0]).code,
    track: null,
    calendar: [],
    laps: DEFAULT_LAPS,
    qualifying: readLegacy('grand-prix.qualifying', '1') !== '0',
    difficulty: DIFFICULTY[difficulty] ? difficulty : 'normal',
    brake: BRAKE_ASSIST[assists.brake] ? assists.brake : 'off',
    line: !!assists.line,
  }
}

function raceableTracks() {
  const out = []
  for (const t of store.listTracks()) {
    if (!t.valid) continue
    const track = store.loadTrack(t.name)
    if (track && analyseTrack(track).ok) out.push({ name: t.name, track })
  }
  return out
}

function teamDot(teamId) {
  return `<i class='gp-m-dot' style='background:${TEAMS[teamId]?.colour ?? '#888'}'></i>`
}

export class Menus {
  constructor(root, app) {
    this.app = app
    this.el = document.createElement('div')
    this.el.className = 'gp-menu'
    root.appendChild(this.el)
    this.music = new ThemeMusic()
    this.musicOn = readLegacy(MUSIC_KEY, '1') !== '0'
    this.musicStarted = false
    this.visible = false
    this.screen = null
    this.onKey = (e) => this.visible && this.key(e)
    window.addEventListener('keydown', this.onKey)

    this.onGesture = () => {
      this.gestured = true
      if (this.visible) this.startMusic()
    }
    window.addEventListener('pointerdown', this.onGesture)
    window.addEventListener('keydown', this.onGesture)
    this.onResize = () => this.visible && this.redrawPreviews()
    window.addEventListener('resize', this.onResize)
  }

  show(screen, ...args) {
    useField('grid') 
    this.visible = true
    this.el.classList.add('is-visible')
    this.screen = screen
    this[screen](...args)
    this.startMusic()
  }

  hide() {
    this.visible = false
    this.el.classList.remove('is-visible')
    this.el.innerHTML = ''
    this.music.stop()
    this.musicStarted = false
  }

  startMusic() {
    const allowed = navigator.userActivation
      ? navigator.userActivation.hasBeenActive
      : this.gestured
    if (!this.musicOn || this.musicStarted || !allowed) return
    this.musicStarted = true
    this.music.play(0.45)
  }

  toggleMusic() {
    this.musicOn = !this.musicOn
    try {
      localStorage.setItem(MUSIC_KEY, this.musicOn ? '1' : '0')
    } catch {}
    if (this.musicOn) this.startMusic()
    else {
      this.music.stop()
      this.musicStarted = false
    }
    const b = this.el.querySelector("[data-act='music']")
    if (b) b.textContent = this.musicOn ? '♪ Music on' : '♪ Music off'
  }

  render(html) {
    this.el.onclick = this.el.onchange = this.el.oninput = null
    this.keyHandler = null
    this.el.innerHTML = html
    this.el.scrollTop = 0
    this.el
      .querySelector("[data-act='music']")
      ?.addEventListener('click', () => this.toggleMusic())
    requestAnimationFrame(() => this.redrawPreviews())
  }

  redrawPreviews() {
    for (const c of this.el.querySelectorAll('canvas[data-preview]')) {
      const track = this.previewTracks?.get(c.dataset.preview)
      if (track) drawPreview(c, track, { details: c.dataset.details === '1' })
    }
  }

  musicButton() {
    return `<button class='gp-m-ghost' data-act='music' title='Theme music (M)'>${this.musicOn ? '♪ Music on' : '♪ Music off'}</button>`
  }

  key(e) {
    if (e.target.closest?.('input, select, textarea')) return
    if (e.code === 'KeyM') return this.toggleMusic()
    this.keyHandler?.(e)
  }

  title(focus = 'race') {
    const tracks = raceableTracks()
    this.previewTracks = new Map()
    const bg = tracks.length
      ? tracks[Math.floor(Math.random() * tracks.length)].track
      : store.exampleTrack()
    this.previewTracks.set('bg', bg)

    const items = [
      [
        'race',
        'Single Race',
        'One grand prix: pick your seat and your circuit',
      ],
      [
        'season',
        'Championship',
        'A season of rounds, points and a world champion',
      ],
      ['tv', 'TV Mode', 'Sit back and watch: a race or a whole season'],
      ['editor', 'Track Editor', 'Build and test your own circuits'],
    ]
    this.render(`
      <div class='gp-m-title'>
        <canvas class='gp-m-title-bg' data-preview='bg' data-details='1'></canvas>
        <div class='gp-m-title-shade'></div>
        <div class='gp-m-title-main'>
          <h1 class='gp-m-logo'><span>GRAND</span><span>PRIX</span></h1>
          <p class='gp-m-tagline'>2026 · 22 drivers · 11 teams · 36 champions · your circuits</p>
          <nav class='gp-m-items'>
            ${items
              .map(
                ([id, label, sub]) => `
              <button class='gp-m-item' data-item='${id}'>
                <b>${label}</b><span>${sub}</span>
              </button>`,
              )
              .join('')}
          </nav>
        </div>
        <aside class='gp-m-choice' data-choice></aside>
        <footer class='gp-m-title-foot'>
          <span><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> select · <kbd>Esc</kbd> back · <kbd>M</kbd> music</span>
          ${this.musicButton()}
        </footer>
      </div>`)

    const choose = (id) => {
      this.titleFocus = id
      for (const b of this.el.querySelectorAll('[data-item]'))
        b.classList.toggle('is-on', b.dataset.item === id)
      this.renderChoice(id)
    }
    this.el.querySelector('.gp-m-items').addEventListener('click', (e) => {
      const b = e.target.closest('[data-item]')
      if (b) choose(b.dataset.item)
    })
    this.el.querySelector('[data-choice]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]')
      if (b && !b.disabled) this.titleGo(b.dataset.go)
    })
    this.keyHandler = (e) => {
      const ids = items.map((i) => i[0])
      const i = ids.indexOf(this.titleFocus)
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
        e.preventDefault()
        choose(
          ids[(i + (e.code === 'ArrowDown' ? 1 : ids.length - 1)) % ids.length],
        )
      } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        const b = this.el.querySelector(
          '[data-choice] [data-go]:not(:disabled)',
        )
        if (b) {
          e.preventDefault()
          this.titleGo(b.dataset.go)
        }
      }
    }
    choose(focus)
  }

  renderChoice(id) {
    const box = this.el.querySelector('[data-choice]')
    const option = (go, label, detail, primary = false, disabled = false) => `
      <button class='gp-m-opt${primary ? ' is-primary' : ''}' data-go='${go}' ${disabled ? 'disabled' : ''}>
        <b>${label}</b>${detail ? `<span>${detail}</span>` : ''}
      </button>`
    const raceContinue = (kind) => {
      const s = this.continuableSetup(kind)
      if (!s)
        return option(
          `${kind}:continue`,
          'Continue',
          'Nothing to continue yet',
          false,
          true,
        )
      const who = withField(s.field ?? 'grid', () => {
        const d = DRIVERS[driverIndexOf(s.driver)]
        return KINDS[kind].tv
          ? `Following ${d.name}`
          : `${d.name} · ${TEAMS[d.team].name}`
      })
      const field = s.field === 'champions' ? 'Champions · ' : ''
      return option(
        `${kind}:continue`,
        'Continue',
        `${field}${who}<br>${esc(s.track)} · ${s.laps} laps`,
        true,
      )
    }
    const seasonContinue = (kind) => {
      const grid = seasonOption(kind, 'grid')
      const champs = seasonOption(kind, 'champions')
      if (!grid && !champs)
        return option(
          `${kind}:continue`,
          'Continue',
          'No season in progress',
          false,
          true,
        )
      return (grid ?? '') + (champs ?? '')
    }
    const seasonOption = (kind, field) => {
      const s = loadSeason(kind === 'season' ? 'player' : 'tv', field)
      if (!s) return null
      return withField(field, () => seasonSummary(kind, s, field))
    }
    const seasonSummary = (kind, s, field) => {
      const n = s.calendar.length
      const done = isOver(s)
      const me = driverStandings(s).findIndex((r) => r.code === s.driver) + 1
      const who = driverInfo(s, s.driver).name
      const where = done
        ? 'Season complete'
        : `Round ${nextRound(s) + 1} of ${n}: ${esc(s.calendar[nextRound(s)].name)}`
      const standing = roundsRun(s)
        ? kind === 'season'
          ? `You're P${me} in the championship`
          : `${who} is P${me}`
        : kind === 'season'
          ? `${who} · ${TEAMS[driverInfo(s, s.driver).team]?.name ?? ''}`
          : `Following ${who}`
      return option(
        `${kind}:continue:${field}`,
        field === 'champions' ? 'Continue: Champions' : 'Continue',
        `${where}<br>${standing}`,
        true,
      )
    }
    let html = ''
    if (id === 'race')
      html = `<h3>Single Race</h3>${raceContinue('race')}${option('race:new', 'Start new', 'Choose your driver, circuit and laps')}`
    else if (id === 'season')
      html = `<h3>Championship</h3>${seasonContinue('season')}${option('season:new', 'Start new', 'Choose your seat and build a calendar')}`
    else if (id === 'tv')
      html = `
        <h3>Watch a Race</h3>${raceContinue('tv')}${option('tv:new', 'Start new', 'Pick a circuit and who to follow')}
        <h3>Watch a Championship</h3>${seasonContinue('tvSeason')}${option('tvSeason:new', 'Start new', 'Build a calendar and watch it unfold')}`
    else if (id === 'editor') {
      const draft = store.loadDraft()
      const name = draft && draft.pieces.length ? draft.name : null
      html = `<h3>Track Editor</h3>
        ${option('editor:continue', 'Continue', name ? `Carry on with “${esc(name)}”` : 'Nothing in progress', true, !name)}
        ${option('editor:new', 'New circuit', 'A blank map')}`
    }
    box.innerHTML = html
  }

  continuableSetup(kind) {
    const s = loadSetup(kind)
    if (!s?.track || !store.trackExists(s.track)) return null
    const track = store.loadTrack(s.track)
    return track && analyseTrack(track).ok ? s : null
  }

  titleGo(go) {
    const [kind, what, field = 'grid'] = go.split(':')
    if (kind === 'editor') {
      if (what === 'new') {
        const draft = store.loadDraft()
        if (
          draft?.pieces.length &&
          !confirm(
            `Start a new circuit? Your draft “${draft.name}” will be cleared (anything you saved stays in your library).`,
          )
        )
          return
      }
      return this.app.openEditor({ fresh: what === 'new' })
    }
    if (KINDS[kind].season) {
      if (what === 'continue')
        return this.show(
          'hub',
          loadSeason(kind === 'season' ? 'player' : 'tv', field),
        )
      return this.show('setup', kind)
    }
    if (what === 'continue')
      return this.launchSingle(kind, this.continuableSetup(kind))
    this.show('setup', kind)
  }

  setup(kind, field = null) {
    const K = KINDS[kind]
    const tracks = raceableTracks()
    this.previewTracks = new Map(tracks.map((t) => [t.name, t.track]))
    field = field ?? loadSetup(kind)?.field ?? 'grid'
    const saved = loadSetup(kind, field)
    useField(field)
    const s = { ...defaultSetup(), ...(saved ?? {}), field }
    if (!DRIVERS.some((d) => d.code === s.driver)) s.driver = DRIVERS[0].code
    s.calendar = (s.calendar ?? []).filter((n) => this.previewTracks.has(n))
    if (!this.previewTracks.has(s.track)) s.track = tracks[0]?.name ?? null
    if (K.season && !saved) s.calendar = tracks.map((t) => t.name).slice(0, 6)
    this.setupState = s
    this.setupKind = kind

    const teams = TEAM_ORDER.map((id) => {
      const team = TEAMS[id]
      const drivers = DRIVERS.map((d, i) => ({ ...d, i })).filter(
        (d) => d.team === id,
      )
      return `
        <div class='gp-m-team' style='--team:${team.colour}'>
          <span class='gp-m-team-name'>${esc(team.name)}</span>
          ${drivers
            .map(
              (d) => `
            <button class='gp-m-driver' data-driver='${d.code}'>
              <b>${d.number ? `<small>${d.number}</small>` : ''}${esc(d.name)}</b><span>${field === 'champions' ? (d.star ? '★ ' : 'PQ ') : ''}${d.code}</span>
              <em class='gp-m-pips' title='Driver rating ${d.rating}/10'>${'▮'.repeat(d.rating)}<s>${'▮'.repeat(10 - d.rating)}</s></em>
            </button>`,
            )
            .join('')}
        </div>`
    }).join('')

    const cards = tracks.length
      ? tracks
          .map(
            (t) => `
        <button class='gp-m-card' data-track='${esc(t.name)}'>
          <canvas data-preview='${esc(t.name)}'></canvas>
          <b>${esc(t.name)}</b>
          <em class='gp-m-round' hidden></em>
        </button>`,
          )
          .join('')
      : "<p class='gp-m-empty'>No raceable circuits yet. Build one in the Track Editor and save it.</p>"

    const difficulty = Object.entries(DIFFICULTY)
      .map(([k, v]) => `<option value='${k}'>${v.label}</option>`)
      .join('')
    const brake = Object.entries(BRAKE_ASSIST)
      .map(([k, v]) => `<option value='${k}'>${v.label}</option>`)
      .join('')

    this.render(`
      <div class='gp-m-page'>
        <header class='gp-m-head'>
          <button class='gp-m-back' data-act='back'>‹ Menu</button>
          <h2>${K.title}</h2>
          ${this.musicButton()}
        </header>
        <div class='gp-m-setup${K.season ? ' is-season' : ''}'>
          <section class='gp-m-panel gp-m-drivers'>
            <div class='gp-m-field' role='group' aria-label='Field'>
              ${Object.entries(FIELD_LABELS)
                .map(
                  ([k, label]) =>
                    `<button data-field='${k}' class='${k === field ? 'is-on' : ''}'>${label}</button>`,
                )
                .join('')}
            </div>
            ${field === 'champions' ? `<p class='gp-m-note'>All 36 World Champions, all rated 10, in equal cars. ★ are seeded into the opening race the other 20 prequalify for ${PREQUAL_PLACES} places. In a championship, each race's top 16 stay seeded and the bottom 6 drop to prequalifying.</p>` : ''}
            <h4>${K.tv ? 'Follow' : 'Your seat'}</h4>
            <div class='gp-m-teams'>${teams}</div>
          </section>
          <section class='gp-m-panel gp-m-circuits'>
            <h4>${K.season ? 'Calendar <span>click circuits to add or remove rounds</span>' : 'Circuit'}</h4>
            <div class='gp-m-cards'>${cards}</div>
          </section>
          <section class='gp-m-panel gp-m-options'>
            ${
              K.season
                ? `<h4>Rounds</h4>
                   <ol class='gp-m-calendar' data-calendar></ol>
                   <div class='gp-m-row gp-m-calbtns'><button data-act='all'>Add all</button><button data-act='clear'>Clear</button><button data-act='shuffle'>Shuffle</button></div>`
                : ''
            }
            <h4>${K.season ? 'Every round' : 'Race'}</h4>
            <label class='gp-m-row'>Laps
              <span class='gp-m-stepper'><button data-act='laps-'>−</button><input data-opt='laps' type='number' min='1' max='${MAX_LAPS}' /><button data-act='laps+'>+</button></span>
            </label>
            <p class='gp-m-note' data-pitnote></p>
            ${
              K.tv
                ? ''
                : `
            <label class='gp-m-row'>One-shot qualifying <input data-opt='qualifying' type='checkbox' /></label>
            <label class='gp-m-row'>Opposition <select data-opt='difficulty'>${difficulty}</select></label>
            <label class='gp-m-row'>Brake assist <select data-opt='brake'>${brake}</select></label>
            <label class='gp-m-row'>Braking line <input data-opt='line' type='checkbox' /></label>`
            }
            ${K.season ? "<p class='gp-m-note'>Points 10-6-4-3-2-1 · every round counts · one pit stop each race</p>" : ''}
            <p class='gp-m-warn' data-warn></p>
            <button class='gp-m-go' data-act='go'>${K.go} ›</button>
          </section>
        </div>
      </div>`)

    const root = this.el
    root.onclick = (e) => this.setupClick(e)
    root.onchange = (e) => this.setupChange(e)
    root.oninput = (e) =>
      e.target.dataset.opt === 'laps' && this.setupChange(e)
    this.keyHandler = (e) => {
      if (e.code === 'Escape')
        this.show(
          'title',
          K.season
            ? kind === 'season'
              ? 'season'
              : 'tv'
            : kind === 'race'
              ? 'race'
              : 'tv',
        )
    }
    this.syncSetup()
  }

  setupClick(e) {
    const s = this.setupState
    const t = e.target
    const driver = t.closest('[data-driver]')?.dataset.driver
    const card = t.closest('[data-track]')?.dataset.track
    const act = t.closest('[data-act]')?.dataset.act
    const cal = t.closest('[data-cal]')
    const fieldBtn = t.closest('[data-field]')?.dataset.field
    if (fieldBtn) {
      if (fieldBtn === s.field) return
      saveSetup(this.setupKind, s)
      return this.setup(this.setupKind, fieldBtn)
    }
    if (driver) s.driver = driver
    else if (card != null) {
      if (KINDS[this.setupKind].season) {
        const i = s.calendar.indexOf(card)
        if (i >= 0) s.calendar.splice(i, 1)
        else s.calendar.push(card)
      } else s.track = card
    } else if (cal) {
      const i = Number(cal.dataset.cal)
      const op = cal.dataset.op
      if (op === 'up' && i > 0)
        [s.calendar[i - 1], s.calendar[i]] = [s.calendar[i], s.calendar[i - 1]]
      else if (op === 'down' && i < s.calendar.length - 1)
        [s.calendar[i + 1], s.calendar[i]] = [s.calendar[i], s.calendar[i + 1]]
      else if (op === 'remove') s.calendar.splice(i, 1)
    } else if (act === 'back') return this.keyHandler({ code: 'Escape' })
    else if (act === 'laps-') s.laps = Math.max(1, s.laps - 1)
    else if (act === 'laps+') s.laps = Math.min(MAX_LAPS, s.laps + 1)
    else if (act === 'all') s.calendar = [...this.previewTracks.keys()]
    else if (act === 'clear') s.calendar = []
    else if (act === 'shuffle') s.calendar.sort(() => Math.random() - 0.5)
    else if (act === 'go') return this.setupGo()
    else return
    this.syncSetup()
  }

  setupChange(e) {
    const s = this.setupState
    const opt = e.target.dataset.opt
    if (!opt) return
    if (opt === 'laps') {
      const v = Math.round(Number(e.target.value))
      if (Number.isFinite(v) && v >= 1) s.laps = Math.min(MAX_LAPS, v)
      if (e.type === 'input') return this.syncSetup(false)
    } else if (e.target.type === 'checkbox') s[opt] = e.target.checked
    else s[opt] = e.target.value
    this.syncSetup()
  }

  syncSetup(rewriteLaps = true) {
    const s = this.setupState
    const K = KINDS[this.setupKind]
    const root = this.el
    for (const b of root.querySelectorAll('[data-driver]'))
      b.classList.toggle('is-on', b.dataset.driver === s.driver)
    for (const c of root.querySelectorAll('[data-track]')) {
      const name = c.dataset.track
      const badge = c.querySelector('.gp-m-round')
      if (K.season) {
        const i = s.calendar.indexOf(name)
        c.classList.toggle('is-on', i >= 0)
        badge.hidden = i < 0
        badge.textContent = i >= 0 ? `R${i + 1}` : ''
      } else c.classList.toggle('is-on', name === s.track)
    }
    const cal = root.querySelector('[data-calendar]')
    if (cal)
      cal.innerHTML = s.calendar.length
        ? s.calendar
            .map(
              (n, i) => `
          <li><span>${esc(n)}</span>
            <button data-cal='${i}' data-op='up' title='Earlier' ${i === 0 ? 'disabled' : ''}>▲</button>
            <button data-cal='${i}' data-op='down' title='Later' ${i === s.calendar.length - 1 ? 'disabled' : ''}>▼</button>
            <button data-cal='${i}' data-op='remove' title='Remove'>✕</button>
          </li>`,
            )
            .join('')
        : "<li class='gp-m-empty'>No rounds yet</li>"
    const laps = root.querySelector("[data-opt='laps']")
    if (rewriteLaps) laps.value = s.laps
    for (const k of ['qualifying', 'line']) {
      const box = root.querySelector(`[data-opt='${k}']`)
      if (box) box.checked = !!s[k]
    }
    for (const k of ['difficulty', 'brake']) {
      const sel = root.querySelector(`[data-opt='${k}']`)
      if (sel) sel.value = s[k]
    }
    const pit = root.querySelector('[data-pitnote]')
    const from = Math.min(3, Math.max(1, s.laps - 2))
    const to = Math.min(5, s.laps - 1)
    pit.textContent =
      to >= from && to >= 1
        ? `Pit window: laps ${from === to ? from : `${from}–${to}`}`
        : 'Too short for a pit stop'
    let warn = ''
    if (K.season && !s.calendar.length)
      warn = 'Add at least one circuit to the calendar.'
    if (!K.season && !s.track) warn = 'Choose a circuit.'
    root.querySelector('[data-warn]').textContent = warn
    root.querySelector("[data-act='go']").disabled = !!warn
  }

  setupGo() {
    const kind = this.setupKind
    const s = this.setupState
    saveSetup(kind, s)
    if (!KINDS[kind].season) return this.launchSingle(kind, s)
    const seasonKind = kind === 'season' ? 'player' : 'tv'
    const existing = loadSeason(seasonKind, s.field)
    if (
      existing &&
      !isOver(existing) &&
      !confirm(
        `Start a new ${kind === 'season' ? '' : 'TV '}championship? The season in progress (${roundsRun(existing)} of ${existing.calendar.length} rounds run) will be lost.`,
      )
    )
      return
    const season = newSeason({
      kind: seasonKind,
      driverCode: s.driver,
      calendar: s.calendar.map((n) => this.previewTracks.get(n)),
      laps: s.laps,
      qualifying: s.qualifying,
      difficulty: KINDS[kind].tv ? 'normal' : s.difficulty,
      assists: { brake: s.brake, line: s.line },
      field: s.field,
    })
    saveSeason(season)
    this.show('hub', season)
  }

  launchSingle(kind, s) {
    const track = store.loadTrack(s.track)
    if (!track) return
    saveSetup(kind, s)
    const tv = KINDS[kind].tv
    if (s.field === 'champions')
      return this.show('weekend', {
        single: true,
        kind,
        tv,
        track,
        laps: s.laps,
        driver: s.driver,
        difficulty: tv ? 'normal' : s.difficulty,
        assists: { brake: s.brake, line: s.line },
        qualifying: !tv && s.qualifying,
        prequal: null,
        seeded: originalSeeds(),
        onAssistsChange: (a) =>
          saveSetup(kind, { ...s, brake: a.brake, line: a.line }),
      })
    this.app.startRace({
      track,
      laps: s.laps,
      driverIndex: driverIndexOf(s.driver),
      mode: tv ? 'tv' : 'race',
      difficulty: tv ? 'normal' : s.difficulty,
      assists: { brake: s.brake, line: s.line },
      qualifying: !tv && s.qualifying,
      onAssistsChange: (a) =>
        saveSetup(kind, { ...s, brake: a.brake, line: a.line }),
      onExit: () => this.show('title', tv ? 'tv' : 'race'),
    })
  }

  hub(season, news = null) {
    if (!season) return this.show('title', 'season')
    useField(season.field ?? 'grid')
    this.season = season
    const champs = season.field === 'champions'
    const tv = season.kind === 'tv'
    const n = season.calendar.length
    const next = nextRound(season)
    const over = next === -1
    const tracks = season.calendar.map((c) => Track.fromJSON(c.data))
    this.previewTracks = new Map(tracks.map((t, i) => [`r${i}`, t]))
    const drivers = driverStandings(season)
    const teams = constructorStandings(season)
    const me = season.driver
    const meInfo = driverInfo(season, me)
    const myPos = drivers.findIndex((d) => d.code === me) + 1
    const leader = drivers[0]
    const decided = !over && roundsRun(season) && titleDecided(season)

    const nextCard = over
      ? `
        <div class='gp-m-next is-over'>
          <span class='gp-m-kicker'>Season complete</span>
          <h3>${esc(leader.name)} is World Champion</h3>
          <p>${teamDot(leader.team)}${esc(TEAMS[leader.team]?.name ?? '')} · ${leader.points} points · ${leader.wins} win${leader.wins === 1 ? '' : 's'}</p>
          <button class='gp-m-go' data-act='finale'>The ceremony ›</button>
          <button data-act='newseason'>Start a new season</button>
        </div>`
      : `
        <div class='gp-m-next'>
          <span class='gp-m-kicker'>Round ${next + 1} of ${n}</span>
          <h3>${esc(season.calendar[next].name)}</h3>
          <canvas data-preview='r${next}' data-details='1'></canvas>
          <p>${season.laps} laps · ${season.qualifying ? 'one-shot qualifying' : 'grid from form'} · one pit stop</p>
          ${
            tv
              ? `<label class='gp-m-row'>Follow <select data-act-select='follow'>${DRIVERS.map((d) => `<option value='${d.code}' ${d.code === me ? 'selected' : ''}>${esc(d.name)} (${esc(TEAMS[d.team].name)})</option>`).join('')}</select></label>`
              : `<p class='gp-m-you'>${teamDot(meInfo.team)}${esc(meInfo.name)} · ${esc(TEAMS[meInfo.team]?.name ?? '')}</p>`
          }
          ${
            champs
              ? `<p>${season.pending?.round === next ? `Prequalifying done: ${season.pending.prequal.through.join(', ')} go through` : 'Prequalifying, then the race'}</p>
                 <button class='gp-m-go' data-act='weekend'>Go to the weekend ›</button>
                 <button data-act='simulate'>Simulate the whole round</button>`
              : `<button class='gp-m-go' data-act='race'>${tv ? 'Watch the race' : 'Race'} ›</button>
                 <button data-act='simulate'>Simulate this round</button>`
          }
        </div>`

    const newsHtml = news
      ? `<div class='gp-m-news'>${news}</div>`
      : decided
        ? `<div class='gp-m-news'><b>${esc(leader.name)}</b> has the title wrapped up with ${n - roundsRun(season)} round${n - roundsRun(season) === 1 ? '' : 's'} to go.</div>`
        : ''

    const seededNext = champs && !over ? seededFor(season, next) : null
    const statusCell = (d) =>
      seededNext
        ? `<td class='n'>${seededNext.has(d.code) ? "<span class='gp-m-seed'>SEEDED</span>" : "<em class='gp-m-pqtag'>PQ</em>"}</td>`
        : ''
    const driverRows = drivers
      .map(
        (d, i) => `
        <tr class='${d.code === me ? 'is-me' : ''}'>
          <td class='p'>${i + 1}</td>
          <td>${teamDot(d.team)}${esc(d.name)}</td>${statusCell(d)}
          <td class='t'>${esc(TEAMS[d.team]?.name ?? '')}</td>
          <td class='n'>${d.wins || ''}</td>
          <td class='n'>${d.podiums || ''}</td>
          <td class='n pts'>${d.points}</td>
        </tr>`,
      )
      .join('')
    const teamRows = teams
      .map(
        (t, i) => `
        <tr class='${t.id === meInfo.team || t.drivers?.has?.(me) ? 'is-me' : ''}'>
          <td class='p'>${i + 1}</td>
          <td>${t.colour && !TEAMS[t.id] ? `<i class='gp-m-dot' style='background:${t.colour}'></i>` : teamDot(t.id)}${esc(t.name)}</td>
          <td class='n'>${t.wins || ''}</td>
          ${champs ? `<td class='n'>${t.podiums || ''}</td><td class='n'>${t.points}</td><td class='n pts'>${t.average.toFixed(2)}</td>` : `<td class='n pts'>${t.points}</td>`}
        </tr>`,
      )
      .join('')
    const calRows = season.calendar
      .map((c, i) => {
        const r = season.rounds[i]
        const win = r?.results[0]
        const mine = r?.results.find((x) => x.code === me)
        return `
          <tr class='${i === next ? 'is-next' : ''}${r ? ' is-run' : ''}' ${r ? `data-round='${i}' title='See the result'` : ''}>
            <td class='p'>${i + 1}</td>
            <td>${esc(c.name)}${r?.simulated ? " <em class='gp-m-sim'>sim</em>" : ''}</td>
            <td>${win ? `${teamDot(win.team)}${win.code}` : i === next ? '<em>next</em>' : ''}</td>
            <td class='n'>${mine ? (mine.dsq ? 'DSQ' : `P${mine.pos}`) : r?.prequal ? 'DNPQ' : ''}</td>
          </tr>`
      })
      .join('')

    this.render(`
      <div class='gp-m-page'>
        <header class='gp-m-head'>
          <button class='gp-m-back' data-act='back'>‹ Menu</button>
          <h2>${champs ? 'Champions ' : ''}${tv ? 'TV Championship' : 'Championship'} <span>${roundsRun(season)} of ${n} rounds${roundsRun(season) ? ` · ${tv ? `${esc(meInfo.name)}` : 'you'}: P${myPos}, ${drivers[myPos - 1].points} pts` : ''}</span></h2>
          ${this.musicButton()}
        </header>
        ${newsHtml}
        <div class='gp-m-hub'>
          <section class='gp-m-panel'>${nextCard}</section>
          <section class='gp-m-panel gp-m-table'>
            <h4>Drivers</h4>
            <table><thead><tr><th>Pos</th><th>Driver</th>${seededNext ? `<th>Rd ${next + 1}</th>` : ''}<th>Team</th><th>Wins</th><th>Pod</th><th>Pts</th></tr></thead><tbody>${driverRows}</tbody></table>
          </section>
          <section class='gp-m-panel gp-m-side'>
            <div class='gp-m-table'>
              <h4>${champs ? 'World Cup <span>average points per driver</span>' : 'Constructors'}</h4>
              <table><thead><tr><th>Pos</th><th>Team</th><th>Wins</th>${champs ? '<th>Pod</th><th>Pts</th><th>Avg</th>' : '<th>Pts</th>'}</tr></thead><tbody>${teamRows}</tbody></table>
            </div>
            <div class='gp-m-table gp-m-cal'>
              <h4>Calendar <span>click a round for its result</span></h4>
              <table><thead><tr><th>Rd</th><th>Circuit</th><th>Winner</th><th>${tv ? esc(meInfo.code ?? me) : 'You'}</th></tr></thead><tbody>${calRows}</tbody></table>
            </div>
          </section>
        </div>
        <div class='gp-m-modal' data-modal hidden></div>
        <div class='gp-m-busy' data-busy hidden><span></span></div>
      </div>`)

    this.el.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act
      const round = e.target.closest('[data-round]')?.dataset.round
      if (
        e.target.closest('[data-modal]') &&
        (act === 'close' || e.target.matches('[data-modal]'))
      )
        return this.closeModal()
      if (act === 'back') this.show('title', tv ? 'tv' : 'season')
      else if (act === 'race') this.raceRound()
      else if (act === 'weekend') this.roundWeekend()
      else if (act === 'simulate') this.simulateNext()
      else if (act === 'finale') this.show('finale', season)
      else if (act === 'newseason')
        this.show('setup', tv ? 'tvSeason' : 'season')
      else if (round != null) this.showRound(Number(round))
    }
    this.el.onchange = (e) => {
      if (e.target.dataset.actSelect === 'follow') {
        season.driver = e.target.value
        saveSeason(season)
      }
    }
    this.keyHandler = (e) => {
      if (e.code === 'Escape') {
        if (!this.el.querySelector('[data-modal]').hidden)
          return this.closeModal()
        this.show('title', tv ? 'tv' : 'season')
      }
    }
  }

  closeModal() {
    const m = this.el.querySelector('[data-modal]')
    m.hidden = true
    m.innerHTML = ''
  }

  showRound(i) {
    const season = this.season
    const round = season.rounds[i]
    if (!round) return
    const rows = round.results
      .map(
        (r) => `
        <tr class='${r.code === season.driver ? 'is-me' : ''}${r.dsq ? ' is-dsq' : ''}'>
          <td class='p'>${r.dsq ? 'DSQ' : r.pos}</td>
          <td>${teamDot(r.team)}${esc(r.name)}</td>
          <td class='t'>${esc(TEAMS[r.team]?.name ?? '')}</td>
          <td class='n'>${r.gap}</td>
          <td class='n'>${r.penalty ? `+${r.penalty}s` : ''}</td>
          <td class='n${round.fastest?.code === r.code ? ' fl' : ''}'>${formatTime(r.best)}</td>
          <td class='n'>${r.grid}</td>
          <td class='n pts'>${r.points || ''}</td>
        </tr>`,
      )
      .join('')
    const m = this.el.querySelector('[data-modal]')
    m.innerHTML = `
      <div class='gp-m-modal-card'>
        <h3>Round ${i + 1}: ${esc(season.calendar[i].name)} ${round.simulated ? "<em class='gp-m-sim'>simulated</em>" : ''}</h3>
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>Team</th><th>Time</th><th>Pen</th><th>Best lap</th><th>Grid</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${
          season.field === 'champions'
            ? (() => {
                const { up, down } = seedingMoves(season, i)
                return `<p class='gp-m-note'>${up.length ? `↑ Kept a seat: <b>${up.map((c) => esc(driverInfo(season, c).name)).join(', ')}</b> · ` : ''}${down.length ? `↓ Dropped to prequalifying: <b>${down.map((c) => esc(driverInfo(season, c).name)).join(', ')}</b>` : ''}</p>`
              })()
            : ''
        }
        ${round.prequal ? `<p class='gp-m-note'>Prequalified${round.prequal.simulated ? ' (simulated)' : ''}: <b>${round.prequal.through.map((c) => esc(driverInfo(season, c).name)).join(', ')}</b></p>` : ''}
        <p class='gp-m-note'>${round.pole ? `Pole: <b>${esc(driverInfo(season, round.pole).name)}</b> · ` : ''}${round.fastest ? `Fastest lap: <b>${esc(driverInfo(season, round.fastest.code).name)}</b> ${formatTime(round.fastest.time)}` : ''}</p>
        <button data-act='close'>Close</button>
      </div>`
    m.hidden = false
  }

  raceRound() {
    const season = this.season
    const i = nextRound(season)
    if (i < 0) return
    const tv = season.kind === 'tv'
    const track = Track.fromJSON(season.calendar[i].data)
    this.app.startRace({
      track,
      laps: season.laps,
      driverIndex: driverIndexOf(season.driver),
      mode: tv ? 'tv' : 'race',
      difficulty: season.difficulty,
      assists: season.assists,
      qualifying: season.qualifying,
      round: { label: `Round ${i + 1} of ${season.calendar.length}` },
      onAssistsChange: (a) => {
        season.assists = { brake: a.brake, line: a.line }
        saveSeason(season)
      },
      onResult: (results) =>
        this.recordRound(i, recordFromRace(results), false),
      onExit: () => this.afterRound(),
    })
  }

  async simulateNext() {
    const season = this.season
    const i = nextRound(season)
    if (i < 0) return
    const busy = this.el.querySelector('[data-busy]')
    busy.querySelector('span').textContent =
      `Simulating round ${i + 1}: ${season.calendar[i].name}…`
    busy.hidden = false
    try {
      if (season.field === 'champions') {
        const w = this.seasonWeekend(i)
        if (!w.prequal) this.setPrequal(w, await this.simPrequal(w))
        this.finishMain(w, await this.simMain(w), true)
        return this.afterRound()
      }
      const results = await simulateRound({
        track: Track.fromJSON(season.calendar[i].data),
        laps: season.laps,
        qualifying: season.qualifying,
        difficulty: season.difficulty,
      })
      this.recordRound(i, results, true)
    } catch (err) {
      console.error(err)
      busy.hidden = true
      return
    }
    this.afterRound()
  }

  recordRound(i, results, simulated) {
    const season = this.season
    season.rounds[i] = roundFromRecord(results, simulated)
    saveSeason(season)
    this.lastRound = i
  }

  afterRound() {
    const season = this.season
    const i = this.lastRound
    this.lastRound = null
    if (i == null || !season.rounds[i]) return this.show('hub', season)
    if (isOver(season)) return this.show('finale', season)
    const r = season.rounds[i].results
    const win = r[0]
    const mine = r.find((x) => x.code === season.driver)
    const tv = season.kind === 'tv'
    const who = tv ? driverInfo(season, season.driver).name : 'You'
    const dnpq = !mine && season.rounds[i].prequal
    const mineText = dnpq
      ? `${who} ${tv ? 'did' : 'did'}n't prequalify.`
      : mine
        ? mine.dsq
          ? `${who} ${tv ? 'was' : 'were'} disqualified (no pit stop)`
          : `${who} finished P${mine.pos}${mine.points ? ` (+${mine.points} pt${mine.points > 1 ? 's' : ''})` : ''}`
        : ''
    let news = `<b>Round ${i + 1}, ${esc(season.calendar[i].name)}:</b> ${win.code === season.driver && !tv ? 'You won!' : `${esc(win.name)} won for ${esc(TEAMS[win.team]?.name ?? '')}.`} ${win.code === season.driver && !tv ? '' : mineText}`
    if (season.field === 'champions') {
      const { up, down } = seedingMoves(season, i)
      const names = (codes) =>
        codes.map((c) => esc(driverInfo(season, c).name)).join(', ')
      if (up.length)
        news += `<br><span class='gp-m-up'>↑ ${names(up)} ${up.length === 1 ? 'keeps a seat' : 'keep their seats'}</span>`
      if (down.length)
        news += `<br><span class='gp-m-down'>↓ ${names(down)} ${down.length === 1 ? 'drops' : 'drop'} to prequalifying</span>`
      if (!tv && down.includes(season.driver))
        news += `<br><b>You'll have to prequalify at the next round.</b>`
      else if (!tv && up.includes(season.driver))
        news += `<br><b>You've earned a seeded place for the next round!</b>`
    }
    this.show('hub', season, news)
  }

  seasonWeekend(i) {
    const season = this.season
    return {
      single: false,
      season,
      round: i,
      tv: season.kind === 'tv',
      track: Track.fromJSON(season.calendar[i].data),
      laps: season.laps,
      driver: season.driver,
      difficulty: season.difficulty,
      assists: season.assists,
      qualifying: season.qualifying,
      prequal: season.pending?.round === i ? season.pending.prequal : null,
      seeded: seededFor(season, i),
      onAssistsChange: (a) => {
        season.assists = { brake: a.brake, line: a.line }
        saveSeason(season)
      },
    }
  }

  roundWeekend() {
    const i = nextRound(this.season)
    if (i >= 0) this.show('weekend', this.seasonWeekend(i))
  }

  seeds(w) {
    return w.seeded ?? originalSeeds()
  }

  seededSeats(w) {
    const seeded = this.seeds(w)
    return DRIVERS.flatMap((d, i) => (seeded.has(d.code) ? [i] : []))
  }

  prequalSeats(w) {
    const seeded = this.seeds(w)
    return DRIVERS.flatMap((d, i) => (seeded.has(d.code) ? [] : [i]))
  }

  mainSeats(w) {
    const seeded = this.seeds(w)
    const through = new Set(w.prequal?.through ?? [])
    return DRIVERS.flatMap((d, i) =>
      seeded.has(d.code) || through.has(d.code) ? [i] : [],
    )
  }

  inPrequal(w) {
    return !this.seeds(w).has(w.driver)
  }

  inMain(w) {
    return (
      this.seeds(w).has(w.driver) ||
      (w.prequal?.through ?? []).includes(w.driver)
    )
  }

  setPrequal(w, pq) {
    w.prequal = pq
    if (w.season) {
      w.season.pending = { round: w.round, prequal: pq }
      saveSeason(w.season)
    }
  }

  prequalRecord(results, simulated) {
    return {
      results,
      simulated,
      through: results
        .filter((r) => r.pos <= PREQUAL_PLACES && !r.dsq)
        .map((r) => r.code),
    }
  }

  async simPrequal(w) {
    const results = await simulateRound({
      track: w.track,
      laps: w.laps,
      qualifying: true,
      difficulty: w.difficulty,
      seats: this.prequalSeats(w),
      points: [],
    })
    return this.prequalRecord(results, true)
  }

  simMain(w) {
    return simulateRound({
      track: w.track,
      laps: w.laps,
      qualifying: true,
      difficulty: w.difficulty,
      seats: this.mainSeats(w),
    })
  }

  finishMain(w, results, simulated) {
    if (w.season) {
      w.season.rounds[w.round] = {
        ...roundFromRecord(results, simulated),
        prequal: w.prequal,
      }
      delete w.season.pending
      saveSeason(w.season)
      this.lastRound = w.round
    } else w.main = { results, simulated }
  }

  weekend(w) {
    useField('champions')
    this.weekendState = w
    if (w.season) this.season = w.season
    const n = w.season?.calendar.length
    const me = DRIVERS[driverIndexOf(w.driver)]
    const myPq = this.inPrequal(w)
    const pq = w.prequal
    const through = new Set(pq?.through ?? [])
    const label = w.single
      ? w.tv
        ? 'Watch a Race'
        : 'Single Race'
      : `Round ${w.round + 1} of ${n}`
    const who = w.tv
      ? `Following ${esc(me.name)}`
      : `You: ${esc(me.name)} · ${esc(TEAMS[me.team].name)}`

    const nameCell = (d) =>
      `${teamDot(d.team)}${d.number ? `<small class='gp-m-num'>${d.number}</small>` : ''}${esc(d.name)}`
    const pqList = pq
      ? `<table><thead><tr><th>Pos</th><th>Driver</th><th>Time</th><th></th></tr></thead><tbody>${pq.results
          .map(
            (
              r,
            ) => `<tr class='${r.code === w.driver ? 'is-me' : ''}${through.has(r.code) ? ' is-through' : ''}'>
              <td class='p'>${r.dsq ? 'DSQ' : r.pos}</td>
              <td>${nameCell(DRIVERS[driverIndexOf(r.code)])}</td>
              <td class='n'>${r.gap}</td>
              <td class='n'>${through.has(r.code) ? "<b class='gp-m-through'>THROUGH</b>" : "<span class='gp-m-dnpq'>DNPQ</span>"}</td>
            </tr>`,
          )
          .join('')}</tbody></table>
         ${pq.simulated ? "<p class='gp-m-note'><em class='gp-m-sim'>simulated</em></p>" : ''}`
      : `<ul class='gp-m-entrants'>${this.prequalSeats(w)
          .map((i) => DRIVERS[i])
          .map(
            (d) =>
              `<li class='${d.code === w.driver ? 'is-me' : ''}'>${nameCell(d)}</li>`,
          )
          .join('')}</ul>`

    let pqButtons = ''
    if (!pq) {
      const live = w.tv || !myPq ? 'Watch prequalifying' : 'Race prequalifying'
      pqButtons = `<button class='gp-m-go' data-act='pq-live'>${live} ›</button><button data-act='pq-sim'>Simulate prequalifying</button>`
    }

    const seeded = this.seeds(w)
    const mainList = `<ul class='gp-m-entrants'>${(pq
      ? this.mainSeats(w)
      : this.seededSeats(w)
    )
      .map((i) => DRIVERS[i])
      .map(
        (d) =>
          `<li class='${d.code === w.driver ? 'is-me' : ''}'>${nameCell(d)}${seeded.has(d.code) ? '' : " <em class='gp-m-pqtag'>PQ</em>"}</li>`,
      )
      .join(
        '',
      )}${pq ? '' : `<li class='gp-m-empty'>+ ${PREQUAL_PLACES} from prequalifying</li>`}</ul>`

    let mainButtons = ''
    let mainNote = ''
    if (w.main) {
      mainButtons = `<button class='gp-m-go' data-act='main-result'>See the result ›</button><button data-act='back'>Back to the menu</button>`
    } else if (!pq) {
      mainNote = 'Prequalifying first.'
      mainButtons = `<button class='gp-m-go' disabled>${w.tv ? 'Watch' : 'Race'} ›</button>`
    } else if (!w.tv && this.inMain(w)) {
      mainNote = myPq ? 'You made it through!' : ''
      mainButtons = `<button class='gp-m-go' data-act='main-live'>Race ›</button>${w.single ? '' : "<button data-act='main-sim'>Simulate the race</button>"}`
    } else {
      mainNote = w.tv
        ? ''
        : `You didn't prequalify. Watch the race or simulate it?`
      mainButtons = `<button class='gp-m-go' data-act='main-live'>Watch the race ›</button><button data-act='main-sim'>Simulate the race</button>`
    }

    this.render(`
      <div class='gp-m-page'>
        <header class='gp-m-head'>
          <button class='gp-m-back' data-act='back'>‹ ${w.single ? 'Menu' : 'Standings'}</button>
          <h2>${esc(w.track.name)} <span>Champions · ${label} · ${who}</span></h2>
          ${this.musicButton()}
        </header>
        <div class='gp-m-weekend'>
          <section class='gp-m-panel gp-m-table'>
            <h4>Prequalifying <span>20 drivers · ${PREQUAL_PLACES} places · no points</span></h4>
            ${pqList}
            <div class='gp-m-row gp-m-btns'>${pqButtons}</div>
          </section>
          <section class='gp-m-panel'>
            <h4>The race <span>${w.laps} laps · one-shot qualifying · points 10-6-4-3-2-1</span></h4>
            ${mainNote ? `<p class='gp-m-news'>${mainNote}</p>` : ''}
            ${mainList}
            <div class='gp-m-row gp-m-btns'>${mainButtons}</div>
          </section>
        </div>
        <div class='gp-m-modal' data-modal hidden></div>
        <div class='gp-m-busy' data-busy hidden><span></span></div>
      </div>`)

    const back = () =>
      w.single
        ? this.show('title', w.tv ? 'tv' : 'race')
        : this.show('hub', w.season)
    this.el.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act
      if (
        e.target.closest('[data-modal]') &&
        (act === 'close' || e.target.matches('[data-modal]'))
      )
        return this.closeModal()
      if (act === 'back') back()
      else if (act === 'pq-live') this.runSession(w, 'prequal')
      else if (act === 'pq-sim')
        this.busyThen(`Simulating prequalifying…`, async () =>
          this.setPrequal(w, await this.simPrequal(w)),
        )
      else if (act === 'main-live') this.runSession(w, 'main')
      else if (act === 'main-sim')
        this.busyThen(`Simulating the race…`, async () => {
          this.finishMain(w, await this.simMain(w), true)
          if (!w.single) return 'done'
        })
      else if (act === 'main-result')
        this.showResults(
          `${w.track.name}: race result`,
          w.main.results,
          w.main.simulated,
        )
    }
    this.keyHandler = (e) => {
      if (e.code !== 'Escape') return
      if (!this.el.querySelector('[data-modal]').hidden)
        return this.closeModal()
      back()
    }
    if (w.main && !w.shown) {
      w.shown = true
      this.showResults(
        `${w.track.name}: race result`,
        w.main.results,
        w.main.simulated,
      )
    }
  }

  async busyThen(text, fn) {
    const busy = this.el.querySelector('[data-busy]')
    busy.querySelector('span').textContent = text
    busy.hidden = false
    let next
    try {
      next = await fn()
    } catch (err) {
      console.error(err)
      busy.hidden = true
      return
    }
    if (next === 'done') return this.afterRound()
    this.show('weekend', this.weekendState)
  }

  runSession(w, which) {
    const prequal = which === 'prequal'
    const seats = prequal ? this.prequalSeats(w) : this.mainSeats(w)
    const mine = prequal ? this.inPrequal(w) : this.inMain(w)
    const drive = !w.tv && mine
    let follow = driverIndexOf(w.driver)
    if (!seats.includes(follow)) {
      const winner = w.prequal?.results[0]?.code
      follow = !prequal && winner ? driverIndexOf(winner) : seats[0]
    }
    const n = w.season?.calendar.length
    const label = prequal
      ? 'Prequalifying'
      : w.single
        ? 'Champions race'
        : `Round ${w.round + 1} of ${n}`
    this.app.startRace({
      track: w.track,
      laps: w.laps,
      driverIndex: follow,
      mode: drive ? 'race' : 'tv',
      difficulty: w.difficulty,
      assists: w.assists,
      qualifying: drive && w.qualifying,
      seats,
      prequal,
      field: 'champions',
      round: { label, allowRestart: w.single },
      onAssistsChange: w.onAssistsChange,
      onResult: (results) => {
        const record = recordFromRace(results)
        if (prequal) this.setPrequal(w, this.prequalRecord(record, false))
        else this.finishMain(w, record, false)
      },
      onExit: () => {
        if (!prequal && w.season && w.season.rounds[w.round])
          return this.afterRound()
        if (!prequal && w.single && w.main)
          return this.show('title', w.tv ? 'tv' : 'race')
        this.show('weekend', w)
      },
    })
  }

  showResults(title, results, simulated) {
    const rows = results
      .map(
        (r) => `
        <tr class='${r.code === this.weekendState?.driver ? 'is-me' : ''}'>
          <td class='p'>${r.dsq ? 'DSQ' : r.pos}</td>
          <td>${teamDot(r.team)}${esc(r.name)}</td>
          <td class='t'>${esc(TEAMS[r.team]?.name ?? '')}</td>
          <td class='n'>${r.gap}</td>
          <td class='n'>${r.penalty ? `+${r.penalty}s` : ''}</td>
          <td class='n'>${formatTime(r.best)}</td>
          <td class='n'>${r.grid}</td>
          <td class='n pts'>${r.points || ''}</td>
        </tr>`,
      )
      .join('')
    const m = this.el.querySelector('[data-modal]')
    m.innerHTML = `
      <div class='gp-m-modal-card'>
        <h3>${esc(title)} ${simulated ? "<em class='gp-m-sim'>simulated</em>" : ''}</h3>
        <table>
          <thead><tr><th>Pos</th><th>Driver</th><th>Nation</th><th>Time</th><th>Pen</th><th>Best lap</th><th>Grid</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <button data-act='close'>Close</button>
      </div>`
    m.hidden = false
  }

  finale(season) {
    useField(season.field ?? 'grid')
    this.season = season
    const champs = season.field === 'champions'
    const tv = season.kind === 'tv'
    const drivers = driverStandings(season)
    const teams = constructorStandings(season)
    const [p1, p2, p3] = drivers
    const me = drivers.findIndex((d) => d.code === season.driver)
    const champTeam = teams[0]
    const step = (d, place) =>
      d
        ? `<div class='gp-m-step gp-m-step--${place}' style='--team:${TEAMS[d.team]?.colour ?? '#888'}'>
             <b>${esc(d.name)}</b>
             <span>${esc(TEAMS[d.team]?.name ?? '')}</span>
             <div class='gp-m-block'><em>${place}</em><small>${d.points} pts</small></div>
           </div>`
        : ''
    let line
    if (tv)
      line = `${esc(drivers[me].name)} finished P${me + 1} with ${drivers[me].points} points.`
    else if (me === 0)
      line = champs
        ? 'You are the Champion of Champions!'
        : 'You are the World Champion!'
    else
      line = `You finished the season P${me + 1} with ${drivers[me].points} point${drivers[me].points === 1 ? '' : 's'}${drivers[me].wins ? ` and ${drivers[me].wins} win${drivers[me].wins > 1 ? 's' : ''}` : ''}.`
    this.render(`
      <div class='gp-m-finale' style='--team:${TEAMS[p1.team]?.colour ?? '#e10600'}'>
        <div class='gp-m-confetti'>${Array.from({ length: 40 }, (_, i) => `<i style='--i:${i}--x:${Math.random() * 100}%--d:${(3 + Math.random() * 4).toFixed(2)}s--c:${[TEAMS[p1.team]?.colour, '#ffd600', '#ffffff', TEAMS[p1.team]?.accent][i % 4]}'></i>`).join('')}</div>
        <span class='gp-m-kicker'>${season.calendar.length}-round season · ${champs ? 'Champions ' : ''}${tv ? 'TV Championship' : 'Championship'}</span>
        <h1>${esc(p1.name)}</h1>
        <p class='gp-m-crown'>${champs ? 'Champion of Champions' : 'World Champion'} · ${esc(TEAMS[p1.team]?.name ?? '')} · ${p1.points} points · ${p1.wins} win${p1.wins === 1 ? '' : 's'}</p>
        <div class='gp-m-podium'>${step(p2, 2)}${step(p1, 1)}${step(p3, 3)}</div>
        <p class='gp-m-constructors'>${champs ? `<i class='gp-m-dot' style='background:${champTeam.colour}'></i>` : teamDot(champTeam.id)}<b>${esc(champTeam.name)}</b> ${champs ? `win the World Cup with ${champTeam.average.toFixed(2)} points per driver (${champTeam.points} in all)` : `are Constructors' Champions with ${champTeam.points} points`}</p>
        <p class='gp-m-yours${!tv && me === 0 ? ' is-champ' : ''}'>${line}</p>
        <div class='gp-m-row gp-m-finale-btns'>
          <button data-act='tables'>Final standings</button>
          <button class='gp-m-go' data-act='menu'>Main menu ›</button>
        </div>
      </div>`)
    this.el.onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act
      if (act === 'tables') this.show('hub', season)
      else if (act === 'menu') this.show('title', tv ? 'tv' : 'season')
    }
    this.keyHandler = (e) => {
      if (e.code === 'Escape' || e.code === 'Enter')
        this.show('title', tv ? 'tv' : 'season')
    }
  }
}
