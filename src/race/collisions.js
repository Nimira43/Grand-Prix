import { PHYS, wrapAngle } from './carPhysics.js'

const R = 0.1
const OFF = 0.095
const RESTITUTION = 0.25
const CONTACT_SCRUB = 0.05

const circles = (c) => {
  const cx = Math.cos(c.heading) * OFF
  const cy = Math.sin(c.heading) * OFF
  return [
    [c.x + cx, c.y + cy],
    [c.x - cx, c.y - cy],
  ]
}

export function resolveCollisions(cars, onHit) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i]
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j]
      if (Math.abs(a.x - b.x) > 0.45 || Math.abs(a.y - b.y) > 0.45) continue

      let best = null
      for (const pa of circles(a)) {
        for (const pb of circles(b)) {
          const dx = pb[0] - pa[0]
          const dy = pb[1] - pa[1]
          const d = Math.hypot(dx, dy)
          if (d < 2 * R && (!best || d < best.d)) best = { d, dx, dy }
        }
      }
      if (!best) continue
      const d = best.d || 1e-6
      const nx = best.dx / d
      const ny = best.dy / d
      const pen = 2 * R - d
      a.x -= (nx * pen) / 2
      a.y -= (ny * pen) / 2
      b.x += (nx * pen) / 2
      b.y += (ny * pen) / 2

      let vax = Math.cos(a.travel) * a.speed
      let vay = Math.sin(a.travel) * a.speed
      let vbx = Math.cos(b.travel) * b.speed
      let vby = Math.sin(b.travel) * b.speed
      const rel = (vbx - vax) * nx + (vby - vay) * ny
      if (rel >= 0) continue
      const jImp = (-(1 + RESTITUTION) * rel) / 2
      vax -= jImp * nx
      vay -= jImp * ny
      vbx += jImp * nx
      vby += jImp * ny
      const impact = -rel
      setVelocity(a, vax, vay, impact)
      setVelocity(b, vbx, vby, impact)
      onHit?.(a, b, impact)
    }
  }
}

function setVelocity(car, vx, vy, impact) {
  const speed = Math.hypot(vx, vy)
  car.speed = Math.max(0, speed * (1 - CONTACT_SCRUB * impact))
  if (speed > 0.05) car.travel = Math.atan2(vy, vx)
  if (!car.spin) {
    const slip = wrapAngle(car.heading - car.travel)
    if (Math.abs(slip) > PHYS.maxSlip)
      car.heading = wrapAngle(car.travel + Math.sign(slip) * PHYS.maxSlip)
  }
  car.contact = Math.max(car.contact ?? 0, Math.min(1, impact / 2))
}
