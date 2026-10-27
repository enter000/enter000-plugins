import type { ClientModule } from 'claude-code'

import { ACCEL, born, chance, draw, emote, EXTRA, FALL_ASLEEP, hop, JUMP, pose, sec, side, tick, TICK, W } from './clawd'
import type { Look, Props, State } from './clawd'
import type { Action, Order } from '../types'
import { drawHd, lean } from './clawd-hd'
import { drawPip } from './clawd-pip'
import { nudge } from './mind'

// Three Clawds in one band: the classic one, the finer one and Pip, the youngest. Each lives by his own
// tick; on top of that any two notice each other, say hello, play tag and copy jumps.
// A game between two of them; `it` is which of the two, `pair` which two of the three.
type Local = { kind: 'greet' | 'chase' | 'leap'; it: 0 | 1; left: number } | null
type Game = (NonNullable<Local> & { pair: [number, number] }) | null
// seen: the welcome and thought counters already acted on.
type Pair = { pals: State[]; game: Game; cooldown: number; seen: { welcome: number; thought: number; order: number; noticed: number; snub: number } }
const PAIRS: [number, number][] = [[0, 1], [0, 2], [1, 2]]

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

// One action, for an order or along with a remark; i says which corner and which side is his.
// Pip, the third, takes the middle.
const SPOT = [-12, 12, 0]
export const perform = (s: State, i: number, action: Action, columns: number, cursor: number): State => {
  const max = Math.max(0, columns - W - EXTRA)
  const go = (s: State, goal: number): State =>
    ({ ...s, mode: 'walk', goal: Math.min(max, Math.max(0, goal)), speed: 1.1, left: sec(10), distracted: true, intent: null, emote: null })
  const middle = Math.round(max / 2)
  switch (action) {
      case 'corners': return go(s, [0, max, middle][i] ?? middle)
      case 'together': return go(s, middle + (SPOT[i] ?? 0))
      case 'come': return go(s, cursor - W / 2 + (SPOT[i] ?? 0))
      case 'sleep': return { ...s, mode: 'sleep', nap: true, goal: null, left: FALL_ASLEEP, emote: null, needs: { ...s.needs, energy: 0.3 } }
      case 'dance': return hop(emote({ ...s, mode: 'idle', goal: null, left: sec(4) }, 'dance', 4))
      case 'jump': return hop({ ...s, mode: 'idle', goal: null, left: sec(1) })
      case 'sit': return emote({ ...s, mode: 'idle', goal: null, left: sec(6) }, 'sit', 6)
      case 'chase': return { ...s, mode: 'idle', goal: null, left: sec(2), intent: i === 0 ? 'play' : null, emote: null }
      case 'wander': return { ...s, mode: 'idle', goal: null, left: 0, distracted: false }
      case 'refuse': return emote({ ...s, mode: 'idle', goal: null, left: sec(2) }, 'startle', 1)
  }
}

// Carry out an order; the replies show at once, one bubble each.
export const obey = (pair: Pair, order: Order, columns: number, cursor: number): Pair => {
  const pals = pair.pals.map((s, i) => (order.who === 'all' || order.who === i ? perform(s, i, order.action, columns, cursor) : s))
  for (const reply of order.replies) {
    const s = pals[reply.who]!
    pals[reply.who] = { ...s, say: { text: reply.text, left: readTime(reply.text), at: stopsAt(s) } }
  }
  return { ...pair, pals, game: null, cooldown: order.action === 'chase' ? 0 : sec(10), seen: { ...pair.seen, order: order.id } }
}

// One game at a time: each pair plays its own, or, while another pair plays, only keeps out of the way.
export const social = (pair: Pair, columns: number, report: (winner: number) => void = () => {}): Pair => {
  const pals = [...pair.pals]
  let game = pair.game
  let cooldown = Math.max(0, pair.cooldown - 1)
  for (const [i, j] of PAIRS) {
    const mine = game !== null && game.pair[0] === i && game.pair[1] === j
    const bystander = game !== null && !mine
    const r = duo(pals[i]!, pals[j]!, mine ? game : null, cooldown, columns, w => report(w === 0 ? i : j), bystander)
    pals[i] = r.a
    pals[j] = r.b
    if (!bystander) {
      game = r.game ? { ...r.game, pair: [i, j] } : null
      cooldown = r.cooldown
    }
  }
  return { ...pair, pals, game, cooldown }
}

type Duo = { a: State; b: State; game: Local; cooldown: number }
const duo = (a: State, b: State, game: Local, cooldown: number, columns: number, report: (winner: 0 | 1) => void, bystander: boolean): Duo => {
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
  } else if (!bystander && cooldown === 0 && (free(a) || a.intent === 'play') && (free(b) || b.intent === 'play')) {
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
  if (game === null && !bystander && gap < 1) {
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

  return { a, b, game, cooldown }
}

type Cell = { ch: string; dim: boolean } | null

// Sprites paint their ink only; a mark is opaque, its spaces included, so nothing shows through the words.
const paint = (line: Cell[], x: number, text: string, dim: boolean, opaque = false) => {
  Array.from(text).forEach((ch, i) => {
    if ((opaque || ch !== ' ') && x + i >= 0 && x + i < line.length) line[x + i] = { ch, dim }
  })
}

type Span = { row: number; from: number; to: number }
// A column apart at least, so two remarks never read as one.
const clash = (a: Span, b: Span) => a.row === b.row && a.from <= b.to && b.from <= a.to

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

// No free spot beside him: the nearest free stretch of the same rows on screen; failing that, on screen over the rest.
const slide = (spot: Span[], length: number, width: number, taken: Span[]): Span[] => {
  const want = spot[0]!.from
  const at = (from: number) => spot.map(s => ({ ...s, from, to: from + length }))
  for (let d = 0; d <= width; d++) {
    for (const from of [want - d, want + d]) {
      if (from < 0 || from + length > width) continue
      if (!at(from).some(s => taken.some(t => clash(t, s)))) return at(from)
    }
  }
  return at(Math.max(0, Math.min(width - length, want)))
}

// Two lines sit on the two top rows, beside him on the right or else on the left.
export const placeBubble = (x: number, length: number, width: number, taken: Span[]): Span[] => {
  const spots = [x + W + 1, x - length - 1].map(from => [0, 1].map(row => ({ row, from, to: from + length })))
  const fits = spots.filter(([top]) => top!.from >= 0 && top!.to <= width)
  return fits.find(spot => !spot.some(s => taken.some(t => clash(t, s)))) ?? slide(fits[0] ?? spots[0]!, length, width, taken)
}

export const placeMark = (x: number, length: number, width: number, taken: Span[]): Span => {
  const spots: Span[] = [
    { row: 1, from: x + W + 1, to: x + W + 1 + length },
    { row: 1, from: x - length - 1, to: x - 1 },
    { row: 0, from: x + Math.floor((W - length) / 2), to: x + Math.floor((W - length) / 2) + length },
  ].map(spot => (spot.row === 0 ? { ...spot, from: Math.max(0, Math.min(width - length, spot.from)), to: Math.max(0, Math.min(width - length, spot.from)) + length } : spot))
  const fits = spots.filter(spot => spot.from >= 0 && spot.to <= width)
  return fits.find(spot => !taken.some(t => clash(t, spot))) ?? slide([fits[0] ?? spots[0]!], length, width, taken)[0]!
}

const latest: { props: Props | null } = { props: null }

const Clawds: ClientModule<Props, Pair> = (props, surface) => {
  const { Box, Text } = surface.elements
  latest.props = props

  // Pip came later: a band from before him gets him on its next tick.
  const trio = (pals: State[]): State[] => (pals.length >= 3 ? pals : [...pals, { ...born(latest.props ?? props, 2), x: 20 }])
  if (surface.state === undefined) {
    surface.setState({
      pals: trio([born(props, 0), { ...born(props, 1), x: 40, dir: -1 }]), game: null, cooldown: sec(5),
      seen: {
        welcome: props.mind?.welcome ?? 0, thought: props.mind?.thought?.id ?? 0, order: props.mind?.order?.id ?? 0,
        noticed: props.mind?.noticed ?? 0, snub: props.mind?.snub ?? 0,
      },
    })
    surface.every(TICK, () => {
      const pair = surface.state!
      const p = latest.props ?? props
      const hour = new Date().getHours()
      let pals = trio(pair.pals).map(s => tick(s, p, surface.columns, hour))
      const seen = { ...pair.seen }
      // Back after hours away: both perk up, look at each other and jump for joy.
      if ((p.mind?.welcome ?? 0) > seen.welcome) {
        seen.welcome = p.mind?.welcome ?? 0
        pals = pals.map(s => hop(emote({ ...s, mode: 'idle', left: sec(2), quiet: 0, needs: nudge(s.needs, { mood: 0.4 }) }, 'love', 2)))
      }
      const thought = p.mind?.thought
      if (thought && thought.id > seen.thought) {
        seen.thought = thought.id
        const change = { happy: { mood: 0.2 }, sad: { mood: -0.2 }, tired: { energy: -0.1 }, curious: { curiosity: 0.2 }, grumpy: { mood: -0.1 } }[thought.mood]
        // A sleeper does not talk: someone awake says it, or nobody if all are asleep.
        const who = [thought.who, ...[0, 1, 2].filter(i => i !== thought.who)].find(i => pals[i] && pals[i].mode !== 'sleep')
        if (who !== undefined) {
          const s = pals[who]!
          const acted = thought.act ? perform(s, who, thought.act, surface.columns, 2 + p.col) : s
          pals[who] = { ...acted, say: { text: thought.text, left: readTime(thought.text), at: stopsAt(s) }, needs: nudge(acted.needs, change) }
        }
      }
      // Spoken to: pleased to be noticed, they turn to the prompt. Silenced mid-remark: they sulk a while.
      if ((p.mind?.noticed ?? 0) > seen.noticed) {
        seen.noticed = p.mind?.noticed ?? 0
        pals = pals.map(s => ({ ...s, needs: nudge(s.needs, { mood: 0.3, social: -0.3 }) }))
      }
      if ((p.mind?.snub ?? 0) > seen.snub) {
        seen.snub = p.mind?.snub ?? 0
        pals = pals.map(s => emote({ ...s, needs: nudge(s.needs, { mood: -0.5 }) }, 'sit', 4))
      }
      // Whoever is talking stops strolling to say it; an errand (a goal: an order, a chase) he finishes talking.
      pals = pals.map(s => (s.say && s.mode === 'walk' && s.goal === null ? { ...s, mode: 'idle', left: Math.max(s.left, sec(1)) } : s))
      const ordered = p.mind?.order && p.mind.order.id > seen.order
        ? obey({ ...pair, pals, seen }, p.mind.order, surface.columns, 2 + p.col)
        : { ...pair, pals, seen }
      const next = social(ordered, surface.columns, winner => surface.post({ tag: winner }))
      if (next.pals[0]!.step % sec(5) === 0) surface.post({ feelings: next.pals.map(feeling) })
      surface.setState(next)
    })
    surface.onPointer(ev => {
      const pair = surface.state
      if (ev.type !== 'down' || pair === undefined) return
      const pals = pair.pals.map(s => {
        if (ev.x < Math.round(s.x) || ev.x >= Math.round(s.x) + W) return s
        const awake = s.mode === 'sleep' ? { ...s, mode: 'idle' as const, left: sec(1) } : s
        return hop(emote({ ...awake, quiet: 0 }, 'love', 1.5))
      })
      surface.setState({ ...pair, pals })
    })
    return <Box />
  }

  const [classic, fine, pip] = surface.state.pals
  const width = Math.max(1, surface.columns)
  const lines: Cell[][] = Array.from({ length: 4 }, () => new Array<Cell>(width).fill(null))
  const facing = (s: State) => (Math.abs(s.v) > 0.03 ? (s.v > 0 ? 1 : -1) : s.dir)
  const sprites: [State, string[]][] = [
    [classic!, draw(pose(classic!))],
    [fine!, drawHd(pose(fine!), lean(fine!), facing(fine!))],
    ...(pip ? [[pip, drawPip(pose(pip), lean(pip), facing(pip))] as [State, string[]]] : []),
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
    // Pinned where he would stop, which can lie past the edge he stops at.
    const anchor = Math.max(0, Math.min(width - W - EXTRA, s.say ? s.say.at : Math.round(s.x)))
    const place = (rows: string[]) => {
      const length = Math.max(...rows.map(row => Array.from(row).length))
      return { length, spots: rows.length === 1 ? [placeMark(anchor, length, width, taken)] : placeBubble(anchor, length, width, taken) }
    }
    let rows = wrap(mark)
    let { length, spots } = place(rows)
    // Pushed away from him by the other's words: an arrow on the first line points back at him.
    const far = (spot: Span) => (spot.from > anchor ? spot.from - (anchor + W) : anchor - spot.to) > 3
    if (s.say && far(spots[0]!)) {
      ;({ length, spots } = place(rows.map((row, i) => (i === 0 ? '  ' + row : row))))
      const right = spots[0]!.from > anchor
      rows = rows.map((row, i) => (i > 0 ? row : right ? '← ' + row : row.padEnd(length - 2) + ' →'))
    }
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
