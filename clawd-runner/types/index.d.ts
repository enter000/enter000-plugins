// Counters the drawing compares with what it last saw; `tools` is how many tool calls run now.
export type Pulse = { seq: number; col: number; startle: number; submit: number; dance: number; tools: number }

// One line a Clawd thinks out loud, from the model (/clawd talk); `id` tells a new one.
// act: what he does as he says it, from the same set as orders.
export type Thought = { id: number; who: 0 | 1; text: string; mood: 'happy' | 'sad' | 'tired' | 'curious' | 'grumpy'; act?: Action }

// Something the person told them to do: one action from a fixed set, for one of them or both (2),
// with what they grumble back.
export type Action = 'corners' | 'together' | 'come' | 'sleep' | 'dance' | 'jump' | 'sit' | 'chase' | 'wander' | 'refuse'
export type Order = { id: number; action: Action; who: 0 | 1 | 2; replies: { who: 0 | 1; text: string }[] }

// What the Clawds remember across sessions, as the drawing gets it.
// welcome: bumped when the person comes back after a while; gloom: today's failures weighing on them.
// noticed: bumped when the person speaks to them; snub: when he silences them right after a remark.
export type Mind = {
  welcome: number; gloom: number; wins: [number, number]; thought: Thought | null; talk: boolean; order: Order | null
  noticed: number; snub: number
}

// What the store keeps under 'memory'.
// notes: a few things worth recalling days later, each with its date.
export type Memory = { lastSeen: number; day: string; errors: number; wins: [number, number]; notes: string[] }

declare module 'claude-code' {
  interface PluginState {
    'clawd-runner': { isHidden: boolean; pulse: Pulse; mind: Mind }
  }
}
