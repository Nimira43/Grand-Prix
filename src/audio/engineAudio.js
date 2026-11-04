export const ENGINE_TONE = {
  howl: 0.75, 
  body: 0.83, 
  shimmer: 0.48, 
  rasp: 0.77,
  drive: 4.8,
  brightness: 2.05, 
  roughness: 0.56, 
  wobble: 15, 
  offThrottle: 0.73, 
  level: 1, 
}

export const firingHz = (rpm) => (rpm / 60) * 6

function makeNoise(ctx) {
  const len = ctx.sampleRate * 2
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

export function makeLimiter(ctx) {
  const limiter = ctx.createDynamicsCompressor()
  limiter.threshold.value = -3
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.002
  limiter.release.value = 0.12
  return limiter
}

function makeShaper(ctx, amount) {
  const shaper = ctx.createWaveShaper()
  const n = 1024
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount)
  }
  shaper.curve = curve
  shaper.oversample = '2x'
  return shaper
}

export class EngineVoice {
  constructor(ctx, destination, noiseBuffer, tone = ENGINE_TONE) {
    this.ctx = ctx
    this.tone = tone
    const t = ctx.currentTime

    this.howl = ctx.createOscillator()
    this.howl.type = 'sawtooth'
    this.body = ctx.createOscillator()
    this.body.type = 'sawtooth'
    this.body.detune.value = -9
    this.shimmer = ctx.createOscillator()
    this.shimmer.type = 'triangle'

    this.howlGain = ctx.createGain()
    this.bodyGain = ctx.createGain()
    this.shimmerGain = ctx.createGain()

    this.noise = ctx.createBufferSource()
    this.noise.buffer = noiseBuffer
    this.noise.loop = true
    this.noiseFilter = ctx.createBiquadFilter()
    this.noiseFilter.type = 'bandpass'
    this.noiseFilter.Q.value = 1.4
    this.noiseGain = ctx.createGain()

    this.lump = ctx.createOscillator()
    this.lumpDepth = ctx.createGain()
    this.lumpCarrier = ctx.createGain()

    this.wobble = ctx.createOscillator()
    this.wobble.frequency.value = 7.3
    this.wobbleDepth = ctx.createGain()

    this.mix = ctx.createGain()
    this.shaper = makeShaper(ctx, tone.drive)
    this.filter = ctx.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.Q.value = 0.9
    this.out = ctx.createGain()
    this.out.gain.value = 0
    this.panner = ctx.createStereoPanner()

    this.howl.connect(this.howlGain).connect(this.mix)
    this.body.connect(this.bodyGain).connect(this.mix)
    this.shimmer.connect(this.shimmerGain).connect(this.mix)
    this.noise
      .connect(this.noiseFilter)
      .connect(this.noiseGain)
      .connect(this.mix)
    this.mix
      .connect(this.lumpCarrier)
      .connect(this.shaper)
      .connect(this.filter)
      .connect(this.out)
    this.lump.connect(this.lumpDepth).connect(this.lumpCarrier.gain)
    this.wobble.connect(this.wobbleDepth)
    this.wobbleDepth.connect(this.howl.detune)
    this.wobbleDepth.connect(this.body.detune)
    this.wobbleDepth.connect(this.shimmer.detune)
    this.out.connect(this.panner).connect(destination)

    for (const node of [
      this.howl,
      this.body,
      this.shimmer,
      this.noise,
      this.lump,
      this.wobble,
    ])
      node.start(t)
    this.applyTone()
    this.rpm = 4000
    this.cut = 0
    this.lastGear = 1
  }

  applyTone() {
    const tone = this.tone
    this.howlGain.gain.value = tone.howl
    this.bodyGain.gain.value = tone.body
    this.shimmerGain.gain.value = tone.shimmer
    const rough = Math.min(0.95, tone.roughness)
    this.lumpCarrier.gain.value = 1 - rough
    this.lumpDepth.gain.value = rough
    this.wobbleDepth.gain.value = tone.wobble
    if (this.shaperDrive !== tone.drive) {
      this.shaper.curve = makeShaper(this.ctx, tone.drive).curve
      this.shaperDrive = tone.drive
    }
  }

  set({ rpm, throttle = 1, gear = 1, volume = 1, pan = 0, pitch = 1 }) {
    const ctx = this.ctx
    const now = ctx.currentTime
    const tone = this.tone
    const smooth = 0.025

    if (gear > this.lastGear) this.cut = now + 0.045
    this.lastGear = gear

    const f = firingHz(rpm) * pitch
    this.howl.frequency.setTargetAtTime(f, now, smooth)
    this.body.frequency.setTargetAtTime(f * 0.5, now, smooth)
    this.shimmer.frequency.setTargetAtTime(f * 2, now, smooth)
    this.lump.frequency.setTargetAtTime((rpm / 60) * pitch, now, smooth)
    this.noiseFilter.frequency.setTargetAtTime(f * 1.6, now, smooth)
    this.noiseGain.gain.setTargetAtTime(
      tone.rasp * (0.25 + 0.75 * throttle),
      now,
      smooth,
    )

    const cutoff = (900 + f * 2.2 + throttle * 2600) * tone.brightness
    this.filter.frequency.setTargetAtTime(Math.min(16000, cutoff), now, 0.04)

    const load = tone.offThrottle + (1 - tone.offThrottle) * throttle
    const level = (now < this.cut ? 0.15 : volume * load) * (tone.level ?? 1)
    this.out.gain.setTargetAtTime(level, now, now < this.cut ? 0.005 : 0.03)
    this.panner.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), now, 0.05)
  }

  silence() {
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05)
  }

  stop() {
    const t = this.ctx.currentTime + 0.1
    for (const node of [
      this.howl,
      this.body,
      this.shimmer,
      this.noise,
      this.lump,
      this.wobble,
    ]) {
      try {
        node.stop(t)
      } catch {}
    }
  }
}

export const MIX = {
  master: 0.55,
  mine: 0.5,
  rivals: 5,
  rivalLevel: 0.55,
  hearing: 3,
  panWidth: 5,
  doppler: 0.012,
}

const MUTE_KEY = 'grand-prix.muted'

export class RaceAudio {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext
    this.ctx = AC ? new AC() : null
    if (!this.ctx) return
    this.muted = false
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1'
    } catch {}
    this.master = this.ctx.createGain()
    this.master.gain.value = this.muted ? 0 : MIX.master
    this.comp = this.ctx.createDynamicsCompressor()
    this.comp.threshold.value = -14
    this.comp.ratio.value = 4
    this.limiter = makeLimiter(this.ctx)
    this.master
      .connect(this.comp)
      .connect(this.limiter)
      .connect(this.ctx.destination)
    this.noise = makeNoise(this.ctx)
    this.mine = new EngineVoice(this.ctx, this.master, this.noise)
    this.rivals = Array.from({ length: MIX.rivals }, () => ({
      voice: new EngineVoice(this.ctx, this.master, this.noise),
      car: null,
      lastDist: null,
    }))
    this.assignAt = -1
    this.ctx.resume?.()
  }

  get ok() {
    return !!this.ctx
  }

  reset() {
    if (!this.ok) return
    this.assignAt = -Infinity
    for (const slot of this.rivals) {
      slot.car = null
      slot.lastDist = null
      slot.closing = 0
      slot.voice.silence()
    }
  }

  toggleMute() {
    if (!this.ok) return false
    this.muted = !this.muted
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : MIX.master,
      this.ctx.currentTime,
      0.05,
    )
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0')
    } catch {}
    return this.muted
  }

  pause(paused) {
    if (!this.ok) return
    if (paused) this.ctx.suspend?.()
    else this.ctx.resume?.()
  }

  gridRevs(car, time, seed) {
    const r = Math.sin(time * (2.1 + seed * 0.7) + seed * 9) * 0.5 + 0.5
    const blip = Math.max(0, Math.sin(time * (1.3 + seed) + seed * 3)) ** 6
    return {
      rpm: 7000 + r * 2500 + blip * 4500,
      throttle: 0.4 + blip * 0.6,
      gear: 1,
    }
  }

  update(me, cars, time, onGrid) {
    if (!this.ok || this.ctx.state === 'closed') return
    const engine = (car, id) =>
      onGrid
        ? this.gridRevs(car, time, (id % 7) / 7)
        : { rpm: car.rpm, throttle: car.throttle ?? 0, gear: car.gear }

    this.mine.set({ ...engine(me, -1), volume: MIX.mine })

    if (time - this.assignAt > 0.25) {
      this.assignAt = time
      const nearest = cars
        .filter((c) => c.car !== me)
        .map((c) => ({ ...c, d: Math.hypot(c.car.x - me.x, c.car.y - me.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, MIX.rivals)
      const keep = new Set(nearest.map((c) => c.car))
      for (const slot of this.rivals)
        if (slot.car && !keep.has(slot.car)) slot.car = null
      for (const c of nearest) {
        if (this.rivals.some((s) => s.car === c.car)) continue
        const free = this.rivals.find((s) => !s.car)
        if (free) {
          free.car = c.car
          free.id = c.id
          free.lastDist = null
        }
      }
    }

    for (const slot of this.rivals) {
      if (!slot.car) {
        slot.voice.silence()
        continue
      }
      const car = slot.car
      const dx = car.x - me.x
      const dy = car.y - me.y
      const d = Math.hypot(dx, dy)
      const closing =
        slot.lastDist == null
          ? 0
          : (slot.lastDist - d) / Math.max(1 / 240, time - slot.lastTime)
      slot.lastDist = d
      slot.lastTime = time
      slot.closing =
        (slot.closing ?? 0) * 0.85 +
        Math.max(-12, Math.min(12, closing)) * 0.15
      const pitch = Math.max(
        0.88,
        Math.min(1.12, 1 + slot.closing * MIX.doppler),
      )
      const volume = MIX.rivalLevel / (1 + (d / MIX.hearing) ** 2)
      slot.voice.set({
        ...engine(car, slot.id),
        volume,
        pan: dx / MIX.panWidth,
        pitch,
      })
    }
  }

  close() {
    if (!this.ok) return
    this.mine.stop()
    for (const s of this.rivals) s.voice.stop()
    setTimeout(() => this.ctx.close?.(), 200)
  }
}

export class ThemeMusic {
  constructor(src = '/music/theme_music.mp3') {
    this.audio = new Audio(src)
    this.audio.loop = true
    this.audio.volume = 0
    this.fade = null
  }

  play(target = 0.5) {
    this.audio.play().catch(() => {})
    clearInterval(this.fade)
    this.fade = setInterval(() => {
      this.audio.volume = Math.min(target, this.audio.volume + 0.04)
      if (this.audio.volume >= target) clearInterval(this.fade)
    }, 60)
  }

  stop() {
    clearInterval(this.fade)
    this.audio.pause()
    this.audio.currentTime = 0
    this.audio.volume = 0
  }
}
