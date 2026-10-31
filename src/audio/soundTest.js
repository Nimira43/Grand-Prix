import '../css/main.css'
import './soundTest.css'
import {
  EngineVoice,
  ENGINE_TONE,
  firingHz,
  makeLimiter,
} from './engineAudio.js'
import { carStats, createCar, stepCar, speedKmh } from '../race/carPhysics.js'
import { ROAD } from '../race/surface.js'

const ROAD_SURFACE = {
  cols: 1e9,
  rows: 1e9,
  res: 0,
  w: 1,
  h: 1,
  cells: new Uint8Array([ROAD]),
}

const TONE_SLIDERS = [
  ['howl', 'Howl (main note)', 0, 1.5, 0.01],
  ['body', 'Body (octave down)', 0, 1.6, 0.01],
  ['shimmer', 'Shimmer (octave up)', 0, 1.2, 0.01],
  ['rasp', 'Exhaust rasp', 0, 1.6, 0.01],
  ['drive', 'Distortion', 1, 12, 0.1],
  ['brightness', 'Brightness', 0.3, 4, 0.05],
  ['roughness', 'Roughness', 0, 0.95, 0.01],
  ['wobble', 'Pitch wobble (cents)', 0, 40, 0.5],
  ['offThrottle', 'Off-throttle volume', 0.1, 1, 0.01],
  ['level', 'Engine loudness', 0.2, 2, 0.05],
]

const app = document.querySelector('#app')
app.innerHTML = `
  <div class='st'>
    <header class='gp-bar'><div class='gp-brand'><span class='gp-logo'>GRAND PRIX</span><span class='gp-sub'>V12 Sound Test</span></div></header>
    <main class='st-main'>
      <section class='st-card'>
        <button id='st-power' class='gp-primary st-big'>▶ Start engine</button>
        <p class='st-note'>Browsers only allow sound after a click, hence the button.</p>
        <div class='st-readout'><b id='st-rpm'>-</b><span>rpm</span><b id='st-hz'>-</b><span>Hz</span><b id='st-gear'>-</b><span>gear</span><b id='st-kmh'>-</b><span>km/h</span></div>
        <label class='st-slider'>Revs <input id='st-rev' type='range' min='4000' max='15000' step='10' value='6000' /></label>
        <label class='st-slider'>Throttle <input id='st-throttle' type='range' min='0' max='1' step='0.01' value='0.6' /></label>
        <div class='st-buttons'>
          <button id='st-run'>Full-throttle run through the gears</button>
          <button id='st-grid'>Grid revs</button>
          <button id='st-flyby'>Car flies past</button>
        </div>
        <label class='st-slider'>Volume <input id='st-vol' type='range' min='0' max='1' step='0.01' value='0.5' /></label>
      </section>
      <section class='st-card'>
        <h3>Tone</h3>
        <div id='st-tone'></div>
        <div class='st-buttons'>
          <button id='st-copy'>Copy settings</button>
          <button id='st-reset'>Reset</button>
        </div>
        <pre id='st-out'></pre>
      </section>
    </main>
  </div>`

const $ = (s) => document.querySelector(s)
const tone = { ...ENGINE_TONE }
let ctx = null
let master = null
let voice = null
let flyVoice = null
let noise = null
let mode = 'manual'
let modeStart = 0
let car = null
let simAcc = 0
let last = 0

$('#st-tone').innerHTML = TONE_SLIDERS.map(
  ([k, label, min, max, step]) =>
    `<label class='st-slider'>${label}<input data-tone='${k}' type='range' min='${min}' max='${max}' step='${step}' value='${tone[k]}' /><output>${tone[k]}</output></label>`,
).join('')
for (const input of document.querySelectorAll('[data-tone]')) {
  input.addEventListener('input', () => {
    tone[input.dataset.tone] = Number(input.value)
    input.nextElementSibling.textContent = input.value
    voice?.applyTone()
    flyVoice?.applyTone()
  })
}

function makeNoise() {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  return buf
}

$('#st-power').addEventListener('click', () => {
  if (ctx) {
    voice.stop()
    flyVoice.stop()
    ctx.close()
    ctx = null
    $('#st-power').textContent = '▶ Start engine'
    return
  }
  ctx = new (window.AudioContext || window.webkitAudioContext)()
  master = ctx.createGain()
  master.gain.value = Number($('#st-vol').value)
  const comp = ctx.createDynamicsCompressor()
  master.connect(comp).connect(makeLimiter(ctx)).connect(ctx.destination)
  noise = makeNoise()
  voice = new EngineVoice(ctx, master, noise, tone)
  flyVoice = new EngineVoice(ctx, master, noise, tone)
  $('#st-power').textContent = '■ Stop engine'
  mode = 'manual'
  last = performance.now()
  requestAnimationFrame(frame)
})

$('#st-vol').addEventListener(
  'input',
  () => master && (master.gain.value = Number($('#st-vol').value)),
)
$('#st-run').addEventListener('click', () => start('run'))
$('#st-grid').addEventListener('click', () => start('grid'))
$('#st-flyby').addEventListener('click', () => start('flyby'))
$('#st-rev').addEventListener('input', () => (mode = 'manual'))
$('#st-copy').addEventListener('click', () => {
  const text = `export const ENGINE_TONE = ${JSON.stringify(tone, null, 2).replace(/'(\w+)':/g, '$1:')}`
  $('#st-out').textContent = text
  navigator.clipboard?.writeText(text).catch(() => {})
})
$('#st-reset').addEventListener('click', () => {
  Object.assign(tone, ENGINE_TONE)
  for (const input of document.querySelectorAll('[data-tone]')) {
    input.value = tone[input.dataset.tone]
    input.nextElementSibling.textContent = input.value
  }
  voice?.applyTone()
  flyVoice?.applyTone()
})

function start(next) {
  if (!ctx) $('#st-power').click()
  mode = next
  modeStart = performance.now() / 1000
  car = createCar(carStats('ferrari'), 0, 0, 0)
  simAcc = 0
}

function frame(now) {
  if (!ctx) return
  requestAnimationFrame(frame)
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  const t = now / 1000 - modeStart
  let rpm = Number($('#st-rev').value)
  let throttle = Number($('#st-throttle').value)
  let gear = 1

  if (mode === 'run') {
    simAcc += dt
    const lift = t > 9
    while (simAcc >= 1 / 120) {
      stepCar(
        car,
        { steer: 0, throttle: lift ? 0 : 1, brake: lift && t < 11 ? 0.6 : 0 },
        1 / 120,
        ROAD_SURFACE,
      )
      simAcc -= 1 / 120
    }
    rpm = car.rpm
    throttle = car.throttle
    gear = car.gear
    $('#st-kmh').textContent = speedKmh(car)
    if (t > 12.5) mode = 'manual'
  } else if (mode === 'grid') {
    const blip = Math.max(0, Math.sin(t * 2.2)) ** 6
    rpm = 7500 + Math.sin(t * 3.1) * 800 + blip * 5000
    throttle = 0.4 + blip * 0.6
    if (t > 8) mode = 'manual'
  } else {
    $('#st-kmh').textContent = '-'
  }

  voice.set({ rpm, throttle, gear, volume: mode === 'flyby' ? 0.25 : 0.8 })

  if (mode === 'flyby') {
    const x = -14 + t * 7.5
    const d = Math.hypot(x, 1)
    const closing = (-x / d) * 7.5
    flyVoice.set({
      rpm: 13800,
      throttle: 1,
      gear: 7,
      volume: 0.9 / (1 + (d / 3) ** 2),
      pan: x / 5,
      pitch: Math.max(0.88, Math.min(1.12, 1 + closing * 0.012)),
    })
    if (t > 4) mode = 'manual'
  } else flyVoice.silence()

  $('#st-rpm').textContent = Math.round(rpm)
  $('#st-hz').textContent = Math.round(firingHz(rpm))
  $('#st-gear').textContent = gear
  if (mode === 'manual') $('#st-rev').value = rpm
}
