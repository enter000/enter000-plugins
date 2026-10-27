// What a Clawd wants: needs that drift with time and events, a character that weighs
// them, and a pick among actions by how much each one answers his needs right now.

export type Needs = { energy: number; boredom: number; social: number; curiosity: number; mood: number }
// stamina: how slowly moving tires him out.
export type Trait = { speed: number; lazy: number; hyper: number; sociable: number; moodBase: number; stamina: number }
export type Choice = 'wander' | 'sit' | 'play' | 'hop' | 'explore' | 'nap'

// The classic one is slow, lazy, a bit grumpy and fond of company; the fine one never sits still;
// Pip, the youngest, is cheerful, clingy and quick, but tires sooner than the fine one.
export const TRAITS: [Trait, Trait, Trait] = [
  { speed: 0.8, lazy: 0.35, hyper: 0, sociable: 0.7, moodBase: -0.05, stamina: 0.6 },
  { speed: 1.25, lazy: 0, hyper: 0.35, sociable: 1, moodBase: 0.2, stamina: 2.5 },
  { speed: 1.05, lazy: 0.1, hyper: 0.2, sociable: 1.3, moodBase: 0.3, stamina: 1.2 },
]

export const RESTED: Needs = { energy: 1, boredom: 0.2, social: 0.3, curiosity: 0.3, mood: 0 }

const PER_MIN = 1 / 1000 // a tick is 60 ms: about a thousand to the minute
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))

export type Doing = 'sleep' | 'sit' | 'move' | 'watch' | 'still'

export const drift = (n: Needs, doing: Doing, speed: number, t: Trait, hour: number, gloom: number): Needs => {
  const night = hour >= 23 || hour < 6
  const spend = ((doing === 'move' ? 0.25 * (speed / 0.7) : 0.03) * (night ? 1.5 : 1)) / t.stamina
  const rest = doing === 'sleep' ? 0.6 : doing === 'sit' ? 0.2 : 0
  const base = t.moodBase - gloom - (night ? 0.1 : 0) - (n.energy < 0.25 ? 0.2 : 0)
  return {
    energy: clamp(n.energy + (rest - spend) * PER_MIN),
    boredom: clamp(n.boredom + (doing === 'watch' ? -0.5 : doing === 'sleep' ? -0.1 : 0.3) * PER_MIN),
    social: clamp(n.social + 0.25 * t.sociable * PER_MIN),
    curiosity: clamp(n.curiosity + (doing === 'watch' ? -0.5 : 0.15) * PER_MIN),
    mood: clamp(n.mood + (base - n.mood) * 0.0005, -1, 1),
  }
}

export const nudge = (n: Needs, change: Partial<Needs>): Needs => ({
  energy: clamp(n.energy + (change.energy ?? 0)),
  boredom: clamp(n.boredom + (change.boredom ?? 0)),
  social: clamp(n.social + (change.social ?? 0)),
  curiosity: clamp(n.curiosity + (change.curiosity ?? 0)),
  mood: clamp(n.mood + (change.mood ?? 0), -1, 1),
})

export const weights = (n: Needs, t: Trait): Record<Choice, number> => ({
  wander: 0.25 + n.boredom * 0.6 + n.energy * 0.2 + t.hyper,
  sit: Math.max(0, (1 - n.energy) * 0.8 + t.lazy * 1.5 - t.hyper),
  play: n.social * 0.9 * (n.energy > 0.3 ? 1 : 0.2),
  hop: Math.max(0, n.mood) * 0.3 + t.hyper * 0.6,
  explore: n.curiosity * 0.6,
  nap: n.energy < 0.15 ? 5 : 0,
})

export const choose = (n: Needs, t: Trait, roll = Math.random()): Choice => {
  const w = Object.entries(weights(n, t)) as [Choice, number][]
  let left = roll * w.reduce((sum, [, x]) => sum + x, 0)
  for (const [choice, x] of w) {
    left -= x
    if (left <= 0) return choice
  }
  return 'wander'
}

// How fast he moves now: tired or sulking, slower.
export const pace = (n: Needs, t: Trait) => t.speed * (0.55 + 0.45 * n.energy) * (n.mood < -0.3 ? 0.75 : 1)
