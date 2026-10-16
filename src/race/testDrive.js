import { analyseTrack } from '../track/analyse.js'
import { drawGrass, drawPieces, drawCar } from '../track/render.js'
import { DRIVERS, TEAMS } from '../data/grid.js'
import { buildSurface } from './surface.js'
import { carStats, createCar, stepCar, speedKmh } from './carPhysics.js'
import { LapTimer, formatTime } from './laps.js'

const ZOOM_STEPS = [9, 10, 12, 14, 16, 18, 22, 26]
const DEFAULT_ZOOM = 3
const ZOOM_KEY = 'grand-prix.raceZoom'
const STEP = 1 / 120
const MARGIN = 2
const LOOK_AHEAD = 0.45
const MAX_LEAD = 0.55
const CHUNK = 400

function loadZoom() {
  try {
    const i = Number(localStorage.getItem(ZOOM_KEY))
    return localStorage.getItem(ZOOM_KEY) != null &&
      Number.isInteger(i) &&
      ZOOM_STEPS[i]
      ? i
      : DEFAULT_ZOOM
  } catch {
    return DEFAULT_ZOOM
  }
}

const STEER_KEYS = {
  KeyQ: 'throttle',
  KeyA: 'brake',
  KeyO: 'left',
  KeyP: 'right',
}

const esc = (s) =>
  String(s).replace(/[&<>'']/g, (c) => `&#${c.charCodeAt(0)}`)

export class TestDrive {
  constructor({ track, driverIndex = 0, onExit }) {
    this.track = track
    this.analysis = analyseTrack(track)
    if (!this.analysis.ok) throw new Error('Circuit is not raceable')
    this.loop = this.analysis.loop
    this.driver = DRIVERS[driverIndex] ?? DRIVERS[0]
    this.team = TEAMS[this.driver.team]
    this.onExit = onExit
    this.surface = buildSurface(track)
    this.keys = { throttle: false, brake: false, left: false, right: false }
    this.zoom = loadZoom()
    this.chunks = new Map()
    this.chunkKey = ''

    this.buildDom()
    this.bind()
    this.resize()
    this.reset()
    this.last = performance.now()
    this.raf = requestAnimationFrame((t) => this.frame(t))
  }

  buildDom() {
    const root = document.createElement('div')
    root.className = 'gp-drive'
    root.innerHTML = `
      <canvas class='gp-drive-view'></canvas>

      <div class='gp-d-timing'>
        <div class='gp-d-lap'><span>LAP</span><b data-hud='lap'>-</b></div>
        <div class='gp-d-row'><span>Current</span><b data-hud='current'>-:--.---</b></div>
        <div class='gp-d-row'><span>Last</span><b data-hud='last'>-:--.---</b></div>
        <div class='gp-d-row'><span>Best</span><b data-hud='best'>-:--.---</b></div>
      </div>

      <div class='gp-d-lights' data-hud='lights'>
        ${'<div class="gp-d-pod"><i></i><i></i></div>'.repeat(5)}
      </div>

      <div class='gp-d-msg' data-hud='msg'></div>

      <canvas class='gp-d-map' width='240' height='170'></canvas>

      <div class='gp-d-driver' style='--team:${this.team.colour}--accent:${this.team.accent}'>
        <b>${esc(this.driver.name.toUpperCase())}</b><span>${esc(this.team.name)}</span>
      </div>

      <div class='gp-d-dash'>
        <div class='gp-d-revs' data-hud='revs'>${'<i></i>'.repeat(15)}</div>
        <div class='gp-d-speed'><b data-hud='speed'>0</b><span>km/h</span></div>
        <div class='gp-d-gear'><span>Gear</span><b data-hud='gear'>N</b></div>
      </div>

      <div class='gp-d-help'>
        <kbd>Q</kbd> accelerate · <kbd>A</kbd> brake · <kbd>O</kbd> left · <kbd>P</kbd> right · <kbd>R</kbd> restart · <kbd>+</kbd><kbd>-</kbd> zoom · <kbd>Space</kbd> pause · <kbd>Esc</kbd> editor
      </div>`
    document.body.appendChild(root)
    this.root = root
    this.canvas = root.querySelector('.gp-drive-view')
    this.ctx = this.canvas.getContext('2d')
    this.mapCanvas = root.querySelector('.gp-d-map')
    this.hud = {}
    for (const el of root.querySelectorAll('[data-hud]'))
      this.hud[el.dataset.hud] = el
    this.revLeds = [...this.hud.revs.children]
    this.lightPods = [...this.hud.lights.children]
    this.buildMinimap()
    if (import.meta.env.DEV) window.__testDrive = this
  }

  bind() {
    this.onKeyDown = (e) => {
      if (STEER_KEYS[e.code]) {
        this.keys[STEER_KEYS[e.code]] = true
        e.preventDefault()
        return
      }
      if (e.repeat) return
      if (e.code === 'Escape') this.exit()
      else if (e.code === 'KeyR') this.reset()
      else if (e.code === 'Equal' || e.code === 'NumpadAdd')
        this.setZoom(this.zoom - 1)
      else if (e.code === 'Minus' || e.code === 'NumpadSubtract')
        this.setZoom(this.zoom + 1)
      else if (e.code === 'Space') this.paused = !this.paused
      else return
      e.preventDefault()
    }
    this.onKeyUp = (e) => {
      if (STEER_KEYS[e.code]) this.keys[STEER_KEYS[e.code]] = false
    }
    this.onBlur = () => {
      for (const k in this.keys) this.keys[k] = false
    }
    this.onResize = () => this.resize()
    window.addEventListener('keydown', this.onKeyDown, true)
    window.addEventListener('keyup', this.onKeyUp, true)
    window.addEventListener('blur', this.onBlur)
    window.addEventListener('resize', this.onResize)
  }

  exit() {
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown, true)
    window.removeEventListener('keyup', this.onKeyUp, true)
    window.removeEventListener('blur', this.onBlur)
    window.removeEventListener('resize', this.onResize)
    this.root.remove()
    this.onExit?.()
  }

  reset() {
    const slot = this.loop.grid[0]
    this.car = createCar(
      carStats(this.driver.team),
      slot.x,
      slot.y,
      slot.heading,
    )
    this.time = 0
    this.acc = 0
    this.phase = 'lights'
    this.lightsOutAt = 5.6 + 0.2 + Math.random() * 2.3
    this.timer = null
    this.particles = []
    this.paused = false
    this.message = null
    this.cam = { x: this.car.x, y: this.car.y }
    this.hud.lights.classList.add('is-visible')
  }

  resize() {
    const dpr = window.devicePixelRatio || 1
    const w = window.innerWidth
    const h = window.innerHeight
    const cols = ZOOM_STEPS[this.zoom]
    this.view = { w, h, dpr, T: Math.min(w / cols, h / ((cols * 9) / 16)) }
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
  }

  playerInput() {
    const k = this.keys
    return {
      steer: (k.right ? 1 : 0) - (k.left ? 1 : 0),
      throttle: k.throttle ? 1 : 0,
      brake: k.brake ? 1 : 0,
    }
  }

  tick(dt) {
    this.time += dt
    const car = this.car

    if (this.phase === 'lights') {
      if (this.time >= this.lightsOutAt) {
        this.phase = 'race'
        this.timer = new LapTimer(this.loop, this.time)
        this.flash('GO!', 0.8)
      }
      return
    }

    const x0 = car.x
    const y0 = car.y
    stepCar(car, this.playerInput(), dt, this.surface)
    const event = this.timer.update(x0, y0, car.x, car.y, this.time, dt)
    if (event === 'lap' && this.timer.lastLap != null) {
      const best = this.timer.lastLap === this.timer.bestLap
      this.flash(
        `${best ? 'BEST LAP' : 'LAP'} ${formatTime(this.timer.lastLap)}`,
        2.2,
        best ? 'is-best' : '',
      )
    }
    this.emitParticles(dt)
  }

  emitParticles(dt) {
    const car = this.car
    const back = -0.14
    const bx = car.x + Math.cos(car.heading) * back
    const by = car.y + Math.sin(car.heading) * back
    const spray = (n, colour, size, speed, life) => {
      for (let i = 0; i < n; i++) {
        const a = car.travel + Math.PI + (Math.random() - 0.5) * 1.4
        const s = speed * (0.4 + Math.random())
        this.particles.push({
          x: bx + (Math.random() - 0.5) * 0.15,
          y: by + (Math.random() - 0.5) * 0.15,
          vx: Math.cos(a) * s,
          vy: Math.sin(a) * s,
          life,
          max: life,
          size: size * (0.6 + Math.random() * 0.8),
          colour,
        })
      }
    }
    const rate = (perSecond) => (Math.random() < perSecond * dt ? 1 : 0)
    if (car.grassFrac > 0 && car.speed > 1.2) {
      spray(
        rate(70 * car.grassFrac),
        Math.random() < 0.5 ? '#6b4f2a' : '#3f8f3a',
        0.05,
        1.2,
        0.5,
      )
    }
    if (car.slip > 0.85 && car.speed > 2)
      spray(rate(40), 'rgba(220,220,220,0.5)', 0.11, 0.6, 0.7)
    if (car.hitBarrier > 0.25) spray(6, '#222', 0.05, 2.5, 0.4)

    for (const p of this.particles) {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vx *= 1 - 3 * dt
      p.vy *= 1 - 3 * dt
      p.life -= dt
    }
    if (this.particles.length > 400)
      this.particles.splice(0, this.particles.length - 400)
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  flash(text, seconds, cls = '') {
    this.message = { text, until: this.time + seconds, cls }
  }

  frame(now) {
    this.raf = requestAnimationFrame((t) => this.frame(t))
    const real = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    if (!this.paused) {
      this.acc += real
      while (this.acc >= STEP) {
        this.tick(STEP)
        this.acc -= STEP
      }
    }
    this.updateCamera(this.paused ? 0 : real)
    this.draw()
    this.updateHud()
  }

  setZoom(index) {
    const next = Math.max(0, Math.min(ZOOM_STEPS.length - 1, index))
    if (next === this.zoom) return
    this.zoom = next
    try {
      localStorage.setItem(ZOOM_KEY, String(next))
    } catch {}
    this.resize()
    this.flash(`ZOOM ${ZOOM_STEPS.length - next}/${ZOOM_STEPS.length}`, 0.9)
  }

  updateCamera(dt) {
    const car = this.car
    const { w, h, T } = this.view
    const cap = (Math.min(w, h) / T / 2) * MAX_LEAD
    const lead = Math.min(car.speed * LOOK_AHEAD, cap)
    const tx = car.x + Math.cos(car.travel) * lead
    const ty = car.y + Math.sin(car.travel) * lead
    const k = 1 - Math.exp(-dt * 4)
    this.cam.x += (tx - this.cam.x) * k
    this.cam.y += (ty - this.cam.y) * k

    const halfW = w / T / 2
    const halfH = h / T / 2
    const clampAxis = (v, size, half) => {
      const lo = -MARGIN + half
      const hi = size + MARGIN - half
      return lo > hi ? size / 2 : Math.max(lo, Math.min(hi, v))
    }
    this.cam.x = clampAxis(this.cam.x, this.track.cols, halfW)
    this.cam.y = clampAxis(this.cam.y, this.track.rows, halfH)
  }

  drawWorld(ctx, T) {
    const { w, h, dpr } = this.view
    const scale = Math.min(dpr, 2)
    const key = `${T.toFixed(3)}|${scale}`
    if (key !== this.chunkKey) {
      this.chunks.clear()
      this.chunkKey = key
    }

    const ox = -Math.round(MARGIN * T)
    const oy = ox
    const left = this.cam.x * T - w / 2 - ox
    const top = this.cam.y * T - h / 2 - oy
    const maxX = (this.track.cols + MARGIN * 2) * T
    const maxY = (this.track.rows + MARGIN * 2) * T
    const i0 = Math.max(0, Math.floor(left / CHUNK))
    const j0 = Math.max(0, Math.floor(top / CHUNK))
    const i1 = Math.min(
      Math.ceil(maxX / CHUNK) - 1,
      Math.floor((left + w) / CHUNK),
    )
    const j1 = Math.min(
      Math.ceil(maxY / CHUNK) - 1,
      Math.floor((top + h) / CHUNK),
    )
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = `${i},${j}`
        let chunk = this.chunks.get(k)
        if (!chunk) {
          chunk = this.buildChunk(i, j, T, scale, -ox)
          this.chunks.set(k, chunk)
        }
        ctx.drawImage(chunk, ox + i * CHUNK, oy + j * CHUNK, CHUNK, CHUNK)
      }
    }
  }

  buildChunk(i, j, T, scale, margin) {
    const c = document.createElement('canvas')
    c.width = c.height = Math.ceil(CHUNK * scale)
    const ctx = c.getContext('2d')
    ctx.scale(scale, scale)
    ctx.translate(-i * CHUNK, -j * CHUNK)
    ctx.fillStyle = '#1f6a2a'
    ctx.fillRect(i * CHUNK, j * CHUNK, CHUNK, CHUNK)
    ctx.translate(margin, margin)
    drawTyreWall(ctx, this.track.cols, this.track.rows, T)
    drawGrass(ctx, this.track.cols, this.track.rows, T)
    drawPieces(ctx, this.track.pieces, T)
    return c
  }

  draw() {
    const { ctx } = this
    const { w, h, dpr, T } = this.view
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#123d18'
    ctx.fillRect(0, 0, w, h)
    ctx.translate(
      Math.round(w / 2 - this.cam.x * T),
      Math.round(h / 2 - this.cam.y * T),
    )

    this.drawWorld(ctx, T)

    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max)
      ctx.fillStyle = p.colour
      ctx.beginPath()
      ctx.arc(p.x * T, p.y * T, p.size * T, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1

    const car = this.car
    ctx.save()
    ctx.translate((car.x + 0.035) * T, (car.y + 0.05) * T)
    ctx.rotate(car.heading)
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.fillRect(-0.19 * T, -0.1 * T, 0.39 * T, 0.2 * T)
    ctx.restore()
    drawCar(ctx, car.x, car.y, car.heading, this.driver.team, T)
    if (car.braking) {
      ctx.save()
      ctx.translate(car.x * T, car.y * T)
      ctx.rotate(car.heading)
      ctx.shadowColor = '#ff2a24'
      ctx.shadowBlur = T * 0.25
      ctx.fillStyle = '#ff4a44'
      ctx.fillRect(-0.215 * T, -0.025 * T, 0.03 * T, 0.05 * T)
      ctx.restore()
    }

    this.drawMinimap()
  }

  updateHud() {
    const car = this.car
    const t = this.timer
    const hud = this.hud
    hud.speed.textContent = speedKmh(car)
    hud.gear.textContent = this.phase === 'lights' ? 'N' : car.gear
    hud.lap.textContent = t ? Math.max(1, t.lap) : '-'
    hud.current.textContent = t
      ? formatTime(t.current(this.time))
      : formatTime(null)
    hud.last.textContent = formatTime(t?.lastLap)
    hud.best.textContent = formatTime(t?.bestLap)
    hud.last.classList.toggle(
      'is-best',
      !!t && t.lastLap != null && t.lastLap === t.bestLap,
    )

    const lit =
      this.phase === 'lights' ? 0 : Math.round(((car.rpm - 9000) / 6000) * 15)
    this.revLeds.forEach((led, i) => led.classList.toggle('on', i < lit))

    if (this.phase === 'lights') {
      const on = Math.min(5, Math.floor(Math.max(0, this.time - 0.6)))
      this.lightPods.forEach((pod, i) => pod.classList.toggle('on', i < on))
    } else {
      this.lightPods.forEach((pod) => pod.classList.remove('on'))
      if (this.time > this.timer.lapStart + 1.5 || (t && t.lap > 1))
        this.hud.lights.classList.remove('is-visible')
    }

    let msg = null
    if (this.paused) msg = { text: 'PAUSED', cls: '' }
    else if (t && this.time - t.missed < 1.5)
      msg = { text: 'CHECKPOINT MISSED: GO BACK', cls: 'is-warn' }
    else if (this.message && this.time < this.message.until) msg = this.message
    hud.msg.textContent = msg?.text ?? ''
    hud.msg.className = `gp-d-msg ${msg ? `is-visible ${msg.cls}` : ''}`
  }

  buildMinimap() {
    const c = this.mapCanvas
    const pad = 14
    const xs = this.loop.centre.map((p) => p[0])
    const ys = this.loop.centre.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const bw = Math.max(...xs) - minX
    const bh = Math.max(...ys) - minY
    const s = Math.min((c.width - pad * 2) / bw, (c.height - pad * 2) / bh)
    const ox = (c.width - bw * s) / 2 - minX * s
    const oy = (c.height - bh * s) / 2 - minY * s
    this.mapXf = { s, ox, oy }
    const base = document.createElement('canvas')
    base.width = c.width
    base.height = c.height
    const ctx = base.getContext('2d')
    ctx.lineJoin = 'round'
    ctx.beginPath()
    this.loop.centre.forEach(([x, y], i) =>
      i
        ? ctx.lineTo(ox + x * s, oy + y * s)
        : ctx.moveTo(ox + x * s, oy + y * s),
    )
    ctx.closePath()
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.strokeStyle = '#e9ecf1'
    ctx.lineWidth = 2.5
    ctx.stroke()
    const f = this.loop.checkpoints[0]
    ctx.strokeStyle = '#e10600'
    ctx.lineWidth = 3
    ctx.beginPath()
    const k = 7 / s // a 14px tick whatever the scale
    ctx.moveTo(ox + (f.x - f.nx * k) * s, oy + (f.y - f.ny * k) * s)
    ctx.lineTo(ox + (f.x + f.nx * k) * s, oy + (f.y + f.ny * k) * s)
    ctx.stroke()
    this.mapBase = base
  }

  drawMinimap() {
    const c = this.mapCanvas
    const ctx = c.getContext('2d')
    const { s, ox, oy } = this.mapXf
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(this.mapBase, 0, 0)
    ctx.beginPath()
    ctx.arc(ox + this.car.x * s, oy + this.car.y * s, 5, 0, Math.PI * 2)
    ctx.fillStyle = this.team.colour
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }
}

function drawTyreWall(ctx, cols, rows, T) {
  const r = 0.12
  const gap = 0.26
  const ring = (x, y, i) => {
    ctx.beginPath()
    ctx.arc(x * T, y * T, r * T, 0, Math.PI * 2)
    ctx.fillStyle = '#151515'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x * T, y * T, r * 0.55 * T, 0, Math.PI * 2)
    ctx.fillStyle = Math.floor(i / 4) % 2 ? '#e10600' : '#f2f2f2'
    ctx.fill()
  }
  const off = [-0.14, -0.38]
  for (const o of off) {
    let i = 0
    for (let x = o; x <= cols - o + 1e-6; x += gap) {
      ring(x, o, i)
      ring(x, rows - o, i++)
    }
    i = 0
    for (let y = o + gap; y <= rows - o - gap + 1e-6; y += gap) {
      ring(o, y, i)
      ring(cols - o, y, i++)
    }
  }
}
