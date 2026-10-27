import type { Mind, Pulse } from '../types'

import { choose, drift, nudge, pace, RESTED, TRAITS } from './mind'
import type { Doing, Needs } from './mind'

export const TICK = 60
export const sec = (s: number) => Math.round((s * 1000) / TICK)
export const W = 10
const H = 8 // pixels, two per text row; the top two are room to jump
export const EXTRA = 4 // room for "zZz" or "..." beside him
export const ACCEL = 0.08 // cells per tick², the inertia
const SPEEDS = [0.35, 0.7, 1.1]
export const FALL_ASLEEP = sec(3) // yawn, then lie down
export const JUMP = [1, 2, 2, 2, 1] // pixels off the ground, per tick in the air
const PROMPT_PREFIX = 2 // "> "
const LEG_COLS = [1, 3, 6, 8]
const EYE_COLS = { ahead: [3, 6], left: [2, 5], right: [4, 7] }
const EAR_ROWS = { up: [0, 1], mid: [1, 2], down: [2, 3] }

export type Look = keyof typeof EYE_COLS
type Ears = keyof typeof EAR_ROWS
type Mode = 'walk' | 'idle' | 'watch' | 'wait' | 'cheer' | 'sleep'
// startle: a tool failed; curious: a prompt went out; dance: tests passed; love: a click.
export type Emote = 'startle' | 'curious' | 'dance' | 'love' | 'sit' | 'stretch' | 'wave' | 'sniff'
// offset: where this Clawd's region starts in the band, so the cursor maps into it.
export type Props = Pulse & { working: boolean; offset?: number; mind?: Mind }
type Seen = { startle: number; submit: number; dance: number }
export type State = {
  x: number; v: number; dir: 1 | -1; speed: number; goal: number | null; phase: number
  mode: Mode; left: number; step: number; air: number; look: Look; blink: number
  seq: number; quiet: number; wasWorking: boolean; distracted: boolean; reading: boolean
  emote: Emote | null; emoteLeft: number; seen: Seen
  // Who he is and what he wants; `intent` is the plan an idle pick made, `nap` a sleep he chose.
  trait: 0 | 1 | 2; needs: Needs; intent: 'play' | 'explore' | null; nap: boolean
  // at: the column the bubble was pinned to when he started talking; it stays put while he moves.
  say: { text: string; left: number; at: number } | null
}
export type Pose = {
  look: Look; eyeRow: number; shut: boolean; earL: Ears; earR: Ears
  lifted: boolean[]; lift: number; sink: number
}

export const chance = (p: number) => Math.random() < p
const between = (min: number, max: number) => min + Math.floor(Math.random() * (max - min))
const glance = (): Look => (['ahead', 'left', 'right'] as const)[between(0, 3)] ?? 'ahead'
const pick = <T,>(xs: readonly T[], fallback: T) => xs[between(0, xs.length)] ?? fallback
const every = (s: State, n: number) => Math.floor(s.step / n) % 2 === 1

// Pixel grid to half-block text: each text row is two pixel rows.
export const draw = (p: Pose): string[] => {
  const px = new Array<boolean>(W * H).fill(false)
  // Lying down sinks the body over its legs; what falls below the grid is not drawn.
  const top = H - 6 - p.lift + p.sink
  const set = (r: number, c: number, on = true) => { if (top + r < H) px[(top + r) * W + c] = on }
  for (let r = 0; r < 4; r++) for (let c = 1; c < W - 1; c++) set(r, c)
  for (const r of EAR_ROWS[p.earL]) set(r, 0)
  for (const r of EAR_ROWS[p.earR]) set(r, W - 1)
  if (!p.shut) for (const c of EYE_COLS[p.look]) set(p.eyeRow, c, false)
  LEG_COLS.forEach((c, i) => {
    set(4, c)
    if (!p.lifted[i]) set(5, c)
  })
  const at = (r: number, c: number) => px[r * W + c] === true
  return Array.from({ length: H / 2 }, (_, row) =>
    Array.from({ length: W }, (_, c) => {
      const up = at(row * 2, c)
      const down = at(row * 2 + 1, c)
      return up && down ? '█' : up ? '▀' : down ? '▄' : ' '
    }).join(''),
  )
}

// Where the cursor shows on screen: the prompt wraps a long line at about the band's width.
const cursorAt = (col: number, columns: number) => PROMPT_PREFIX + (col % Math.max(10, columns))

const walkTo = (s: State, goal: number, speed: number, distracted: boolean): State =>
  ({ ...s, mode: 'walk', goal, speed, left: sec(10), distracted })

export const hop = (s: State): State => (s.air === 0 ? { ...s, air: JUMP.length } : s)

export const emote = (s: State, e: Emote, seconds: number): State => ({ ...s, emote: e, emoteLeft: sec(seconds) })

export const tick = (s: State, p: Props, columns: number, hour = 12): State => {
  const max = Math.max(0, columns - W - EXTRA)
  const offset = p.offset ?? 0
  const cursor = cursorAt(p.col, columns + offset) - offset
  const cursorGoal = Math.min(max, Math.max(0, cursor - W / 2))

  // Motion: ease toward the wanted speed, slowing down on the way into a goal.
  const toGoal = s.goal === null ? 0 : s.goal - s.x
  const dir = s.goal === null ? s.dir : toGoal >= 0 ? 1 : -1
  const want =
    s.air > 0 ? s.v
    : s.emote === 'dance' ? (every(s, 5) ? 0.3 : -0.3)
    : s.emote !== null && s.emote !== 'curious' ? 0
    : s.mode !== 'walk' ? 0
    : s.goal === null ? dir * s.speed
    : dir * Math.min(s.speed, Math.abs(toGoal) * 0.1 + 0.03)
  let v = s.v + Math.max(-ACCEL, Math.min(ACCEL, want - s.v))
  let x = s.x + v
  let turned = dir
  if (x < 0 || x > max) {
    x = Math.min(max, Math.max(0, x))
    v = 0
    turned = -dir as 1 | -1
  }
  const blink = s.blink > 0 ? s.blink - 1 : chance(0.015 + (1 - s.needs.energy) * 0.02) ? 3 : 0
  const trait = TRAITS[s.trait]
  const doing: Doing =
    s.mode === 'sleep' ? 'sleep' : s.emote === 'sit' ? 'sit' : Math.abs(s.v) > 0.03 ? 'move' : s.mode === 'watch' ? 'watch' : 'still'
  let needs = drift(s.needs, doing, Math.abs(s.v), trait, hour, p.mind?.gloom ?? 0)
  const air = s.air > 0 ? s.air - 1 : 0
  const emoteLeft = Math.max(0, s.emoteLeft - 1)
  let base: State = {
    ...s, x, v, dir: turned, air, blink, step: s.step + 1,
    phase: s.phase + Math.abs(v) * 0.45, wasWorking: p.working,
    emoteLeft, emote: emoteLeft > 0 ? s.emote : null,
    seen: { startle: p.startle, submit: p.submit, dance: p.dance },
    say: s.say && s.say.left > 1 ? { ...s.say, left: s.say.left - 1 } : null,
  }

  // Events from the session, newest wins.
  const woke = (st: State): State => (st.mode === 'sleep' ? { ...st, mode: 'idle', left: sec(1), quiet: 0 } : st)
  if (p.startle > s.seen.startle) {
    base = woke(hop(emote({ ...base, v: 0, goal: null }, 'startle', 1)))
    needs = nudge(needs, { mood: -0.35 })
  }
  if (p.submit > s.seen.submit) {
    base = woke(hop(emote(base, 'curious', 2)))
    needs = nudge(needs, { curiosity: 0.2, boredom: -0.2 })
  }
  if (p.dance > s.seen.dance) {
    base = woke(hop(emote(base, 'dance', 3)))
    needs = nudge(needs, { mood: 0.4 })
  }
  if (s.wasWorking && !p.working) needs = nudge(needs, { mood: 0.25, boredom: -0.3 })
  base = { ...base, needs }
  if (base.emote === 'dance' && s.step % 10 === 0) base = hop(base)

  if (s.wasWorking && !p.working) return { ...base, quiet: 0, mode: 'cheer', left: sec(2), goal: null, reading: false }
  if (p.working && s.mode !== 'cheer') {
    // A tool running: he waits, tapping a foot. The model writing: he reads, eyes up.
    const reading = p.tools === 0
    const look = s.mode !== 'wait' ? 'ahead' : chance(reading ? 0.04 : 0.02) ? glance() : s.look
    return { ...base, quiet: 0, mode: 'wait', look, goal: null, reading }
  }

  const typed = p.seq !== s.seq
  const quiet = typed ? 0 : s.quiet + 1
  const typing = quiet < sec(3)
  const next = { ...base, seq: p.seq, quiet, left: s.left - 1, reading: false }

  // Typing wakes him reluctantly: rested, he stretches and gets up; worn out, he sleeps on.
  if (typed && s.mode === 'sleep') {
    if (needs.energy < 0.5) return next
    return emote({ ...next, mode: 'idle', nap: false, left: sec(1.5) }, 'stretch', 1.2)
  }
  if (typed && !s.distracted && (s.mode === 'idle' || (s.mode === 'walk' && s.goal === null))) {
    return { ...next, mode: 'watch' as const, goal: null }
  }
  if (s.mode === 'sleep') {
    if (!s.nap || needs.energy < 0.95) return next
    return emote({ ...next, mode: 'idle', nap: false, left: sec(1.5) }, 'stretch', 1.2)
  }
  if (quiet > sec(180)) return { ...next, mode: 'sleep', goal: null, left: FALL_ASLEEP, emote: null }
  if (s.mode === 'cheer') {
    if (next.left <= 0) return { ...next, mode: 'idle', left: sec(1) }
    return s.step % 9 === 0 ? hop(next) : next
  }

  if (s.mode === 'watch') {
    if (!typing) return { ...next, mode: 'idle', left: between(sec(1), sec(3)) }
    // Now and then he wanders off for a look around, then comes back.
    if (chance(0.006)) return walkTo(next, between(0, max + 1), pick(SPEEDS, 0.7), true)
    if (Math.abs(cursorGoal - x) > 15 && chance(0.03)) return walkTo(next, cursorGoal, 0.8, false)
    const look: Look = cursor < x + 2 ? 'left' : cursor > x + W - 3 ? 'right' : 'ahead'
    return { ...next, look }
  }

  if (s.mode === 'walk') {
    const arrived = s.goal !== null && Math.abs(toGoal) < 0.5 && Math.abs(v) < 0.05
    if (!arrived && next.left > 0) {
      const walking = { ...next, look: (v >= 0 ? 'right' : 'left') as Look }
      return chance(0.004) ? hop(walking) : walking
    }
    if (typing && !s.distracted) return { ...next, mode: 'watch', goal: null, intent: null }
    const stopped = { ...next, mode: 'idle' as const, goal: null, left: between(sec(0.5), sec(2.5)), look: 'ahead' as const }
    // Got where curiosity led him: a good long sniff at the ground.
    if (s.intent === 'explore') return emote({ ...stopped, intent: null, left: sec(2), needs: nudge(needs, { curiosity: -0.4 }) }, 'sniff', 2)
    return chance(0.3) ? hop(stopped) : stopped
  }

  // idle: fidgets now and then
  if (next.left > 0) {
    if (next.emote === null) {
      if (chance(0.006)) return emote({ ...next, left: next.left + sec(2.5) }, 'sit', 2.5)
      if (chance(0.004)) return emote({ ...next, left: next.left + sec(1.2) }, 'stretch', 1.2)
      if (chance(0.004)) return emote({ ...next, left: next.left + sec(1.5) }, 'wave', 1.5)
    }
    return { ...next, look: chance(0.05) ? glance() : s.look }
  }
  if (typing) {
    const back = { ...next, distracted: false }
    return Math.abs(cursorGoal - x) > 15 ? walkTo(back, cursorGoal, 0.7, false) : { ...back, mode: 'watch' }
  }
  const speed = pick(SPEEDS, 0.7) * pace(needs, trait)
  switch (choose(needs, trait)) {
    case 'nap': return { ...next, mode: 'sleep', nap: true, goal: null, left: FALL_ASLEEP, emote: null, intent: null }
    case 'sit': return emote({ ...next, left: sec(2 + trait.lazy * 8), intent: null }, 'sit', 2 + trait.lazy * 8)
    case 'hop': return { ...hop(next), left: sec(1), intent: null }
    case 'play': return { ...next, left: sec(2), intent: 'play' }
    case 'explore': return { ...walkTo(next, between(0, max + 1), speed, false), intent: 'explore' }
    case 'wander': return {
      ...next, mode: 'walk', goal: null, left: between(sec(0.6), sec(3)), distracted: false, intent: null,
      dir: chance(0.5) ? s.dir : (-s.dir as 1 | -1), speed,
    }
  }
}

export const pose = (s: State): Pose => {
  const moving = Math.abs(s.v) > 0.03
  // Falling asleep: a yawn with ears stretched up, then he sinks down onto his belly.
  const dozed = s.mode === 'sleep' ? FALL_ASLEEP - s.left : 0
  const yawning = s.mode === 'sleep' && dozed < sec(1.2)
  const sink =
    s.emote === 'sit' ? 1
    : s.mode !== 'sleep' || yawning ? 0
    : dozed < sec(2) ? 1 : 2
  const lifted = [0, 1, 2, 3].map(i =>
    s.air > 0 ? true
    : s.emote === 'dance' ? (i % 2 === 0) === every(s, 4)
    : moving ? (i % 2 === 0) === (Math.floor(s.phase) % 2 === 1)
    : s.mode === 'wait' && !s.reading && i === 3 && every(s, 8),
  )
  const both: Ears =
    s.emote === 'startle' || s.emote === 'love' || s.emote === 'stretch' || yawning ? 'up'
    : s.mode === 'cheer' ? (every(s, 3) ? 'up' : 'mid')
    : s.air > 0 || (s.mode === 'walk' && s.speed >= 1) ? 'up'
    : s.mode === 'sleep' || s.quiet > sec(60) || s.needs.mood < -0.25 || s.needs.energy < 0.25 ? 'down'
    : s.needs.mood > 0.45 ? 'up'
    : 'mid'
  const earL: Ears = s.emote === 'dance' ? (every(s, 4) ? 'up' : 'down') : both
  const earR: Ears =
    s.emote === 'dance' ? (every(s, 4) ? 'down' : 'up')
    : s.emote === 'wave' ? (every(s, 2) ? 'up' : 'mid')
    : both
  const eyeRow = s.mode === 'watch' || s.emote === 'curious' || s.emote === 'sniff' ? 2 : s.reading ? 0 : 1
  return {
    look: s.look, eyeRow, earL, earR, lifted, sink,
    shut: s.mode === 'sleep' || s.emote === 'stretch' || s.blink > 0,
    lift: s.air > 0 ? (JUMP[JUMP.length - s.air] ?? 0) : 0,
  }
}

const SIDE: Record<Emote, string[]> = {
  startle: ['!'], curious: ['?'], dance: ['♪', '♫'], love: ['♥'], sit: [''], stretch: [''], wave: [''], sniff: ['', '·'],
}
export const side = (s: State) =>
  s.say !== null ? `‹${s.say.text}›`
  : s.emote !== null ? (SIDE[s.emote][Math.floor(s.step / 6) % SIDE[s.emote].length] ?? '')
  : s.mode === 'sleep' && s.left <= 0 ? ['z', 'zZ', 'zZz', ''][Math.floor(s.step / 12) % 4]
  : s.mode === 'wait' && !s.reading ? '.'.repeat((Math.floor(s.step / 8) % 3) + 1)
  : ''

export const born = (p: Props, trait: 0 | 1 | 2 = 0): State => ({
  trait, needs: RESTED, intent: null, nap: false, say: null,
  x: 0, v: 0, dir: 1, speed: 0.7, goal: null, phase: 0, mode: 'idle', left: sec(1), step: 0, air: 0,
  look: 'ahead', blink: 0, seq: p.seq, quiet: 0, wasWorking: p.working, distracted: false, reading: false,
  emote: null, emoteLeft: 0, seen: { startle: p.startle, submit: p.submit, dance: p.dance },
})
