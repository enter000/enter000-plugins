import type { Pose, State } from './clawd'

// The same Clawd and the same behaviour, drawn in quadrant blocks: 2×2 pixels per cell,
// so he leans, bends his legs and moves his eyes by half a cell at a time.
const W = 20 // pixels, two per cell
const H = 8 // pixels, two per text row; the top two are room to jump
const EYES = { ahead: [6, 12], left: [5, 11], right: [7, 13] }
const EAR_ROWS = { up: [0, 1], mid: [1, 2], down: [2, 3] }
const LEG_COLS = [2, 6, 12, 16] // each leg two pixels wide, as wide as an eye or an ear
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

export const drawHd = (p: Pose, lean: number, dir: 1 | -1): string[] => {
  const px = new Array<boolean>(W * H).fill(false)
  const top = H - 6 - p.lift + p.sink
  // Leaning shears the body: the top row moves the most, the feet stay put.
  const shear = (r: number) => (r < 4 ? Math.round((lean * (4 - r)) / 4) : 0)
  const set = (r: number, c: number, on = true) => {
    const x = c + shear(r)
    if (top + r < H && top + r >= 0 && x >= 0 && x < W) px[(top + r) * W + x] = on
  }
  for (let r = 0; r < 4; r++) for (let c = 2; c < W - 2; c++) set(r, c)
  for (const r of EAR_ROWS[p.earL]) { set(r, 0); set(r, 1) }
  for (const r of EAR_ROWS[p.earR]) { set(r, W - 2); set(r, W - 1) }
  if (!p.shut) for (const c of EYES[p.look]) { set(p.eyeRow, c, false); set(p.eyeRow, c + 1, false) }
  LEG_COLS.forEach((c, i) => {
    set(4, c); set(4, c + 1)
    // A lifted leg bends back by half its width, away from where he is going.
    if (!p.lifted[i]) { set(5, c); set(5, c + 1) }
    else if (p.lift === 0) { set(5, c - dir); set(5, c + 1 - dir) }
  })
  const at = (r: number, c: number) => (px[r * W + c] === true ? 1 : 0)
  return Array.from({ length: H / 2 }, (_, row) =>
    Array.from({ length: W / 2 }, (_, cell) => {
      const r = row * 2
      const c = cell * 2
      const bits = at(r, c) | (at(r, c + 1) << 1) | (at(r + 1, c) << 2) | (at(r + 1, c + 1) << 3)
      return QUADRANTS[bits] ?? ' '
    }).join(''),
  )
}

export const lean = (s: State) => Math.max(-2, Math.min(2, Math.round(s.v * 2)))
