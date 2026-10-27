import type { ClientModule } from 'claude-code'

import { ACCEL, born, chance, draw, emote, EXTRA, FALL_ASLEEP, hop, JUMP, pose, sec, side, tick, TICK, W } from './clawd'
import type { Look, Props, State } from './clawd'
import type { Order } from '../types'
import { drawHd, lean } from './clawd-hd'
import { nudge } from './mind'

// Two Clawds in one band: the classic one and the finer one. Each lives by his own
// tick; on top of that they notice each other, say hello, play tag and copy jumps.
type Game = { kind: 'greet' | 'chase' | 'leap'; it: 0 | 1; left: number } | null
// seen: the welcome and thought counters already acted on.
type Pair = { pals: [State, State]; game: Game; cooldown: number; seen: { welcome: number; thought: number; order: number } }
export type Outcome = { winner: 0 | 1 } | null

const COLOR = '#D97757'

// How he is doing, in a few words for the model that writes their remarks.
export const feeling = (s: State): string => {
  const n = s.needs
  const mood = n.mood > 0.45 ? 'весёлый' : n.mood < -0.25 ? 'понурый' : 'спокойный'
  const energy = n.energy < 0.25 ? ', выдохся' : n.energy < 0.5 ? ', подустал' : ''
  const want = n.social > 0.7 ? ', скучает по другу' : n.boredom > 0.7 ? ', скучает' : n.curiosity > 0.7 ? ', любопытствует' : ''
  const doing =
    s.mode === 'sleep' ? 'спит' : s.mode === 'watch' ? 'смотрит, как человек печатает' : s.mode === 'wait' ? 'ждёт агента'
    : s.emote === 'sit' ? 'сидит' : s.emote === 'sniff' ? 'что-то обнюхивает' : s.mode === 'walk' ? 'гуляет' : 'стоит'
  return `${doing}, ${mood}${energy}${want}`
}

// Free to play: not watching the prompt, not waiting on the agent, not asleep, not busy with a feeling.
const free = (s: State) => (s.mode === 'idle' || s.mode === 'walk') && s.emote === null && s.goal === null
const stop = (s: State): State => ({ ...s, mode: 'idle', v: 0, goal: null, left: sec(2) })
const toward = (s: State, other: State): Look => (other.x > s.x ? 'right' : 'left')

// Long enough to read: three seconds and a bit per word, nine at most.
// Where he will stand once inertia runs out: v²/2a further on. The bubble is pinned there.
const stopsAt = (s: State) => Math.round(s.x + (s.v * Math.abs(s.v)) / (2 * ACCEL))
const readTime = (text: string) => sec(Math.min(9, 3 + text.length / 15))

// Carry out an order; the replies show at once, one bubble each.
export const obey = (pair: Pair, order: Order, columns: number, cursor: number): Pair => {
  const max = Math.max(0, columns - W - EXTRA)
  const go = (s: State, goal: number): State =>
    ({ ...s, mode: 'walk', goal: Math.min(max, Math.max(0, goal)), speed: 1.1, left: sec(10), distracted: true, intent: null, emote: null })
  const middle = Math.round(max / 2)
  const act = (s: State, i: 0 | 1): State => {
    switch (order.action) {
      case 'corners': return go(s, i === 0 ? 0 : max)
      case 'together': return go(s, middle + (i === 0 ? -6 : 6))
      case 'come': return go(s, cursor - W / 2 + (i === 0 ? -6 : 6))
      case 'sleep': return { ...s, mode: 'sleep', nap: true, goal: null, left: FALL_ASLEEP, emote: null, needs: { ...s.needs, energy: 0.3 } }
      case 'dance': return hop(emote({ ...s, mode: 'idle', goal: null, left: sec(4) }, 'dance', 4))
      case 'jump': return hop({ ...s, mode: 'idle', goal: null, left: sec(1) })
      case 'sit': return emote({ ...s, mode: 'idle', goal: null, left: sec(6) }, 'sit', 6)
      case 'chase': return { ...s, mode: 'idle', goal: null, left: sec(2), intent: i === 0 ? 'play' : null, emote: null }
      case 'wander': return { ...s, mode: 'idle', goal: null, left: 0, distracted: false }
      case 'refuse': return emote({ ...s, mode: 'idle', goal: null, left: sec(2) }, 'startle', 1)
    }
  }
  let pals = pair.pals.map((s, i) => (order.who === 2 || order.who === i ? act(s, i as 0 | 1) : s)) as [State, State]
  for (const reply of order.replies) {
    pals[reply.who] = { ...pals[reply.who], say: { text: reply.text, left: readTime(reply.text), at: stopsAt(pals[reply.who]) } }
  }
  return { ...pair, pals, game: null, cooldown: order.action === 'chase' ? 0 : sec(10), seen: { ...pair.seen, order: order.id } }
}

export const social = (pair: Pair, columns: number, report: (winner: 0 | 1) => void = () => {}): Pair => {
  let [a, b] = pair.pals
  let game = pair.game
  let cooldown = Math.max(0, pair.cooldown - 1)
  const gap = Math.abs(b.x - a.x) - W
  const max = Math.max(0, columns - W - EXTRA)

  if (game?.kind === 'chase') {
    const itIndex = game.it
    let it = itIndex === 0 ? a : b
    let runner = itIndex === 0 ? b : a
    if (gap < 1) {
      it = hop(emote({ ...stop(it), needs: nudge(it.needs, { mood: 0.3, social: -0.6 }) }, 'love', 1.5))
      runner = hop(emote({ ...stop(runner), needs: nudge(runner.needs, { mood: -0.1, social: -0.6 }) }, 'startle', 1))
      report(itIndex)
      game = null
      cooldown = sec(15)
    } else if (game.left <= 0 || it.mode !== 'walk') {
      // Got away: the runner is pleased with himself.
      runner = { ...runner, needs: nudge(runner.needs, { mood: 0.2, social: -0.4 }) }
      it = { ...it, needs: nudge(it.needs, { social: -0.3 }) }
      game = null
      cooldown = sec(8)
    } else {
      // Aim at the runner himself: the catch comes a body's length before that, at full speed.
      const goal = runner.x
      it = { ...it, mode: 'walk', goal, speed: 1.1, left: sec(10), look: toward(it, runner) }
      game = { ...game, left: game.left - 1 }
    }
    ;[a, b] = itIndex === 0 ? [it, runner] : [runner, it]
  } else if (game?.kind === 'greet') {
    a = { ...a, look: toward(a, b) }
    b = { ...b, look: toward(b, a) }
    if (game.left === sec(0.7)) {
      a = hop(a)
      b = hop(b)
    }
    game = game.left > 0 ? { ...game, left: game.left - 1 } : null
    if (game === null) {
      cooldown = sec(12)
      a = { ...a, needs: nudge(a.needs, { social: -0.4, mood: 0.1 }) }
      b = { ...b, needs: nudge(b.needs, { social: -0.4, mood: 0.1 }) }
    }
  } else if (game?.kind === 'leap') {
    // Held at the top of the jump till he is over; the jump's own tail lands him.
    const aloft = (s: State): State => ({ ...s, air: Math.max(s.air, JUMP.length - 1) })
    if (game.it === 0) a = aloft(a)
    else b = aloft(b)
    game = game.left > 0 ? { ...game, left: game.left - 1 } : null
  } else if (cooldown === 0 && (free(a) || a.intent === 'play') && (free(b) || b.intent === 'play')) {
    if (gap < 3) {
      a = emote({ ...stop(a), look: toward(a, b) }, 'wave', 1.5)
      b = emote({ ...stop(b), look: toward(b, a) }, 'wave', 1.5)
      game = { kind: 'greet', it: 0, left: sec(1.5) }
    } else if (a.intent === 'play' || b.intent === 'play') {
      // Whoever felt like playing starts it, and he is "it".
      const itIndex = a.intent === 'play' ? 0 : 1
      const it = itIndex === 0 ? a : b
      const runner = itIndex === 0 ? b : a
      const away = runner.x > it.x ? max : 0
      const fleeing = { ...runner, mode: 'walk' as const, goal: away, speed: 0.7, left: sec(10), intent: null }
      const chaser = { ...it, intent: null, mode: 'walk' as const, goal: runner.x, speed: 1.1, left: sec(10) }
      ;[a, b] = itIndex === 0 ? [chaser, fleeing] : [fleeing, chaser]
      game = { kind: 'chase', it: itIndex, left: sec(6) }
    } else if (gap < 15 && chance(0.02)) {
      a = { ...a, look: toward(a, b) }
      b = { ...b, look: toward(b, a) }
    }
  }

  // Monkey see, monkey do: a jump sometimes sets off the other one.
  if (a.air === JUMP.length && b.air === 0 && free(b) && chance(0.3)) b = hop(b)
  else if (b.air === JUMP.length && a.air === 0 && free(a) && chance(0.3)) a = hop(a)

  // Walking into each other with nothing to play: the one heading in turns around.
  if (game === null && gap < 1) {
    if (a.mode === 'walk' && a.goal === null && (b.x - a.x) * a.dir > 0) a = { ...a, dir: -a.dir as 1 | -1, v: 0 }
    if (b.mode === 'walk' && b.goal === null && (a.x - b.x) * b.dir > 0) b = { ...b, dir: -b.dir as 1 | -1, v: 0 }
  }

  // A sleeper across the way to his goal: he leaps over; a goal right at the sleeper, he stops short.
  if (game === null && gap < 1) {
    const over = (s: State, sleeper: State): { s: State; ticks: number } | null => {
      if (s.mode !== 'walk' || s.goal === null || s.air > 0 || sleeper.mode !== 'sleep') return null
      const side = Math.sign(sleeper.x - s.x) || 1
      if ((s.goal - s.x) * side <= 0) return null
      if ((s.goal - sleeper.x) * side <= W) return { s: stop(s), ticks: 0 }
      const speed = 1.5
      return { s: { ...hop(s), v: side * speed }, ticks: Math.max(0, Math.ceil((Math.abs(sleeper.x - s.x) + W + 1) / speed) - JUMP.length) }
    }
    const leapA = over(a, b)
    const leapB = leapA ? null : over(b, a)
    if (leapA) a = leapA.s
    if (leapB) b = leapB.s
    const leap = leapA ?? leapB
    if (leap && leap.ticks > 0) game = { kind: 'leap', it: leapA ? 0 : 1, left: leap.ticks }
  }

  // Personal space: standing in each other (both after the cursor, say), they edge apart; a sleeper is not shoved.
  const overlap = W + 1 - Math.abs(b.x - a.x)
  if (game?.kind !== 'chase' && overlap > 0 && a.air === 0 && b.air === 0) {
    const push = Math.min(0.4, overlap / 2)
    const side = b.x >= a.x ? 1 : -1
    const pushA = a.mode === 'sleep' ? 0 : b.mode === 'sleep' ? push * 2 : push
    const pushB = b.mode === 'sleep' ? 0 : a.mode === 'sleep' ? push * 2 : push
    a = { ...a, x: Math.min(max, Math.max(0, a.x - pushA * side)) }
    b = { ...b, x: Math.min(max, Math.max(0, b.x + pushB * side)) }
  }

  return { ...pair, pals: [a, b], game, cooldown }
}

type Cell = { ch: string; dim: boolean } | null

// Sprites paint their ink only; a mark is opaque, its spaces included, so nothing shows through the words.
const paint = (line: Cell[], x: number, text: string, dim: boolean, opaque = false) => {
  Array.from(text).forEach((ch, i) => {
    if ((opaque || ch !== ' ') && x + i >= 0 && x + i < line.length) line[x + i] = { ch, dim }
  })
}

type Span = { row: number; from: number; to: number }
const clash = (a: Span, b: Span) => a.row === b.row && a.from < b.to && b.from < a.to

// Beside him on the right, then on the left, then over his head: the first spot that fits on screen
// and covers neither Clawd nor the other's words; failing that, the first that fits.
// A long remark goes on two lines, broken at the space nearest the middle.
export const wrap = (text: string, max = 60): string[] => {
  const chars = Array.from(text)
  if (chars.length <= max) return [text]
  const mid = Math.floor(chars.length / 2)
  let cut = mid
  for (let d = 0; d < mid; d++) {
    if (chars[mid + d] === ' ') { cut = mid + d; break }
    if (chars[mid - d] === ' ') { cut = mid - d; break }
  }
  return [chars.slice(0, cut).join('').trim(), chars.slice(cut).join('').trim()]
}

// Two lines sit on the two top rows, beside him on the right or else on the left.
export const placeBubble = (x: number, length: number, width: number, taken: Span[]): Span[] => {
  const spots = [x + W + 1, x - length - 1].map(from => [0, 1].map(row => ({ row, from, to: from + length })))
  const fits = spots.filter(([top]) => top!.from >= 0 && top!.to <= width)
  return fits.find(spot => !spot.some(s => taken.some(t => clash(t, s)))) ?? fits[0] ?? spots[0]!
}

export const placeMark = (x: number, length: number, width: number, taken: Span[]): Span => {
  const spots: Span[] = [
    { row: 1, from: x + W + 1, to: x + W + 1 + length },
    { row: 1, from: x - length - 1, to: x - 1 },
    { row: 0, from: x + Math.floor((W - length) / 2), to: x + Math.floor((W - length) / 2) + length },
  ].map(spot => (spot.row === 0 ? { ...spot, from: Math.max(0, Math.min(width - length, spot.from)), to: Math.max(0, Math.min(width - length, spot.from)) + length } : spot))
  const fits = spots.filter(spot => spot.from >= 0 && spot.to <= width)
  return fits.find(spot => !taken.some(t => clash(t, spot))) ?? fits[0] ?? spots[0]!
}

const latest: { props: Props | null } = { props: null }

const Clawds: ClientModule<Props, Pair> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest.props = props

  if (surface.state === undefined) {
    surface.setState({
      pals: [born(props, 0), { ...born(props, 1), x: 40, dir: -1 }], game: null, cooldown: sec(5),
      seen: { welcome: props.mind?.welcome ?? 0, thought: props.mind?.thought?.id ?? 0, order: props.mind?.order?.id ?? 0 },
    })
    surface.every(TICK, () => {
      const pair = surface.state!
      const p = latest.props ?? props
      const hour = new Date().getHours()
      let pals: [State, State] = [tick(pair.pals[0], p, surface.columns, hour), tick(pair.pals[1], p, surface.columns, hour)]
      const seen = { ...pair.seen }
      // Back after hours away: both perk up, look at each other and jump for joy.
      if ((p.mind?.welcome ?? 0) > seen.welcome) {
        seen.welcome = p.mind?.welcome ?? 0
        pals = pals.map(s => hop(emote({ ...s, mode: 'idle', left: sec(2), quiet: 0, needs: nudge(s.needs, { mood: 0.4 }) }, 'love', 2))) as [State, State]
      }
      const thought = p.mind?.thought
      if (thought && thought.id > seen.thought) {
        seen.thought = thought.id
        const change = { happy: { mood: 0.2 }, sad: { mood: -0.2 }, tired: { energy: -0.1 }, curious: { curiosity: 0.2 }, grumpy: { mood: -0.1 } }[thought.mood]
        pals[thought.who] = { ...pals[thought.who], say: { text: thought.text, left: readTime(thought.text), at: stopsAt(pals[thought.who]) }, needs: nudge(pals[thought.who].needs, change) }
      }
      // Whoever is talking stops strolling to say it; an errand (a goal: an order, a chase) he finishes talking.
      pals = pals.map(s => (s.say && s.mode === 'walk' && s.goal === null ? { ...s, mode: 'idle', left: Math.max(s.left, sec(1)) } : s)) as [State, State]
      const ordered = p.mind?.order && p.mind.order.id > seen.order
        ? obey({ ...pair, pals, seen }, p.mind.order, surface.columns, 2 + p.col)
        : { ...pair, pals, seen }
      const next = social(ordered, surface.columns, winner => surface.post({ tag: winner }))
      if (next.pals[0].step % sec(5) === 0) surface.post({ feelings: next.pals.map(feeling) })
      surface.setState(next)
    })
    surface.onPointer(ev => {
      const pair = surface.state
      if (ev.type !== 'down' || pair === undefined) return
      const pals = pair.pals.map(s => {
        if (ev.x < Math.round(s.x) || ev.x >= Math.round(s.x) + W) return s
        const awake = s.mode === 'sleep' ? { ...s, mode: 'idle' as const, left: sec(1) } : s
        return hop(emote({ ...awake, quiet: 0 }, 'love', 1.5))
      }) as [State, State]
      surface.setState({ ...pair, pals })
    })
    return <Box />
  }

  const [classic, fine] = surface.state.pals
  const width = Math.max(1, surface.columns)
  const lines: Cell[][] = Array.from({ length: 4 }, () => new Array<Cell>(width).fill(null))
  const sprites: [State, string[]][] = [
    [classic, draw(pose(classic))],
    [fine, drawHd(pose(fine), lean(fine), Math.abs(fine.v) > 0.03 ? (fine.v > 0 ? 1 : -1) : fine.dir)],
  ]
  const taken: Span[] = []
  for (const [s, rows] of sprites) {
    const x = Math.round(s.x)
    rows.forEach((row, i) => {
      paint(lines[i] ?? [], x, row, false)
      if (row.trim()) taken.push({ row: i, from: x, to: x + W })
    })
  }
  for (const [s] of sprites) {
    const mark = side(s) ?? ''
    if (!mark) continue
    const rows = wrap(mark)
    const length = Math.max(...rows.map(row => Array.from(row).length))
    const anchor = s.say ? s.say.at : Math.round(s.x)
    const spots = rows.length === 1 ? [placeMark(anchor, length, width, taken)] : placeBubble(anchor, length, width, taken)
    spots.forEach((spot, i) => {
      taken.push(spot)
      paint(lines[spot.row] ?? [], spot.from, (rows[i] ?? '').padEnd(length), true, true)
    })
  }

  // Runs of plain sprite cells and dim side marks; empty cells are spaces.
  const runs = (line: Cell[]) => {
    const out: { text: string; dim: boolean }[] = []
    for (const cell of line) {
      const dim = cell?.dim ?? false
      const last = out[out.length - 1]
      if (last && last.dim === dim) last.text += cell?.ch ?? ' '
      else out.push({ text: cell?.ch ?? ' ', dim })
    }
    return out
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text key={String(i)} color={COLOR}>
          {runs(line).map((run, j) => (run.dim ? <Text key={String(j)} dimColor>{run.text}</Text> : run.text))}
        </Text>
      ))}
    </Box>
  )
}

export default Clawds
