export const ROAD_WIDTH = 0.62
export const START_WIDTH = 1.3
export const TILE_METRES = 24

function line(a, b, n = 6) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return pts
}

function arc(cx, cy, r, a0, a1, n) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n)
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return pts
}

function cubic(p0, p1, p2, p3, n) {
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const mt = 1 - t
    const a = mt * mt * mt
    const b = 3 * mt * mt * t
    const c = 3 * mt * t * t
    const d = t * t * t
    pts.push([
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ])
  }
  return pts
}

function filleted(points, radius, perCorner = 14) {
  const out = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const [ax, ay] = points[i - 1]
    const [bx, by] = points[i]
    const [cx, cy] = points[i + 1]
    let ux = bx - ax,
      uy = by - ay
    let vx = cx - bx,
      vy = cy - by
    const lu = Math.hypot(ux, uy),
      lv = Math.hypot(vx, vy)
    ux /= lu
    uy /= lu
    vx /= lv
    vy /= lv
    const theta = Math.acos(Math.max(-1, Math.min(1, ux * vx + uy * vy)))
    const t = Math.min(radius * Math.tan(theta / 2), lu * 0.45, lv * 0.45)
    const p1 = [bx - ux * t, by - uy * t]
    const p2 = [bx + vx * t, by + vy * t]
    for (let k = 0; k <= perCorner; k++) {
      const s = k / perCorner
      const ms = 1 - s
      out.push([
        ms * ms * p1[0] + 2 * ms * s * bx + s * s * p2[0],
        ms * ms * p1[1] + 2 * ms * s * by + s * s * p2[1],
      ])
    }
  }
  out.push(points[points.length - 1])
  return out
}

const HALF_PI = Math.PI / 2

const port = (x, y, dx, dy) => ({ x, y, dx, dy })

export const PIECES = {
  straight: {
    label: 'Straight',
    key: '1',
    w: 1,
    h: 1,
    kerbs: false,
    ports: [port(0, 0.5, -1, 0), port(1, 0.5, 1, 0)],
    path: line([0, 0.5], [1, 0.5]),
  },
  tight: {
    label: 'Tight corner',
    key: '2',
    w: 1,
    h: 1,
    kerbs: true,
    ports: [port(0, 0.5, -1, 0), port(0.5, 1, 0, 1)],
    path: arc(0, 1, 0.5, -HALF_PI, 0, 16),
  },
  medium: {
    label: 'Medium corner',
    key: '3',
    w: 2,
    h: 2,
    kerbs: true,
    ports: [port(0, 0.5, -1, 0), port(1.5, 2, 0, 1)],
    path: arc(0, 2, 1.5, -HALF_PI, 0, 28),
  },
  sweep: {
    label: 'Sweeping corner',
    key: '4',
    w: 3,
    h: 3,
    kerbs: true,
    ports: [port(0, 0.5, -1, 0), port(2.5, 3, 0, 1)],
    path: arc(0, 3, 2.5, -HALF_PI, 0, 40),
  },
  diagonal: {
    label: 'Diagonal corner',
    key: '5',
    w: 3,
    h: 3,
    kerbs: true,
    ports: [port(0, 0.5, -1, 0), port(2.5, 3, 0, 1)],
    path: filleted(
      [
        [0, 0.5],
        [0.9, 0.5],
        [2.5, 2.1],
        [2.5, 3],
      ],
      0.7,
    ),
  },
  sbend: {
    label: 'S-bend',
    key: '6',
    w: 3,
    h: 2,
    kerbs: true,
    flippable: true,
    ports: [port(0, 1.5, -1, 0), port(3, 0.5, 1, 0)],
    path: cubic([0, 1.5], [1.5, 1.5], [1.5, 0.5], [3, 0.5], 32),
  },
  start: {
    label: 'Start straight',
    key: '7',
    w: 10,
    h: 3,
    kerbs: false,
    unique: true,
    ports: [port(0, 1.5, -1, 0), port(10, 1.5, 1, 0)],
    path: line([0, 1.5], [10, 1.5], 20),
  },
}

export const PIECE_ORDER = [
  'straight',
  'tight',
  'medium',
  'sweep',
  'diagonal',
  'sbend',
  'start',
]

export const START_LAYOUT = {
  finishU: 8.5,
  taperIn: 1,
  taperOut: 9,
  pitLane: [
    [1.0, 1.05],
    [1.7, 0.5],
    [8.3, 0.5],
    [9.0, 1.05],
  ],
  pitWall: [
    [1.85, 0.75],
    [8.15, 0.75],
  ],
  gridSlots: Array.from({ length: 22 }, (_, k) => [
    8.5 - 0.42 - k * 0.33,
    1.5 + (k % 2 === 0 ? -0.28 : 0.28),
  ]),
}

export function footprint(type, rot) {
  const d = PIECES[type]
  return rot % 2 ? { w: d.h, h: d.w } : { w: d.w, h: d.h }
}

export function makeXform(type, rot, mirror, ox = 0, oy = 0) {
  const d = PIECES[type]
  return (u, v) => {
    let w = d.w
    let h = d.h
    if (mirror) u = w - u
    for (let i = 0; i < rot; i++) {
      const nu = h - v
      v = u
      u = nu
      const t = w
      w = h
      h = t
    }
    return [u + ox, v + oy]
  }
}

export function xformDir(dx, dy, rot, mirror) {
  if (mirror) dx = -dx
  for (let i = 0; i < rot; i++) {
    const ndx = -dy
    dy = dx
    dx = ndx
  }
  return [dx + 0, dy + 0]
}

export function localMatrix(piece) {
  const xf = makeXform(piece.type, piece.rot, piece.mirror, piece.x, piece.y)
  const o = xf(0, 0)
  const ex = xf(1, 0)
  const ey = xf(0, 1)
  return [ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]]
}

export function pieceGeometry(piece) {
  const d = PIECES[piece.type]
  const xf = makeXform(piece.type, piece.rot, piece.mirror, piece.x, piece.y)
  const ports = d.ports.map((p) => {
    const [x, y] = xf(p.x, p.y)
    const [dx, dy] = xformDir(p.dx, p.dy, piece.rot, piece.mirror)
    return { x, y, dx, dy }
  })
  const path = d.path.map(([u, v]) => xf(u, v))
  return { ports, path, xf }
}

export const portKey = (p) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`
