import { PIECES, PIECE_ORDER, footprint } from '../track/pieces.js'
import {
  Track,
  MIN_COLS,
  MAX_COLS,
  MIN_ROWS,
  MAX_ROWS,
  MAX_LAPS,
} from '../track/track.js'
import { analyseTrack } from '../track/analyse.js'
import { drawGrass, drawPieces, drawCar, COLOURS } from '../track/render.js'
import { DRIVERS, TEAMS } from '../data/grid.js'
import * as store from '../track/storage.js'
import { DIFFICULTY } from '../race/ai.js'
import { BRAKE_ASSIST } from '../race/assists.js'

const ZOOMS = [12, 16, 20, 24, 32, 40, 48, 64]
const DEFAULT_ZOOM = 4
const PAN_MARGIN = 160
const UNDO_LIMIT = 100
const DRIVER_KEY = 'grand-prix.testDriver'
const DIFFICULTY_KEY = 'grand-prix.difficulty'
const ASSISTS_KEY = 'grand-prix.assists'

function loadAssists() {
  try {
    const a = JSON.parse(localStorage.getItem(ASSISTS_KEY) || '{}')
    return { brake: BRAKE_ASSIST[a.brake] ? a.brake : 'off', line: !!a.line }
  } catch {
    return { brake: 'off', line: false }
  }
}

function loadDifficulty() {
  try {
    const d = localStorage.getItem(DIFFICULTY_KEY)
    return DIFFICULTY[d] ? d : 'normal'
  } catch {
    return 'normal'
  }
}

function loadDriverIndex() {
  try {
    const i = Number(localStorage.getItem(DRIVER_KEY))
    return Number.isInteger(i) && i >= 0 && i < DRIVERS.length ? i : 0
  } catch {
    return 0
  }
}

const esc = (s) =>
  String(s).replace(
    /[&<>'']/g,
    (c) =>
      ({ '&': '&amp', '<': '&lt', '>': '&gt', '"': '&quot', "'": '&#39' })[
        c
      ],
  )

export class Editor {
  constructor(root) {
    this.root = root
    this.active = true
    this.onTestDrive = null
    this.driverIndex = loadDriverIndex()
    this.difficulty = loadDifficulty()
    this.assists = loadAssists()
    this.track = store.loadDraft() ?? store.exampleTrack()
    this.tool = 'straight'
    this.rot = 0
    this.mirror = false
    this.zoom = DEFAULT_ZOOM
    this.cam = { x: 0, y: 0 }
    this.hover = null
    this.overlays = { grid: true, line: true, checkpoints: false, cars: true }
    this.undoStack = []
    this.redoStack = []
    this.stroke = null
    this.pan = null
    this.spaceHeld = false
    this.trackCanvas = document.createElement('canvas')
    this.trackCanvasKey = ''

    this.buildDom()
    this.buildPalette()
    this.bindEvents()
    this.trackChanged({ autosave: false })
    this.syncInputs()
    this.resize()
    this.fit()
    this.frame = this.frame.bind(this)
    requestAnimationFrame(this.frame)
  }

  get T() {
    return ZOOMS[this.zoom]
  }

  buildDom() {
    this.root.innerHTML = `
      <div class='gp-editor'>
        <header class='gp-bar'>
          <div class='gp-brand'>
            <span class='gp-logo'>GRAND PRIX</span>
            <span class='gp-sub'>Track Editor</span>
          </div>
          <div class='gp-fields'>
            <label class='gp-field gp-field--name'>Circuit
              <input id='gp-name' maxlength='40' spellcheck='false' />
            </label>
            <label class='gp-field gp-field--num'>Laps
              <input id='gp-laps' type='number' min='1' max='${MAX_LAPS}' />
            </label>
            <label class='gp-field gp-field--map'>Map
              <input id='gp-cols' type='number' min='${MIN_COLS}' max='${MAX_COLS}' />
              <span>×</span>
              <input id='gp-rows' type='number' min='${MIN_ROWS}' max='${MAX_ROWS}' />
            </label>
          </div>
          <div class='gp-actions'>
            <button data-action='undo' title='Undo (Ctrl+Z)'>Undo</button>
            <button data-action='redo' title='Redo (Ctrl+Y)'>Redo</button>
            <span class='gp-sep'></span>
            <button data-action='new'>New</button>
            <button data-action='load'>Load</button>
            <button data-action='save' class='gp-primary' title='Save (Ctrl+S)'>Save</button>
            <span class='gp-sep'></span>
            <button data-action='import'>Import</button>
            <button data-action='export'>Export</button>
          </div>
        </header>

        <div class='gp-main'>
          <aside class='gp-side'>
            <section>
              <h3>Pieces</h3>
              <div class='gp-palette' id='gp-palette'></div>
              <div class='gp-orient'>
                <button data-action='rotate' title='Rotate (R)'>⟳ Rotate</button>
                <button data-action='flip' id='gp-flip' title='Flip (F)'>⇋ Flip</button>
                <span id='gp-orient-label'></span>
              </div>
            </section>

            <section>
              <h3>Circuit check</h3>
              <div id='gp-status' class='gp-status'></div>
            </section>

            <section>
              <h3>View</h3>
              <div class='gp-toggles'>
                <label><input type='checkbox' data-overlay='grid' /> Grid lines <kbd>G</kbd></label>
                <label><input type='checkbox' data-overlay='line' /> Racing line <kbd>L</kbd></label>
                <label><input type='checkbox' data-overlay='checkpoints' /> Checkpoints <kbd>C</kbd></label>
                <label><input type='checkbox' data-overlay='cars' /> Cars on the grid <kbd>V</kbd></label>
              </div>
              <div class='gp-zoom'>
                <button data-action='zoom-out' title='Zoom out (−)'>−</button>
                <span id='gp-zoom-label'></span>
                <button data-action='zoom-in' title='Zoom in (+)'>+</button>
                <button data-action='fit' title='Fit map (0)'>Fit</button>
              </div>
            </section>

            <section class='gp-help'>
              <h3>Controls</h3>
              <p><b>Left drag</b> paint · <b>Right drag</b> erase</p>
              <p><b>Middle drag</b> or <b>Space + drag</b> pan · <b>Wheel</b> zoom</p>
              <p><kbd>1</kbd>–<kbd>7</kbd> pieces · <kbd>E</kbd> eraser · <kbd>R</kbd> rotate · <kbd>F</kbd> flip · <kbd>T</kbd> race · <kbd>⇧T</kbd> practice · <kbd>W</kbd> watch</p>
              <p>The start straight sets the racing direction: cars race towards the chequered line.</p>
            </section>

            <section class='gp-testdrive'>
              <h3>Drive</h3>
              <select id='gp-driver' title='Whose seat you take, or who TV mode follows'>
                ${DRIVERS.map((d, i) => `<option value='${i}'>${esc(d.name)} (${esc(TEAMS[d.team].name)})</option>`).join('')}
              </select>
              <select id='gp-difficulty' title='How quick the other 21 drivers are'>
                ${Object.entries(DIFFICULTY)
                  .map(
                    ([k, d]) => `<option value='${k}'>AI: ${d.label}</option>`,
                  )
                  .join('')}
              </select>
              <select id='gp-brake-assist' title='Adds braking for you when you're too fast for a corner'>
                ${Object.entries(BRAKE_ASSIST)
                  .map(
                    ([k, a]) =>
                      `<option value='${k}'>Brake assist: ${a.label}</option>`,
                  )
                  .join('')}
              </select>
              <label class='gp-check' title='Racing line in green (flat out), amber (lift) and red (brake)'>
                <input type='checkbox' id='gp-line' /> Braking line
              </label>
              <button class='gp-test' data-action='race' id='gp-test' disabled>🏁 Race the field <kbd>T</kbd></button>
              <button class='gp-test gp-test--alt' data-action='practice' id='gp-practice' disabled>Solo practice <kbd>⇧T</kbd></button>
              <button class='gp-test gp-test--alt' data-action='tv' id='gp-tv' disabled>📺 TV mode: watch <kbd>W</kbd></button>
            </section>
          </aside>

          <div class='gp-stage' id='gp-stage'>
            <canvas id='gp-view'></canvas>
            <div class='gp-hud' id='gp-hud'></div>
          </div>
        </div>

        <dialog class='gp-dialog' id='gp-load'>
          <h2>Load circuit</h2>
          <ul id='gp-load-list'></ul>
          <form method='dialog'><button>Close</button></form>
        </dialog>

        <input type='file' id='gp-import' accept='.json,application/json' hidden />
        <div class='gp-toast' id='gp-toast'></div>
      </div>`

    const $ = (sel) => this.root.querySelector(sel)
    this.el = {
      name: $('#gp-name'),
      laps: $('#gp-laps'),
      cols: $('#gp-cols'),
      rows: $('#gp-rows'),
      palette: $('#gp-palette'),
      flip: $('#gp-flip'),
      orientLabel: $('#gp-orient-label'),
      status: $('#gp-status'),
      zoomLabel: $('#gp-zoom-label'),
      stage: $('#gp-stage'),
      canvas: $('#gp-view'),
      hud: $('#gp-hud'),
      loadDialog: $('#gp-load'),
      loadList: $('#gp-load-list'),
      importInput: $('#gp-import'),
      toast: $('#gp-toast'),
      driver: $('#gp-driver'),
      difficulty: $('#gp-difficulty'),
      test: $('#gp-test'),
      practice: $('#gp-practice'),
      tv: $('#gp-tv'),
      brakeAssist: $('#gp-brake-assist'),
      line: $('#gp-line'),
    }
    this.el.driver.value = String(this.driverIndex)
    this.el.difficulty.value = this.difficulty
    this.el.brakeAssist.value = this.assists.brake
    this.el.line.checked = this.assists.line
    this.ctx = this.el.canvas.getContext('2d')
  }

  buildPalette() {
    const items = [...PIECE_ORDER, 'erase']
    this.el.palette.innerHTML = ''
    for (const type of items) {
      const btn = document.createElement('button')
      btn.className = 'gp-piece'
      btn.dataset.tool = type
      if (type === 'start') btn.classList.add('gp-piece--wide')
      const canvas = document.createElement('canvas')
      const label = document.createElement('span')
      if (type === 'erase') {
        canvas.width = canvas.height = 96
        const c = canvas.getContext('2d')
        c.fillStyle = '#3a1416'
        c.fillRect(0, 0, 96, 96)
        c.strokeStyle = '#ff5a5f'
        c.lineWidth = 8
        c.beginPath()
        c.moveTo(28, 28)
        c.lineTo(68, 68)
        c.moveTo(68, 28)
        c.lineTo(28, 68)
        c.stroke()
        label.innerHTML = `Eraser <kbd>E</kbd>`
      } else {
        const def = PIECES[type]
        const wide = type === 'start'
        canvas.width = wide ? 220 : 96
        canvas.height = 96
        const T = Math.min(canvas.width / def.w, canvas.height / def.h) * 0.92
        const c = canvas.getContext('2d')
        c.fillStyle = COLOURS.grassA
        c.fillRect(0, 0, canvas.width, canvas.height)
        c.save()
        c.translate(
          (canvas.width - def.w * T) / 2,
          (canvas.height - def.h * T) / 2,
        )
        drawPieces(c, [{ type, x: 0, y: 0, rot: 0, mirror: false }], T)
        c.restore()
        label.innerHTML = `${def.label} <kbd>${def.key}</kbd>`
      }
      btn.append(canvas, label)
      btn.addEventListener('click', () => this.selectTool(type))
      this.el.palette.appendChild(btn)
    }
    this.selectTool(this.tool)
  }

  selectTool(tool) {
    this.tool = tool
    for (const b of this.el.palette.querySelectorAll('.gp-piece')) {
      b.classList.toggle('is-active', b.dataset.tool === tool)
    }
    const flippable = PIECES[tool]?.flippable
    this.el.flip.disabled = !flippable
    if (!flippable) this.mirror = false
    this.updateOrientLabel()
  }

  updateOrientLabel() {
    this.el.orientLabel.textContent =
      this.tool === 'erase'
        ? ''
        : `${this.rot * 90}°${this.mirror ? ' · flipped' : ''}`
  }

  syncInputs() {
    this.el.name.value = this.track.name
    this.el.laps.value = this.track.laps
    this.el.cols.value = this.track.cols
    this.el.rows.value = this.track.rows
    for (const box of this.root.querySelectorAll('[data-overlay]')) {
      box.checked = this.overlays[box.dataset.overlay]
    }
    this.el.zoomLabel.textContent = `${this.T}px`
  }

  bindEvents() {
    const { canvas, name, laps, cols, rows, importInput } = this.el

    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]')
      if (btn && !btn.disabled) this.action(btn.dataset.action)
    })

    for (const box of this.root.querySelectorAll('[data-overlay]')) {
      box.addEventListener('change', () => {
        this.overlays[box.dataset.overlay] = box.checked
      })
    }

    this.el.driver.addEventListener('change', () => {
      this.driverIndex = Number(this.el.driver.value)
      try {
        localStorage.setItem(DRIVER_KEY, String(this.driverIndex))
      } catch {}
      this.el.driver.blur()
    })
    this.el.brakeAssist.addEventListener('change', () => {
      this.setAssists({ ...this.assists, brake: this.el.brakeAssist.value })
      this.el.brakeAssist.blur()
    })
    this.el.line.addEventListener('change', () => {
      this.setAssists({ ...this.assists, line: this.el.line.checked })
      this.el.line.blur()
    })
    this.el.difficulty.addEventListener('change', () => {
      this.difficulty = this.el.difficulty.value
      try {
        localStorage.setItem(DIFFICULTY_KEY, this.difficulty)
      } catch {}
      this.el.difficulty.blur()
    })

    name.addEventListener('input', () => {
      this.track.name = name.value.trim() || 'Untitled Circuit'
      store.saveDraft(this.track)
    })
    laps.addEventListener('change', () => {
      const n = Math.max(1, Math.min(MAX_LAPS, Math.round(+laps.value) || 8))
      this.track.laps = n
      laps.value = n
      this.trackChanged({ redraw: false })
    })
    const onSize = () => {
      const before = this.snapshot()
      if (this.track.resize(+cols.value, +rows.value)) {
        this.commit(before)
        this.trackChanged()
        this.clampCam()
      } else {
        this.toast(
          'Some pieces sit outside that size. Move them first.',
          'error',
        )
      }
      cols.value = this.track.cols
      rows.value = this.track.rows
    }
    cols.addEventListener('change', onSize)
    rows.addEventListener('change', onSize)

    importInput.addEventListener('change', async () => {
      const file = importInput.files?.[0]
      importInput.value = ''
      if (!file) return
      try {
        const track = await store.importTrackFile(file)
        this.replaceTrack(track)
        const skipped = track.skipped
          ? ` (${track.skipped} invalid piece${track.skipped === 1 ? '' : 's'} skipped)`
          : ''
        this.toast(`Imported “${track.name}”${skipped}`)
      } catch (err) {
        this.toast(err.message, 'error')
      }
    })

    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    canvas.addEventListener('mousedown', (e) => this.onMouseDown(e))
    window.addEventListener('mousemove', (e) => this.onMouseMove(e))
    window.addEventListener('mouseup', (e) => this.onMouseUp(e))
    canvas.addEventListener('mouseleave', () => {
      if (!this.stroke) this.setHover(null)
    })
    canvas.addEventListener('wheel', (e) => this.onWheel(e), {
      passive: false,
    })

    window.addEventListener('keydown', (e) => this.onKeyDown(e))
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false
        this.updateCursor()
      }
    })
    window.addEventListener('resize', () => this.resize())
    new ResizeObserver(() => this.resize()).observe(this.el.stage)
  }

  action(name) {
    switch (name) {
      case 'undo':
        return this.undo()
      case 'redo':
        return this.redo()
      case 'new':
        return this.newTrack()
      case 'load':
        return this.openLoadDialog()
      case 'save':
        return this.save()
      case 'import':
        return this.el.importInput.click()
      case 'export':
        return store.exportTrack(this.track)
      case 'rotate':
        return this.rotate(1)
      case 'flip':
        return this.flip()
      case 'zoom-in':
        return this.zoomAt(this.zoom + 1)
      case 'zoom-out':
        return this.zoomAt(this.zoom - 1)
      case 'fit':
        return this.fit()
      case 'race':
        return this.startTestDrive('race')
      case 'practice':
        return this.startTestDrive('practice')
      case 'tv':
        return this.startTestDrive('tv')
    }
  }

  onKeyDown(e) {
    if (!this.active) return
    const typing = e.target.closest?.('input, textarea, select')
    const ctrl = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()

    if (ctrl && k === 's') {
      e.preventDefault()
      return this.save()
    }
    if (typing || this.el.loadDialog.open) return

    if (ctrl && k === 'z') {
      e.preventDefault()
      return e.shiftKey ? this.redo() : this.undo()
    }
    if (ctrl && k === 'y') {
      e.preventDefault()
      return this.redo()
    }
    if (ctrl) return

    if (e.code === 'Space') {
      e.preventDefault()
      this.spaceHeld = true
      return this.updateCursor()
    }

    const piece = PIECE_ORDER.find((t) => PIECES[t].key === e.key)
    if (piece) return this.selectTool(piece)

    const step = this.T * 3
    switch (e.key) {
      case 'ArrowLeft':
        this.cam.x -= step
        break
      case 'ArrowRight':
        this.cam.x += step
        break
      case 'ArrowUp':
        this.cam.y -= step
        break
      case 'ArrowDown':
        this.cam.y += step
        break
      case '+':
      case '=':
        this.zoomAt(this.zoom + 1)
        break
      case '-':
      case '_':
        this.zoomAt(this.zoom - 1)
        break
      case '0':
        this.fit()
        break
      default:
        switch (k) {
          case 'e':
          case 'x':
            this.selectTool('erase')
            break
          case 'r':
            this.rotate(e.shiftKey ? -1 : 1)
            break
          case 'f':
            this.flip()
            break
          case 'g':
            this.toggleOverlay('grid')
            break
          case 'l':
            this.toggleOverlay('line')
            break
          case 'c':
            this.toggleOverlay('checkpoints')
            break
          case 'v':
            this.toggleOverlay('cars')
            break
          case 't':
            this.startTestDrive(e.shiftKey ? 'practice' : 'race')
            break
          case 'w':
            this.startTestDrive('tv')
            break
          default:
            return
        }
    }
    e.preventDefault()
    this.clampCam()
  }

  toggleOverlay(name) {
    this.overlays[name] = !this.overlays[name]
    this.syncInputs()
  }

  rotate(dir) {
    this.rot = (this.rot + dir + 4) % 4
    this.updateOrientLabel()
  }

  flip() {
    if (!PIECES[this.tool]?.flippable) return
    this.mirror = !this.mirror
    this.updateOrientLabel()
  }

  mouseToCell(e) {
    const r = this.el.canvas.getBoundingClientRect()
    const mx = e.clientX - r.left + this.cam.x
    const my = e.clientY - r.top + this.cam.y
    return { cx: Math.floor(mx / this.T), cy: Math.floor(my / this.T) }
  }

  setHover(cell) {
    const same =
      cell &&
      this.hover &&
      cell.cx === this.hover.cx &&
      cell.cy === this.hover.cy
    if (same || (!cell && !this.hover)) return
    this.hover = cell
    this.updateHud()
  }

  onMouseDown(e) {
    if (e.button === 1 || (e.button === 0 && this.spaceHeld)) {
      e.preventDefault()
      this.pan = { x: e.clientX, y: e.clientY }
      this.updateCursor()
      return
    }
    if (e.button !== 0 && e.button !== 2) return
    e.preventDefault()
    const mode = e.button === 2 || this.tool === 'erase' ? 'erase' : 'paint'
    this.stroke = {
      mode,
      snapshot: this.snapshot(),
      changed: false,
      lastCell: null,
    }
    const cell = this.mouseToCell(e)
    this.setHover(cell)
    this.applyStroke(cell)
  }

  onMouseMove(e) {
    if (!this.active) return
    if (this.pan) {
      this.cam.x -= e.clientX - this.pan.x
      this.cam.y -= e.clientY - this.pan.y
      this.pan = { x: e.clientX, y: e.clientY }
      this.clampCam()
      return
    }
    if (e.target !== this.el.canvas && !this.stroke) return
    const cell = this.mouseToCell(e)
    this.setHover(cell)
    if (this.stroke) this.applyStroke(cell)
  }

  onMouseUp() {
    if (this.pan) {
      this.pan = null
      this.updateCursor()
    }
    if (this.stroke) {
      if (this.stroke.changed) this.commit(this.stroke.snapshot)
      this.stroke = null
    }
  }

  onWheel(e) {
    e.preventDefault()
    const r = this.el.canvas.getBoundingClientRect()
    this.zoomAt(
      this.zoom + (e.deltaY < 0 ? 1 : -1),
      e.clientX - r.left,
      e.clientY - r.top,
    )
  }

  updateCursor() {
    this.el.canvas.style.cursor = this.pan
      ? 'grabbing'
      : this.spaceHeld
        ? 'grab'
        : 'crosshair'
  }

  ghostAt(cx, cy) {
    const { w, h } = footprint(this.tool, this.rot)
    return {
      type: this.tool,
      x: cx - Math.floor(w / 2),
      y: cy - Math.floor(h / 2),
      rot: this.rot,
      mirror: this.mirror,
    }
  }

  applyStroke(cell) {
    const s = this.stroke
    if (s.lastCell && s.lastCell.cx === cell.cx && s.lastCell.cy === cell.cy)
      return
    s.lastCell = cell
    let changed = false
    if (s.mode === 'erase') {
      const piece = this.track.pieceAt(cell.cx, cell.cy)
      if (piece) changed = this.track.remove(piece.id)
    } else {
      const g = this.ghostAt(cell.cx, cell.cy)
      changed = !!this.track.place(g.type, g.x, g.y, g.rot, g.mirror)
    }
    if (changed) {
      s.changed = true
      this.trackChanged()
    }
  }

  trackChanged({ redraw = true, autosave = true } = {}) {
    this.analysis = analyseTrack(this.track)
    if (redraw) this.trackCanvasKey = ''
    if (autosave) store.saveDraft(this.track)
    this.renderStatus()
    this.updateHud()
  }

  snapshot() {
    const { cols, rows, pieces } = this.track.toJSON()
    return JSON.stringify({ cols, rows, pieces })
  }

  restore(snap) {
    const data = JSON.parse(snap)
    this.track = Track.fromJSON({
      ...data,
      name: this.track.name,
      laps: this.track.laps,
    })
    this.syncInputs()
    this.trackChanged()
    this.clampCam()
  }

  commit(before) {
    this.undoStack.push(before)
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack = []
  }

  undo() {
    if (!this.undoStack.length) return this.toast('Nothing to undo')
    this.redoStack.push(this.snapshot())
    this.restore(this.undoStack.pop())
  }

  redo() {
    if (!this.redoStack.length) return this.toast('Nothing to redo')
    this.undoStack.push(this.snapshot())
    this.restore(this.redoStack.pop())
  }

  replaceTrack(track) {
    this.undoStack = []
    this.redoStack = []
    this.track = track
    this.syncInputs()
    this.trackChanged()
    this.fit()
  }

  newTrack() {
    if (
      this.track.pieces.length &&
      !confirm('Start a new circuit? Unsaved changes to this one will be lost.')
    )
      return
    this.replaceTrack(
      new Track({ cols: this.track.cols, rows: this.track.rows }),
    )
    this.el.name.focus()
    this.el.name.select()
  }

  save() {
    const name = this.track.name.trim()
    if (!name || name === 'Untitled Circuit') {
      this.toast('Give your circuit a name first.', 'error')
      this.el.name.focus()
      return
    }
    if (
      store.trackExists(name) &&
      this.lastSavedName !== name &&
      !confirm(`Replace the saved circuit “${name}”?`)
    )
      return
    const valid = this.analysis.ok
    if (!store.saveTrack(this.track, valid))
      return this.toast(
        'Couldn’t save: browser storage is full or blocked.',
        'error',
      )
    this.lastSavedName = name
    this.toast(
      valid
        ? `Saved “${name}”, ready for the calendar.`
        : `Saved “${name}” as a draft. It needs fixing before it can race.`,
    )
  }

  setAssists(assists) {
    this.assists = {
      brake: BRAKE_ASSIST[assists.brake] ? assists.brake : 'off',
      line: !!assists.line,
    }
    this.el.brakeAssist.value = this.assists.brake
    this.el.line.checked = this.assists.line
    try {
      localStorage.setItem(ASSISTS_KEY, JSON.stringify(this.assists))
    } catch {}
  }

  startTestDrive(mode = 'race') {
    if (!this.analysis.ok)
      return this.toast('Finish the circuit before driving it.', 'error')
    this.stroke = null
    this.pan = null
    this.spaceHeld = false
    this.onTestDrive?.({
      track: this.track.clone(),
      driverIndex: this.driverIndex,
      mode,
      difficulty: this.difficulty,
      assists: { ...this.assists },
    })
  }

  openLoadDialog() {
    const tracks = store.listTracks()
    const list = this.el.loadList
    list.innerHTML = tracks.length
      ? tracks
          .map(
            (t) => `
        <li>
          <span class='gp-load-name'>${esc(t.name)}</span>
          <span class='gp-badge ${t.valid ? 'is-ok' : 'is-draft'}'>${t.valid ? 'Valid' : 'Draft'}</span>
          <button data-load='${esc(t.name)}'>Load</button>
          <button data-delete='${esc(t.name)}' class='gp-danger'>Delete</button>
        </li>`,
          )
          .join('')
      : "<li class='gp-empty'>No saved circuits yet.</li>"
    list.onclick = (e) => {
      const load = e.target.closest('[data-load]')?.dataset.load
      const del = e.target.closest('[data-delete]')?.dataset.delete
      if (load != null) {
        if (
          this.track.pieces.length &&
          !confirm(
            `Load “${load}”? Unsaved changes to this circuit will be lost.`,
          )
        )
          return
        const track = store.loadTrack(load)
        if (track) {
          this.replaceTrack(track)
          this.lastSavedName = track.name
          this.toast(`Loaded “${track.name}”`)
        }
        this.el.loadDialog.close()
      } else if (del != null && confirm(`Delete “${del}” for good?`)) {
        store.deleteTrack(del)
        this.openLoadDialog()
      }
    }
    if (!this.el.loadDialog.open) this.el.loadDialog.showModal()
  }

  toast(message, kind = 'info') {
    const t = this.el.toast
    t.textContent = message
    t.className = `gp-toast is-visible ${kind === 'error' ? 'is-error' : ''}`
    clearTimeout(this.toastTimer)
    this.toastTimer = setTimeout(() => (t.className = 'gp-toast'), 2800)
  }

  renderStatus() {
    const a = this.analysis
    this.el.test.disabled = !a.ok
    this.el.practice.disabled = !a.ok
    this.el.tv.disabled = !a.ok
    this.el.tv.title = a.ok
      ? 'Watch a race following the driver above (W)'
      : 'Finish the circuit first'
    this.el.test.title = a.ok
      ? 'Race all 22 cars on this circuit (T)'
      : 'Finish the circuit first'
    this.el.practice.title = a.ok
      ? 'Just you, unlimited laps (Shift+T)'
      : 'Finish the circuit first'
    if (a.ok) {
      const l = a.loop
      this.el.status.innerHTML = `
        <div class='gp-verdict is-ok'>✓ Circuit complete</div>
        <dl>
          <dt>Lap</dt><dd>${l.lengthKm.toFixed(2)} km <small>(${l.length.toFixed(0)} tiles)</small></dd>
          <dt>Race</dt><dd>${this.track.laps} laps · ${l.raceKm.toFixed(1)} km</dd>
          <dt>Corners</dt><dd>${l.corners}</dd>
          <dt>Checkpoints</dt><dd>${l.checkpoints.length}</dd>
          <dt>Pieces</dt><dd>${this.track.pieces.length}</dd>
        </dl>`
    } else {
      this.el.status.innerHTML = `
        <div class='gp-verdict is-bad'>✕ Not raceable yet</div>
        <ul>${a.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        ${a.dangling.length ? "<p class='gp-hint'>Open ends are marked in red on the map.</p>" : ''}`
    }
  }

  updateHud() {
    const h = this.hover
    if (!h || !this.track.inBounds(h.cx, h.cy)) {
      this.el.hud.textContent = ''
      return
    }
    let text = `${h.cx}, ${h.cy}`
    const under = this.track.pieceAt(h.cx, h.cy)
    if (this.tool === 'erase') {
      if (under) text += ` · ${PIECES[under.type].label}`
    } else {
      const g = this.ghostAt(h.cx, h.cy)
      const check = this.track.canPlace(g.type, g.x, g.y, g.rot)
      text += ` · ${PIECES[this.tool].label}`
      if (!check.ok) text += ` · ${check.reason}`
    }
    this.el.hud.textContent = text
  }

  resize() {
    const { stage, canvas } = this.el
    const dpr = window.devicePixelRatio || 1
    const w = stage.clientWidth
    const h = stage.clientHeight
    if (!w || !h) return
    this.view = { w, h, dpr }
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    this.clampCam()
  }

  clampCam() {
    if (!this.view) return
    const mapW = this.track.cols * this.T
    const mapH = this.track.rows * this.T
    const clampAxis = (v, map, view) => {
      if (map + PAN_MARGIN * 2 <= view) return (map - view) / 2
      return Math.max(-PAN_MARGIN, Math.min(map + PAN_MARGIN - view, v))
    }
    this.cam.x = clampAxis(this.cam.x, mapW, this.view.w)
    this.cam.y = clampAxis(this.cam.y, mapH, this.view.h)
  }

  zoomAt(index, sx, sy) {
    index = Math.max(0, Math.min(ZOOMS.length - 1, index))
    if (index === this.zoom) return
    if (sx == null && this.view) {
      sx = this.view.w / 2
      sy = this.view.h / 2
    }
    const before = this.T
    const mapX = (sx + this.cam.x) / before
    const mapY = (sy + this.cam.y) / before
    this.zoom = index
    this.cam.x = mapX * this.T - sx
    this.cam.y = mapY * this.T - sy
    this.clampCam()
    this.syncInputs()
  }

  fit() {
    if (!this.view) return
    const fitT = Math.min(
      (this.view.w - 40) / this.track.cols,
      (this.view.h - 40) / this.track.rows,
    )
    let idx = 0
    for (let i = 0; i < ZOOMS.length; i++) if (ZOOMS[i] <= fitT) idx = i
    this.zoom = idx
    this.cam.x = (this.track.cols * this.T - this.view.w) / 2
    this.cam.y = (this.track.rows * this.T - this.view.h) / 2
    this.clampCam()
    this.syncInputs()
  }

  trackImage() {
    const T = this.T
    const key = `${T}|${this.track.cols}x${this.track.rows}`
    if (this.trackCanvasKey !== key) {
      const c = this.trackCanvas
      c.width = this.track.cols * T
      c.height = this.track.rows * T
      const ctx = c.getContext('2d')
      drawGrass(ctx, this.track.cols, this.track.rows, T)
      drawPieces(ctx, this.track.pieces, T)
      this.trackCanvasKey = key
    }
    return this.trackCanvas
  }

  frame(time) {
    requestAnimationFrame(this.frame)
    if (!this.view || !this.active) return
    const { ctx } = this
    const { w, h, dpr } = this.view
    const T = this.T

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0b0d10'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y))

    ctx.drawImage(this.trackImage(), 0, 0)
    if (this.overlays.grid) this.drawGridLines(T)

    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 2
    ctx.strokeRect(-1, -1, this.track.cols * T + 2, this.track.rows * T + 2)

    const loop = this.analysis.loop
    if (loop) {
      if (this.overlays.checkpoints) this.drawCheckpoints(loop, T)
      if (this.overlays.line) this.drawRacingLine(loop, T, time)
      if (this.overlays.cars) this.drawGridCars(loop, T)
    }
    this.drawProblems(T, time)
    this.drawCursor(T)
  }

  drawGridLines(T) {
    const { ctx } = this
    const x0 = Math.max(0, Math.floor(this.cam.x / T))
    const y0 = Math.max(0, Math.floor(this.cam.y / T))
    const x1 = Math.min(
      this.track.cols,
      Math.ceil((this.cam.x + this.view.w) / T),
    )
    const y1 = Math.min(
      this.track.rows,
      Math.ceil((this.cam.y + this.view.h) / T),
    )
    ctx.beginPath()
    for (let x = x0; x <= x1; x++) {
      ctx.moveTo(x * T + 0.5, y0 * T)
      ctx.lineTo(x * T + 0.5, y1 * T)
    }
    for (let y = y0; y <= y1; y++) {
      ctx.moveTo(x0 * T, y * T + 0.5)
      ctx.lineTo(x1 * T, y * T + 0.5)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  drawRacingLine(loop, T, time) {
    const { ctx } = this
    const pts = loop.racingLine
    ctx.beginPath()
    pts.forEach(([x, y], i) =>
      i ? ctx.lineTo(x * T, y * T) : ctx.moveTo(x * T, y * T),
    )
    ctx.closePath()
    ctx.strokeStyle = 'rgba(255, 214, 0, 0.85)'
    ctx.lineWidth = Math.max(1.5, T * 0.04)
    ctx.setLineDash([T * 0.25, T * 0.18])
    ctx.lineDashOffset = -(time / 40) % (T * 0.43)
    ctx.stroke()
    ctx.setLineDash([])

    const every = Math.max(1, Math.round(3 / 0.25))
    ctx.fillStyle = 'rgba(255, 214, 0, 0.95)'
    for (let i = 0; i < pts.length; i += every) {
      const [x, y] = pts[i]
      const [nx, ny] = pts[(i + 1) % pts.length]
      const a = Math.atan2(ny - y, nx - x)
      ctx.save()
      ctx.translate(x * T, y * T)
      ctx.rotate(a)
      const s = Math.max(4, T * 0.14)
      ctx.beginPath()
      ctx.moveTo(s, 0)
      ctx.lineTo(-s * 0.6, -s * 0.7)
      ctx.lineTo(-s * 0.2, 0)
      ctx.lineTo(-s * 0.6, s * 0.7)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
    }
  }

  drawCheckpoints(loop, T) {
    const { ctx } = this
    ctx.lineWidth = Math.max(1.5, T * 0.05)
    ctx.font = `600 ${Math.max(10, T * 0.3)}px 'Titillium Web', sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const cp of loop.checkpoints) {
      const hw = cp.halfWidth
      ctx.strokeStyle = cp.index === 0 ? '#ffffff' : 'rgba(64, 224, 255, 0.9)'
      ctx.beginPath()
      ctx.moveTo((cp.x - cp.nx * hw) * T, (cp.y - cp.ny * hw) * T)
      ctx.lineTo((cp.x + cp.nx * hw) * T, (cp.y + cp.ny * hw) * T)
      ctx.stroke()
      if (cp.index > 0) {
        ctx.fillStyle = 'rgba(64, 224, 255, 0.95)'
        ctx.fillText(
          cp.index,
          (cp.x + cp.nx * (hw + 0.3)) * T,
          (cp.y + cp.ny * (hw + 0.3)) * T,
        )
      }
    }
  }

  drawGridCars(loop, T) {
    loop.grid.forEach((slot, i) => {
      const driver = DRIVERS[i]
      if (driver)
        drawCar(this.ctx, slot.x, slot.y, slot.heading, driver.team, T)
    })
  }

  drawProblems(T, time) {
    const { ctx } = this
    const a = this.analysis
    const pulse = 0.55 + 0.45 * Math.sin(time / 180)

    if (a.orphans.length && this.track.startPiece) {
      ctx.fillStyle = `rgba(255, 60, 60, ${0.18 + 0.12 * pulse})`
      for (const id of a.orphans) {
        const p = this.track.pieces.find((q) => q.id === id)
        if (!p) continue
        const { w, h } = footprint(p.type, p.rot)
        ctx.fillRect(p.x * T, p.y * T, w * T, h * T)
      }
    }

    for (const d of a.dangling) {
      const x = d.x * T
      const y = d.y * T
      const r = Math.max(5, T * 0.32)
      ctx.beginPath()
      ctx.arc(x, y, r * (0.85 + 0.25 * pulse), 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255, 70, 70, ${0.6 + 0.4 * pulse})`
      ctx.lineWidth = Math.max(2, T * 0.07)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x + d.dx * r * 0.2, y + d.dy * r * 0.2)
      ctx.lineTo(x + d.dx * r * 1.6, y + d.dy * r * 1.6)
      ctx.stroke()
    }
  }

  drawCursor(T) {
    const h = this.hover
    if (!h || this.pan || this.spaceHeld) return
    const { ctx } = this

    if (this.tool === 'erase') {
      const p = this.track.pieceAt(h.cx, h.cy)
      if (p) {
        const { w, h: hh } = footprint(p.type, p.rot)
        ctx.fillStyle = 'rgba(255, 60, 60, 0.35)'
        ctx.fillRect(p.x * T, p.y * T, w * T, hh * T)
        ctx.strokeStyle = '#ff5a5f'
        ctx.lineWidth = 2
        ctx.strokeRect(p.x * T + 1, p.y * T + 1, w * T - 2, hh * T - 2)
      } else if (this.track.inBounds(h.cx, h.cy)) {
        ctx.strokeStyle = 'rgba(255, 90, 95, 0.7)'
        ctx.lineWidth = 2
        ctx.strokeRect(h.cx * T + 1, h.cy * T + 1, T - 2, T - 2)
      }
      return
    }

    const g = this.ghostAt(h.cx, h.cy)
    const ok = this.track.canPlace(g.type, g.x, g.y, g.rot).ok
    const { w, h: hh } = footprint(g.type, g.rot)
    ctx.save()
    ctx.globalAlpha = ok ? 0.75 : 0.4
    drawPieces(ctx, [g], T)
    ctx.restore()
    ctx.fillStyle = ok ? 'rgba(80, 255, 140, 0.12)' : 'rgba(255, 60, 60, 0.22)'
    ctx.fillRect(g.x * T, g.y * T, w * T, hh * T)
    ctx.strokeStyle = ok
      ? 'rgba(120, 255, 170, 0.9)'
      : 'rgba(255, 90, 95, 0.95)'
    ctx.lineWidth = 2
    ctx.strokeRect(g.x * T + 1, g.y * T + 1, w * T - 2, hh * T - 2)
  }
}
