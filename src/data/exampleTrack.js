const straights = (xs, ys, rot) =>
  xs.flatMap((x) =>
    ys.map((y) => ({ type: 'straight', x, y, rot, mirror: false })),
  )

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

export const EXAMPLE_TRACK = {
  format: 'grand-prix-track',
  version: 1,
  name: 'Ashcombe Park',
  laps: 8,
  cols: 60,
  rows: 40,
  pieces: [
    { type: 'start', x: 10, y: 4, rot: 0, mirror: false },
    ...straights(range(20, 25), [5], 0),
    { type: 'diagonal', x: 26, y: 5, rot: 0, mirror: false },
    ...straights([28], range(8, 10), 1),
    { type: 'sweep', x: 26, y: 11, rot: 1, mirror: false },
    ...straights(range(14, 25), [13], 0),
    { type: 'sbend', x: 11, y: 13, rot: 0, mirror: false },
    ...straights(range(9, 10), [14], 0),
    { type: 'tight', x: 8, y: 14, rot: 2, mirror: false },
    ...straights([8], range(7, 13), 1),
    { type: 'medium', x: 8, y: 5, rot: 3, mirror: false },
  ],
}
