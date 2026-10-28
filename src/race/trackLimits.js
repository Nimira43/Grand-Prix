export const LIMITS = {
  minorSkip: 0.5,
  majorSkip: 2,
  warnings: 3,
  minorPenalty: 5,
  majorPenalty: 10,
  rejoined: 0.5,
  maxOff: 20,
}

export class TrackLimits {
  constructor() {
    this.off = null
    this.warnings = 0
    this.penalty = 0
    this.offences = []
  }

  update(e, line, time, dt, judge) {
    const car = e.car
    if (!this.off) {
      if (car.grassFrac >= 1) this.off = { idx: e.idx, driven: 0, time }
      return null
    }
    this.off.driven += car.speed * dt
    if (time - this.off.time > LIMITS.maxOff) {
      this.off = null
      return null
    }
    if (car.grassFrac > LIMITS.rejoined) return null

    const { n, step } = line
    let along = ((e.idx - this.off.idx + n) % n) * step
    if (along > (n * step) / 2) along -= n * step
    const skipped = along - this.off.driven
    this.off = null
    if (skipped < LIMITS.minorSkip) return null

    const major = skipped >= LIMITS.majorSkip
    this.offences.push({ kind: major ? 'cut' : 'limits', skipped, time })
    if (!judge) return { kind: 'invalid', skipped }
    if (major) {
      this.penalty += LIMITS.majorPenalty
      return { kind: 'cut', seconds: LIMITS.majorPenalty, skipped }
    }
    this.warnings++
    if (this.warnings > LIMITS.warnings) {
      this.warnings = 0
      this.penalty += LIMITS.minorPenalty
      return { kind: 'penalty', seconds: LIMITS.minorPenalty, skipped }
    }
    return {
      kind: this.warnings === LIMITS.warnings ? 'final' : 'warning',
      warnings: this.warnings,
      skipped,
    }
  }
}
