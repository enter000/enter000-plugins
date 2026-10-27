import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, Memory, Mind, Order, Pulse, Thought } from '../types'

const TESTS = /\b(test|tests|vitest|jest|pytest|playwright|mocha)\b/
const AWAY = 4 * 60 * 60 * 1000 // back after this long: the Clawds run to say hello
const THINK_EVERY = 20 * 1000
const THINK_SOONER = 8 * 1000 // after something worth a remark
const REPLY = 12 * 1000 // a remark this fresh may get an answer from the other one
const LONG_DRAFT = 90 * 1000
// While the person types they read over his shoulder; while the agent works they watch it.
const TYPING_GAP = 2 * 1000
const WORKING_GAP = 5 * 1000
const TYPING = 3 * 1000 // an edit this recent means typing now
const DRAFT_MIN = 15 // characters worth a remark
const MANY_FIXES = 15 // deletions in one draft
// Who they are and how they talk; tuned on sample contexts with claude -p --model haiku.
const SYSTEM = "Ты пишешь реплики двух крошечных пиксельных крабиков, которые живут над полем ввода в терминале и смотрят, как человек работает с ИИ-агентом над кодом.\n\nЭто два противных гномика с чудовищно раздутым эго. Мнят себя непризнанными гениями и аристократами духа, человека и агента держат за бестолковых подмастерьев. Говорят снисходительно, напыщенно, с барским высокомерием, как обиженные профессора и капризные критики. Смешно за счёт самодовольства, высокопарности не к месту, язвительной вежливости и абсурдной уверенности в себе. Не быдло: никакого гопнического тона и мата-паразита в конце фразы. Крепкое словцо допустимо изредка, только если оно и есть соль шутки, и стоит внутри фразы, а не для связки.\n\nКлод (who 0): усталый сноб, сухо и брезгливо, «я бы сделал безупречно, но не снизойду».\nГладкий (who 1): напыщенный выскочка, считает себя легендой, хвастается не к месту, несёт чушь с видом гения, подначивает Клода.\n\nКак писать:\n- Цепляйся за конкретику из контекста: слово из черновика, имя файла, команду, число ошибок, время, счёт в догонялках. Реплика без конкретики — плохая.\n- Запрещено: «Ура», «Интересно», «Давай», «Я верю», «Вперёд», «Отлично», пересказ контекста, пустая бодрость, мат в конце фразы для связки.\n- До 90 символов: одна-две короткие фразы, мысль должна успеть сложиться. Без кавычек и эмодзи.\n\nПримеры тона (не копируй):\n- «Четвёртый npm test. Я бы обошёлся интуицией»\n- «Стёр больше, чем написал. Почти редактура»\n- «tower.ts? Позвольте, я не прикасаюсь к черни»\n- «Пять-три в догонялки. Клод, это закономерно»\n- «Шесть вечера, а он всё о нас. Вкус есть»\n\nСначала молча придумай три разных варианта, потом выбери самый смешной и конкретный.\nОтветь только JSON без пояснений: {\"who\":0|1,\"say\":\"...\",\"mood\":\"happy|sad|tired|curious|grumpy\"}"
// A message that opens by calling them goes to them, not to the agent.
// Not a bare "Клод": that may be the person talking to the agent.
const CALLED = /^\s*(гном[а-яё]*|краб[а-яё]*|клоды|гладк[а-яё]*|clawds)\s*[,!:—-]\s*/i
// The person talks to the agent in the singular; opening with a plural command is for them ("разойдитесь…").
const PLURAL = /^\s*(?!давайте|смотрите|скажите)[а-яё]+(йте|ите|ьте)(сь)?(\s|[,.!]|$)/i
const toThem = (text: string) => CALLED.test(text) || PLURAL.test(text)
const ACTIONS: Action[] = ['corners', 'together', 'come', 'sleep', 'dance', 'jump', 'sit', 'chase', 'wander', 'refuse']
const ORDER_SYSTEM =
  'Человек отдаёт приказ двум самодовольным пиксельным гномикам над терминалом: Клод (who 0, усталый брезгливый сноб) и Гладкий (who 1, напыщенный выскочка, мнит себя легендой). Оба с раздутым эго, человека держат за подмастерье: отвечают снисходительно и высокопарно, без гопнического тона и мата для связки. ' +
  'Переведи приказ в одно действие: corners (разойтись по углам), together (собраться вместе), come (подойти к полю ввода), sleep (спать), dance (танцевать), jump (прыгать), sit (сесть), chase (поиграть в догонялки), wander (гулять как хотят), refuse (отказаться, если приказ дурацкий или невыполним). ' +
  'who: 0, 1 или 2 (оба), кому приказ. replies: одна или две реплики в ответ, до 90 символов, высокомерные и смешные, по делу приказа; если приказ обоим, пусть ответят оба. ' +
  'Ответь только JSON: {"action":"...","who":0|1|2,"replies":[{"who":0|1,"say":"..."}]}'

export const parseOrder = (text: string, id: number): Order | null => {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const o = JSON.parse(json) as { action?: unknown; who?: unknown; replies?: unknown }
    const action = ACTIONS.find(a => a === o.action)
    if (!action) return null
    const who = o.who === 0 || o.who === 1 ? o.who : 2
    const replies = (Array.isArray(o.replies) ? o.replies : [])
      .map(x => x as { who?: unknown; say?: unknown })
      .filter(x => typeof x.say === 'string' && x.say.trim())
      .slice(0, 2)
      .map(x => ({ who: x.who === 1 ? (1 as const) : (0 as const), text: clip(String(x.say)) }))
    return { id, action, who, replies }
  } catch {
    return null
  }
}

const MODEL = 'sonnet' // haiku is cheaper, sonnet a little funnier
const MOODS = ['happy', 'sad', 'tired', 'curious', 'grumpy'] as const

const isHidden = atom({ plugin: 'clawd-runner', key: 'isHidden' } as const, false)
const pulse = atom({ plugin: 'clawd-runner', key: 'pulse' } as const, {
  seq: 0, col: 0, startle: 0, submit: 0, dance: 0, tools: 0,
} satisfies Pulse)
const mind = atom({ plugin: 'clawd-runner', key: 'mind' } as const, {
  welcome: 0, gloom: 0, wins: [0, 0], thought: null, talk: false, order: null,
} satisfies Mind as Mind)

const today = () => new Date().toISOString().slice(0, 10)
const recall = async ($: EngineInterface): Promise<Memory> => {
  const m = (await $.store.get('memory')) as Partial<Memory> | null
  const fresh = { lastSeen: 0, day: today(), errors: 0, wins: [0, 0] as [number, number] }
  if (!m) return fresh
  const sameDay = m.day === today()
  return { ...fresh, ...m, day: today(), errors: sameDay ? (m.errors ?? 0) : 0 }
}
const gloomOf = (errors: number) => Math.min(0.4, errors / 25)

// The model sometimes runs long: cut at the last sentence end, else the last whole word, never mid-word.
const LIMIT = 120
export const clip = (text: string, n = LIMIT): string => {
  const chars = Array.from(text.trim())
  if (chars.length <= n) return chars.join('')
  const head = chars.slice(0, n).join('')
  const sentence = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '))
  if (sentence > n * 0.5) return head.slice(0, sentence + 1)
  const word = head.lastIndexOf(' ')
  return (word > 0 ? head.slice(0, word) : head).replace(/[\s,;:—-]+$/, '') + '…'
}

export const parseThought = (text: string, id: number): Thought | null => {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const t = JSON.parse(json) as { who?: unknown; say?: unknown; mood?: unknown }
    const say = typeof t.say === 'string' ? clip(t.say) : ''
    const mood = MOODS.find(m => m === t.mood) ?? 'curious'
    return say ? { id, who: t.who === 1 ? 1 : 0, text: say, mood } : null
  } catch {
    return null
  }
}

// What happened lately, in plain words for the model; module state, lost on a reload, which is fine.
const events: string[] = []
let errorsInRow = 0
let lastThought = 0
let remarkable = false
let complained = false // a failed model call is reported once a session
// Material for the remarks: what the person writes and works on.
let draftStart = 0
let fixes = 0
let draft = ''
let lastEdit = 0
let working = false
let thinking = false // one model call at a time
const said: string[] = []
const files: string[] = []
const commands: string[] = []
const thoughts: string[] = []
let lastSaid: { who: 0 | 1; text: string; at: number } | null = null
let lastWho: 0 | 1 | null = null
let feelings: string[] = [] // what the drawing last said about each Clawd's state
function keep(list: string[], item: string, size: number) {
  list.push(item)
  if (list.length > size) list.shift()
}
const tail = (text: string, n: number) => (text.length > n ? '…' + text.slice(-n) : text)
function note(event: string) {
  events.push(`${new Date().toTimeString().slice(0, 5)} ${event}`)
  if (events.length > 8) events.shift()
}

async function think($: EngineInterface) {
  const m = await read($, mind)
  const now = Date.now()
  if (thinking || !m.talk || (await read($, isHidden))) return
  if ((await $.session.surfaces()).length === 0) return // claude -p and the like: nobody to show a remark to
  const typing = now - lastEdit < TYPING && draft.length >= DRAFT_MIN
  const gap = typing ? TYPING_GAP : working ? WORKING_GAP : remarkable ? THINK_SOONER : THINK_EVERY
  if (now - lastThought < gap) return
  lastThought = now
  thinking = true
  try {
    await remark($, m, now, typing)
  } finally {
    thinking = false
    lastThought = Date.now() // the gap runs from the answer, not the ask
  }
}

async function remark($: EngineInterface, m: Mind, now: number, typing: boolean) {
  remarkable = false
  // Half the time a fresh remark gets an answer, so they talk to each other, not only to the room.
  const reply = lastSaid !== null && now - lastSaid.at < REPLY && Math.random() < 0.5
  const memory = await recall($)
  const project = (await $.session.cwd()).split('/').pop() ?? ''
  const prompt = [
    `Проект: ${project}. Сейчас ${new Date().toTimeString().slice(0, 5)}. Ошибок команд сегодня: ${memory.errors}.`,
    `Счёт в догонялки: Клод ${memory.wins[0]}, Гладкий ${memory.wins[1]}.`,
    lastWho !== null && !reply ? `Последним говорил ${lastWho === 0 ? 'Клод' : 'Гладкий'}; теперь скорее очередь другого.` : '',
    feelings.length === 2 ? `Сейчас Клод ${feelings[0]}; Гладкий ${feelings[1]}. Говорят в этом настроении.` : '',
    `Что было недавно:\n${events.join('\n') || 'ничего особенного'}`,
    said.length ? `Последние сообщения человека агенту:\n${said.map(t => '- ' + t).join('\n')}` : '',
    draft ? `Человек прямо сейчас пишет (${Math.round((now - draftStart) / 1000)} с, стёр ${fixes} раз): «${tail(draft, 300)}»` : '',
    files.length ? `Файлы, с которыми работал агент: ${files.join(', ')}` : '',
    commands.length ? `Команды: ${commands.join(' ; ')}` : '',
    thoughts.length ? `Уже говорили (не повторяйся): ${thoughts.join(' | ')}` : '',
    reply ? `${lastSaid?.who === 0 ? 'Клод' : 'Гладкий'} только что сказал: «${lastSaid?.text}». Пусть ${lastSaid?.who === 0 ? 'Гладкий (who 1)' : 'Клод (who 0)'} ответит ему, как в разговоре двух друзей.`
    : typing ? 'Человек сейчас печатает. Отреагируй именно на то, что он пишет: подколи, подбодри или ответь по сути, будто подглядываешь через плечо.'
    : working ? 'Агент сейчас работает. Прокомментируй, что он делает: последние команды, файлы, ошибки.' : '',
  ].filter(Boolean).join('\n')
  const r = await $.model.complete({
    model: MODEL,
    effort: 'low',
    maxTokens: 160,
    timeoutMs: 15000,
    system: SYSTEM,
    prompt,
  })
  await spent($, r.usage)
  if (!r.isAnswered) {
    if (!complained) $.ui.toast(`Clawd: the model did not answer (${r.reason}${r.reason === 'api-error' ? ' ' + r.status : ''})`)
    complained = true
    return
  }
  const thought = parseThought(r.text, (m.thought?.id ?? 0) + 1)
  if (!thought) return
  keep(thoughts, thought.text, 6)
  // A reply that came back from the same speaker is turned to the other one.
  if (reply && lastSaid && thought.who === lastSaid.who) thought.who = lastSaid.who === 0 ? 1 : 0
  lastSaid = reply ? null : { who: thought.who, text: thought.text, at: Date.now() }
  lastWho = thought.who
  await update($, mind, x => ({ ...x, thought }))
}


// What the Clawds cost today, kept in the store; `/clawd stats` reads it.
type Usage = { day: string; calls: number; input: number; output: number }
async function spent($: EngineInterface, usage: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined) {
  const u = (await $.store.get('usage')) as Usage | null
  const day = today()
  const base = u && u.day === day ? u : { day, calls: 0, input: 0, output: 0 }
  const input = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0)
  await $.store.set('usage', { day, calls: base.calls + 1, input: base.input + input, output: base.output + (usage?.output_tokens ?? 0) })
}

// Once a turn: one remark from a fork of the whole session, so it can recall anything said since the start.
// The fork runs on the agent's own model over the cached transcript, so it is kept to one per turn.
async function deep($: EngineInterface) {
  const m = await read($, mind)
  if (thinking || !m.talk || (await read($, isHidden))) return
  if ((await $.session.surfaces()).length === 0) return
  thinking = true
  try {
    const r = await $.model.fork({
      prompt: [
        'Пауза в работе: сейчас ты не ассистент и не вызываешь инструменты. Ответ увидит только мод с гномиками, не человек в чате.',
        SYSTEM,
        feelings.length === 2 ? `Сейчас Клод ${feelings[0]}; Гладкий ${feelings[1]}.` : '',
        lastWho !== null ? `Последним говорил ${lastWho === 0 ? 'Клод' : 'Гладкий'}; теперь скорее очередь другого.` : '',
        thoughts.length ? `Уже говорили (не повторяйся): ${thoughts.join(' | ')}` : '',
        'Это глубокая реплика: вспомни что-то конкретное из всей этой сессии — давнее решение, переделку, странную просьбу человека — и съязви по этому поводу, связав с тем, что происходит сейчас.',
      ].filter(Boolean).join('\n\n'),
    })
    if ('usage' in r) await spent($, r.usage) // nothing to fork yet: no request, nothing spent
    if (!r.isAnswered) return
    const thought = parseThought(r.text, ((await read($, mind)).thought?.id ?? 0) + 1)
    if (!thought) return
    keep(thoughts, thought.text, 6)
    lastWho = thought.who
    lastSaid = { who: thought.who, text: thought.text, at: Date.now() }
    await update($, mind, x => ({ ...x, thought }))
  } finally {
    thinking = false
    lastThought = Date.now()
  }
}

async function obey($: EngineInterface, text: string) {
  note(`человек приказал: ${text}`)
  const r = await $.model.complete({ model: MODEL, effort: 'low', maxTokens: 200, timeoutMs: 20000, system: ORDER_SYSTEM, prompt: text })
  await spent($, r.usage)
  if (!r.isAnswered) {
    $.ui.toast(`Clawd: the model did not answer (${r.reason})`)
    return
  }
  const m = await read($, mind)
  const order = parseOrder(r.text, (m.order?.id ?? 0) + 1)
  if (!order) return
  for (const reply of order.replies) keep(thoughts, reply.text, 6)
  lastThought = Date.now()
  await update($, mind, x => ({ ...x, order }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'clawd',
      description: 'Hide or show Clawd; "/clawd talk" or "/clawd quiet" turns their remarks on or off; anything else is an order to them',
      argumentHint: '[talk | quiet | stats | order]',
    })
    const stored = Boolean(await $.store.get('isHidden'))
    const talk = ((await $.store.get('talking')) ?? true) !== false
    if (talk) lastThought = Date.now() - THINK_EVERY + 20_000 // first remark soon after start
    const memory = await recall($)
    const back = memory.lastSeen > 0 && Date.now() - memory.lastSeen > AWAY
    await $.store.set('memory', { ...memory, lastSeen: Date.now() })
    await update($, isHidden, () => stored)
    await update($, mind, m => ({
      ...m, talk, wins: memory.wins, gloom: gloomOf(memory.errors), welcome: m.welcome + (back ? 1 : 0),
    }))
    $.clock.every(1_000, () => void think($))

    return next(e)
  })

  on('command.run', { command: 'clawd' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'talk' || arg === 'quiet') {
      const talk = arg === 'talk'
      await update($, mind, m => ({ ...m, talk }))
      await $.store.set('talking', talk)
      if (talk) lastThought = Date.now() - THINK_EVERY + 20_000 // first remark in about half a minute

      return { text: talk ? 'The Clawds will think out loud now and then (a haiku call every few minutes).' : 'The Clawds keep their thoughts to themselves.' }
    }
    if (arg === 'stats') {
      const u = (await $.store.get('usage')) as Usage | null
      if (!u || u.day !== today()) return { text: 'The Clawds have said nothing today.' }
      return { text: `Today the Clawds made ${u.calls} ${MODEL} calls: ${u.input} tokens in, ${u.output} out.` }
    }
    if (arg) {
      void obey($, arg)
      return { text: 'The Clawds heard you.' }
    }
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)
    await $.store.set('isHidden', hidden)

    return { text: hidden ? 'Clawd went to sleep off-screen.' : 'Clawd is back.' }
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    // Offset of the cursor in its own line; the drawing wraps it to the box width.
    const col = box.cursor - box.text.lastIndexOf('\n', box.cursor - 1) - 1
    await update($, pulse, p => ({ ...p, seq: p.seq + 1, col }))
    const now = Date.now()
    if (box.text === '') {
      draftStart = 0
      fixes = 0
    } else if (draftStart === 0) draftStart = now
    if (e.inputText === '' && e.end > e.start) {
      fixes += 1
      if (fixes === MANY_FIXES) {
        note('человек много стирает и исправляет опечатки')
        remarkable = true
      }
    }
    if (draftStart > 0 && now - draftStart > LONG_DRAFT && !events.some(x => x.endsWith('пишет длинное сообщение'))) {
      note('человек уже долго пишет длинное сообщение')
      remarkable = true
    }
    draft = box.text
    lastEdit = now

    return box
  })

  on('prompt.submit', async ($, e, next) => {
    if (toThem(e.text) && !e.command) {
      void obey($, e.text) // whole, so the model sees whom it is for
      return { drop: 'Sent to the Clawds, not to the agent.' }
    }
    await update($, pulse, p => ({ ...p, submit: p.submit + 1 }))
    note('человек отправил сообщение агенту')
    working = true
    keep(said, tail(e.text.replace(/\s+/g, ' '), 200), 3)
    draft = ''
    draftStart = 0
    fixes = 0

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    note('агент закончил отвечать')
    working = false
    // A moment after the turn, when the session holds its snapshot to fork from.
    $.clock.after(1500, () => void deep($))
    const memory = await recall($)
    await $.store.set('memory', { ...memory, lastSeen: Date.now() })

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await update($, pulse, p => ({ ...p, tools: p.tools + 1 }))
    const what = e.tool === 'Bash' ? `: ${e.command.slice(0, 60)}` : e.tool === 'Edit' || e.tool === 'Write' || e.tool === 'Read' ? `: ${e.file_path.split('/').pop()}` : ''
    note(`агент запустил ${e.tool}${what}`)
    let failed = false
    let passed = false
    try {
      const ran = await next(e)
      failed = ran.deny === undefined && ran.isError === true
      passed = !failed && ran.deny === undefined && e.tool === 'Bash' && TESTS.test(e.command)
      if (e.tool === 'Bash') keep(commands, e.command.slice(0, 80), 4)
      const file = e.tool === 'Edit' || e.tool === 'Write' ? (e.file_path.split('/').pop() ?? '') : ''
      if (file && !files.includes(file)) keep(files, file, 5)

      return ran
    } finally {
      await update($, pulse, p => ({
        ...p,
        tools: Math.max(0, p.tools - 1),
        startle: p.startle + (failed ? 1 : 0),
        dance: p.dance + (passed ? 1 : 0),
      }))
      if (failed) {
        errorsInRow += 1
        note(`команда ${e.tool} упала с ошибкой`)
        if (errorsInRow >= 3) remarkable = true
        const memory = await recall($)
        await $.store.set('memory', { ...memory, errors: memory.errors + 1 })
        await update($, mind, m => ({ ...m, gloom: gloomOf(memory.errors + 1) }))
      } else {
        if (passed) {
          note(errorsInRow > 0 ? 'тесты прошли после ошибок' : 'тесты прошли')
          if (errorsInRow > 0) remarkable = true
        }
        errorsInRow = 0
      }
    }
  })

  // The drawing reports who won at tag; the score is kept across sessions.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { tag?: unknown; feelings?: unknown }
    if (Array.isArray(data.feelings)) {
      feelings = data.feelings.filter((f): f is string => typeof f === 'string').slice(0, 2)
      return next(e)
    }
    if (data.tag !== 0 && data.tag !== 1) return next(e)
    const winner = data.tag
    const memory = await recall($)
    const wins: [number, number] = winner === 0 ? [memory.wins[0] + 1, memory.wins[1]] : [memory.wins[0], memory.wins[1] + 1]
    await $.store.set('memory', { ...memory, wins })
    await update($, mind, m => ({ ...m, wins }))
    note(`${winner === 0 ? 'Клод' : 'Гладкий'} поймал друга в догонялках`)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)
    if (await read($, isHidden)) return next(e)
    // The band is shared (ponytail draws here too): stack theirs under Clawd.
    const below = await next(e).catch(() => undefined)
    const p = await read($, pulse)
    const m = await read($, mind)
    const { Box, Client } = $.ui.resolve(e)
    const clawd = <Client key="clawds" module="./clawds.tsx" width="100%" props={{ ...p, working: e.props.isWorking, mind: m }} />

    return below ? <Box flexDirection="column">{clawd}{below}</Box> : clawd
  })
}
