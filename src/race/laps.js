const GATE_SLACK = 0.6
const SKIP_WINDOW = 1 / 3

export class LapTimer {
  constructor(loop, startTime = 0) {
    this.gates = loop.checkpoints.map((cp) => {
      const hw = cp.halfWidth + GATE_SLACK
      return {
        ax: cp.x - cp.nx * hw,
        ay: cp.y - cp.ny * hw,
        bx: cp.x + cp.nx * hw,
        by: cp.y + cp.ny * hw,
        tx: cp.ny,
        ty: -cp.nx,
      }
    })
    this.lap = 0
    this.next = 0
    this.lapStart = startTime
    this.lastLap = null
    this.bestLap = null
    this.laps = []
    this.valid = []
    this.invalid = false
    this.lastValid = true
  }

  invalidate() {
    if (this.lap > 0) this.invalid = true
  }

  update(x0, y0, x1, y1, time, dt) {
    for (let k = 0; k < this.gates.length; k++) {
      const g = this.gates[k]
      const f = crossing(x0, y0, x1, y1, g)
      if (f == null) continue

      if ((x1 - x0) * g.tx + (y1 - y0) * g.ty <= 0) continue
      const t = time - dt + f * dt
      if (k !== this.next) {
        const G = this.gates.length
        const ahead = (k - this.next + G) % G
        if (ahead === 0 || ahead > Math.max(1, Math.floor(G * SKIP_WINDOW)))
          continue
        if (this.lap === 0 && k !== 0) continue
      }
      if (k === 0) {
        if (this.lap > 0) {
          const lapTime = t - this.lapStart
          const ok = !this.invalid
          this.laps.push(lapTime)
          this.valid.push(ok)
          this.lastLap = lapTime
          this.lastValid = ok
          if (ok)
            this.bestLap =
              this.bestLap == null ? lapTime : Math.min(this.bestLap, lapTime)
          this.lapStart = t
        }
        this.invalid = false
        this.lap++
      }
      this.next = (k + 1) % this.gates.length
      return k === 0 ? 'lap' : 'gate'
    }
    return null
  }

  current(time) {
    return time - this.lapStart
  }
}

function crossing(x0, y0, x1, y1, g) {
  const dx = x1 - x0
  const dy = y1 - y0
  const ex = g.bx - g.ax
  const ey = g.by - g.ay
  const den = dx * ey - dy * ex
  if (Math.abs(den) < 1e-12) return null
  const t = ((g.ax - x0) * ey - (g.ay - y0) * ex) / den
  const u = ((g.ax - x0) * dy - (g.ay - y0) * dx) / den
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null
}

export function formatTime(t) {
  if (t == null || !isFinite(t)) return '-:--.---'
  const m = Math.floor(t / 60)
  const s = t - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}
