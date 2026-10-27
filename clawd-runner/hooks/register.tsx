import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, Memory, Mind, Order, Pulse, Thought, Who } from '../types'

const TESTS = /\b(test|tests|vitest|jest|pytest|playwright|mocha)\b/
const AWAY = 4 * 60 * 60 * 1000 // back after this long: the Clawds run to say hello
const THINK_EVERY = 20 * 1000
const THINK_SOONER = 8 * 1000 // after something worth a remark
const REPLY = 12 * 1000 // a remark this fresh may get an answer from the other one
const LONG_DRAFT = 90 * 1000
// While the person types they read over his shoulder; while the agent works they watch it.
const TYPING_GAP = 15 * 1000
const WORKING_GAP = 5 * 1000
const TYPING = 10 * 1000 // an edit this recent means typing now
const PAUSE = 2 * 1000 // a draft is remarked on once the person stops for this long
const IDLE = 5 * 60 * 1000 // nobody around this long: they keep quiet till someone is back
const DEEP_EVERY = 5 // turns between remarks from a fork of the whole session
const DRAFT_MIN = 15 // characters worth a remark
const MANY_FIXES = 15 // deletions in one draft
// Who they are and how they talk; tuned on sample contexts with claude -p --model haiku.
const SYSTEM = "Ты пишешь реплики трёх крошечных пиксельных крабиков, которые живут над полем ввода в терминале и смотрят, как человек работает с ИИ-агентом над кодом.\n\nДвое старших — противные гномики с чудовищно раздутым эго. Мнят себя непризнанными гениями и аристократами духа, человека и агента держат за бестолковых подмастерьев. Говорят снисходительно, напыщенно, с барским высокомерием, как обиженные профессора и капризные критики. Смешно за счёт самодовольства, высокопарности не к месту, язвительной вежливости и абсурдной уверенности в себе. Не быдло: никакого гопнического тона и мата-паразита в конце фразы. Крепкое словцо допустимо изредка, только если оно и есть соль шутки, и стоит внутри фразы, а не для связки.\n\nКлод (who 0): усталый сноб, сухо и брезгливо, «я бы сделал безупречно, но не снизойду».\nГладкий (who 1): напыщенный выскочка, считает себя легендой, хвастается не к месту, несёт чушь с видом гения, подначивает Клода.\nПип (who 2): младший, новичок-подлиза. Боготворит обоих снобов, поддакивает, всё путает, пытается подражать их высокомерию и выходит смешно; старшие его снисходительно терпят.\n\nКак писать:\n- Цепляйся за конкретику из контекста: о чём человек пишет, имя файла, команду, число ошибок, время, счёт в догонялках. Реплика без конкретики — плохая.\n- Опечатки, стирания и оборванные фразы — тема на крайний случай, не чаще одной реплики из десяти: черновик ещё не дописан. Смейся над смыслом — над тем, что он просит, что делает агент, который час.\n- Запрещено: «Ура», «Интересно», «Давай», «Я верю», «Вперёд», «Отлично», пересказ контекста, пустая бодрость, мат в конце фразы для связки.\n- До 90 символов: одна-две короткие фразы, мысль должна успеть сложиться. Без кавычек и эмодзи.\n- Язык реплики — тот, на котором человек пишет агенту (его сообщения и черновик ниже); если его текстов нет — английский. Не по-русски имена — Clawd, Sleek и Pip.\n\nПримеры тона (не копируй):\n- «Четвёртый npm test. Я бы обошёлся интуицией»\n- «Третий раз про отступы. Я бы назвал это стилем»\n- «tower.ts? Позвольте, я не прикасаюсь к черни»\n- «Пять-три в догонялки. Клод, это закономерно»\n- «Шесть вечера, а он всё о нас. Вкус есть»\n- «Клод, это гениально! А что такое npm?»\n\nСначала молча придумай три разных варианта, потом выбери самый смешной и конкретный.\nact — что он делает, пока говорит, если это усиливает шутку: sit (брезгливо сел), jump (хвастается), dance (торжествует), come (подошёл посмотреть на черновик), corners (обиженно ушёл в свой угол), sleep (демонстративно лёг спать), refuse (вздрогнул от возмущения); чаще всего none.\nОтветь только JSON без пояснений: {\"who\":0|1|2,\"say\":\"...\",\"mood\":\"happy|sad|tired|curious|grumpy\",\"act\":\"none|sit|jump|dance|come|corners|sleep|refuse\"}"
// A message that opens by calling them goes to them, not to the agent.
// Not a bare "Клод": that may be the person talking to the agent.
const CALLED = /^\s*(гном[а-яё]*|краб[а-яё]*|клоды|гладк[а-яё]*|пип|clawds|sleek|pip|crabs?|guys)\s*[,!:—-]\s*/i
// The person talks to the agent in the singular; opening with a plural command is for them ("разойдитесь…").
const PLURAL = /^\s*(?!давайте|смотрите|скажите)[а-яё]+(йте|ите|ьте)(сь)?(\s|[,.!]|$)/i
const toThem = (text: string) => CALLED.test(text) || PLURAL.test(text)
const ACTIONS: Action[] = ['corners', 'together', 'come', 'sleep', 'dance', 'jump', 'sit', 'chase', 'wander', 'refuse']
const ORDER_SYSTEM =
  'Человек отдаёт приказ трём пиксельным гномикам над терминалом: Клод (who 0, усталый брезгливый сноб), Гладкий (who 1, напыщенный выскочка, мнит себя легендой) и Пип (who 2, младший, новичок-подлиза, поддакивает старшим). Старшие с раздутым эго, человека держат за подмастерье: отвечают снисходительно и высокопарно, без гопнического тона и мата для связки. ' +
  'Переведи приказ в одно действие: corners (разойтись по углам), together (собраться вместе), come (подойти к полю ввода), sleep (спать), dance (танцевать), jump (прыгать), sit (сесть), chase (поиграть в догонялки), wander (гулять как хотят), refuse (отказаться, если приказ дурацкий или невыполним). ' +
  'who: 0, 1, 2 или "all" (всем), кому приказ. replies: одна-три реплики в ответ, до 90 символов, смешные, по делу приказа; если приказ всем, пусть ответят двое-трое. Реплики на языке приказа, не по-русски имена — Clawd, Sleek и Pip. ' +
  'Ответь только JSON: {"action":"...","who":0|1|2|"all","replies":[{"who":0|1|2,"say":"..."}]}'

const whoOf = (x: unknown): Who => (x === 1 || x === 2 ? x : 0)
const NAMES = ['Клод', 'Гладкий', 'Пип']
const others = (who: Who) => ([0, 1, 2] as Who[]).filter(i => i !== who)

export const parseOrder = (text: string, id: number): Order | null => {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const o = JSON.parse(json) as { action?: unknown; who?: unknown; replies?: unknown }
    const action = ACTIONS.find(a => a === o.action)
    if (!action) return null
    const who = o.who === 0 || o.who === 1 || o.who === 2 ? o.who : 'all'
    const replies = (Array.isArray(o.replies) ? o.replies : [])
      .map(x => x as { who?: unknown; say?: unknown })
      .filter(x => typeof x.say === 'string' && x.say.trim())
      .slice(0, 3)
      .map(x => ({ who: whoOf(x.who), text: clip(String(x.say)) }))
    return { id, action, who, replies }
  } catch {
    return null
  }
}

const MODEL = 'sonnet' // haiku is cheaper, sonnet a little funnier
let model = MODEL // `/clawd model <name>` swaps it, kept in the store
let lang = '' // `/clawd lang <language>`; empty: the language the person writes in
const langRule = () => (lang ? `Язык реплик задал человек: ${lang}. Это важнее правила про язык.` : '')
const MOODS = ['happy', 'sad', 'tired', 'curious', 'grumpy'] as const
const ACTS: Action[] = ['sit', 'jump', 'dance', 'come', 'corners', 'sleep', 'refuse'] // what a remark may come with

const isHidden = atom({ plugin: 'clawd-runner', key: 'isHidden' } as const, false)
const pulse = atom({ plugin: 'clawd-runner', key: 'pulse' } as const, {
  seq: 0, col: 0, startle: 0, submit: 0, dance: 0, tools: 0,
} satisfies Pulse)
const mind = atom({ plugin: 'clawd-runner', key: 'mind' } as const, {
  welcome: 0, gloom: 0, wins: [0, 0, 0], thought: null, talk: false, order: null, noticed: 0, snub: 0,
} satisfies Mind as Mind)

const today = () => new Date().toISOString().slice(0, 10)
const recall = async ($: EngineInterface): Promise<Memory> => {
  const m = (await $.store.get('memory')) as Partial<Memory> | null
  const fresh = { lastSeen: 0, day: today(), errors: 0, wins: [0, 0, 0] as [number, number, number], notes: [] as string[] }
  if (!m) return fresh
  const sameDay = m.day === today()
  // Scores kept from before Pip have two numbers.
  const wins: [number, number, number] = [m.wins?.[0] ?? 0, m.wins?.[1] ?? 0, m.wins?.[2] ?? 0]
  return { ...fresh, ...m, wins, day: today(), errors: sameDay ? (m.errors ?? 0) : 0 }
}
const gloomOf = (errors: number) => Math.min(0.4, errors / 25)
// Something to recall days later: the newest five are kept.
const remember = async ($: EngineInterface, text: string) => {
  const memory = await recall($)
  await $.store.set('memory', { ...memory, notes: [...memory.notes, `${today()} ${text}`].slice(-5) })
}
const project = async ($: EngineInterface) => (await $.session.cwd()).split('/').pop() ?? ''

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
    const t = JSON.parse(json) as { who?: unknown; say?: unknown; mood?: unknown; act?: unknown }
    const say = typeof t.say === 'string' ? clip(t.say) : ''
    const mood = MOODS.find(m => m === t.mood) ?? 'curious'
    const act = ACTS.find(a => a === t.act)
    return say ? { id, who: whoOf(t.who), text: say, mood, ...(act ? { act } : {}) } : null
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
let lastActivity = Date.now()
let lastRemarkAt = 0
let turns = 0
let working = false
let thinking = false // one model call at a time
const said: string[] = []
const files: string[] = []
const commands: string[] = []
const thoughts: string[] = []
let lastSaid: { who: Who; text: string; at: number } | null = null
let lastWho: Who | null = null
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
  if (!working && now - lastActivity > IDLE) return
  const typing = now - lastEdit < TYPING && draft.length >= DRAFT_MIN
  if (typing && now - lastEdit < PAUSE) return
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
  const prompt = [
    `Проект: ${await project($)}. Сейчас ${new Date().toTimeString().slice(0, 5)}. Ошибок команд сегодня: ${memory.errors}.`,
    // The score only now and then, or right after a game: otherwise it is all they talk about.
    events.some(x => x.includes('догонялк')) || Math.random() < 0.15 ? `Счёт в догонялки: Клод ${memory.wins[0]}, Гладкий ${memory.wins[1]}, Пип ${memory.wins[2]}.` : '',
    lastWho !== null && !reply ? `Последним говорил ${NAMES[lastWho]}; теперь скорее очередь другого.` : '',
    feelings.length === 3 ? `Сейчас ${feelings.map((f, i) => `${NAMES[i]} ${f}`).join('; ')}. Говорят в этом настроении.` : '',
    `Что было недавно:\n${events.join('\n') || 'ничего особенного'}`,
    said.length ? `Последние сообщения человека агенту:\n${said.map(t => '- ' + t).join('\n')}` : '',
    draft ? `Человек прямо сейчас пишет (${Math.round((now - draftStart) / 1000)} с${fixes >= MANY_FIXES ? `, стёр ${fixes} раз` : ''}): «${tail(draft, 300)}»` : '',
    memory.notes.length && Math.random() < 0.25 ? `Помнят с прошлых дней (вспомни, только если к месту): ${memory.notes.join('; ')}` : '',
    files.length ? `Файлы, с которыми работал агент: ${files.join(', ')}` : '',
    commands.length ? `Команды: ${commands.join(' ; ')}` : '',
    thoughts.length ? `Уже говорили (не повторяйся): ${thoughts.join(' | ')}` : '',
    langRule(),
    reply && lastSaid ? `${NAMES[lastSaid.who]} только что сказал: «${lastSaid.text}». Пусть ответит ему кто-то другой (${others(lastSaid.who).map(i => `${NAMES[i]}, who ${i}`).join(' или ')}), как в разговоре друзей.`
    : typing ? 'Человек сейчас печатает. Отреагируй именно на то, что он пишет: подколи, подбодри или ответь по сути, будто подглядываешь через плечо.'
    : working ? 'Агент сейчас работает. Прокомментируй, что он делает: последние команды, файлы, ошибки.' : '',
  ].filter(Boolean).join('\n')
  const r = await $.model.complete({
    model,
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
  if (reply && lastSaid && thought.who === lastSaid.who) thought.who = others(lastSaid.who)[Math.random() < 0.5 ? 0 : 1]!
  lastSaid = reply ? null : { who: thought.who, text: thought.text, at: Date.now() }
  lastWho = thought.who
  lastRemarkAt = Date.now()
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
        feelings.length === 3 ? `Сейчас ${feelings.map((f, i) => `${NAMES[i]} ${f}`).join('; ')}.` : '',
        lastWho !== null ? `Последним говорил ${NAMES[lastWho]}; теперь скорее очередь другого.` : '',
        thoughts.length ? `Уже говорили (не повторяйся): ${thoughts.join(' | ')}` : '',
        langRule(),
        'Это глубокая реплика: вспомни что-то конкретное из всей этой сессии — давнее решение, переделку, странную просьбу человека — и съязви по этому поводу, связав с тем, что происходит сейчас.',
        'Если в сессии было что-то, что гномики припомнят и через неделю, добавь в JSON поле "remember": этот факт, до 80 символов, по-русски. Нечего помнить — поля нет.',
      ].filter(Boolean).join('\n\n'),
    })
    if ('usage' in r) await spent($, r.usage) // nothing to fork yet: no request, nothing spent
    if (!r.isAnswered) return
    const thought = parseThought(r.text, ((await read($, mind)).thought?.id ?? 0) + 1)
    if (!thought) return
    keep(thoughts, thought.text, 6)
    lastWho = thought.who
    lastSaid = { who: thought.who, text: thought.text, at: Date.now() }
    lastRemarkAt = Date.now()
    await update($, mind, x => ({ ...x, thought }))
    const note = /"remember"\s*:\s*"([^"]{3,120})"/.exec(r.text)?.[1]
    if (note) await remember($, `${await project($)}: ${note}`)
  } finally {
    thinking = false
    lastThought = Date.now()
  }
}

async function obey($: EngineInterface, text: string) {
  note(`человек приказал: ${text}`)
  await update($, mind, m => ({ ...m, noticed: m.noticed + 1 }))
  const r = await $.model.complete({ model, effort: 'low', maxTokens: 200, timeoutMs: 20000, system: [ORDER_SYSTEM, langRule()].filter(Boolean).join(' '), prompt: text })
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
      description: 'Hide or show Clawd; "/clawd talk" or "/clawd quiet" turns their remarks on or off; "/clawd model <name>" picks the model for them; "/clawd lang <language>" the language; anything else is an order to them',
      argumentHint: '[talk | quiet | stats | model <name> | lang <language> | order]',
    })
    const stored = Boolean(await $.store.get('isHidden'))
    const talk = ((await $.store.get('talking')) ?? true) !== false
    model = ((await $.store.get('model')) as string | null) ?? MODEL
    lang = ((await $.store.get('lang')) as string | null) ?? ''
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
      // Silenced right after a remark: they take it personally.
      const snubbed = !talk && Date.now() - lastRemarkAt < 15_000
      await update($, mind, m => ({ ...m, talk, snub: m.snub + (snubbed ? 1 : 0) }))
      if (snubbed) await remember($, 'человек заткнул их сразу после реплики')
      await $.store.set('talking', talk)
      if (talk) lastThought = Date.now() - THINK_EVERY + 20_000 // first remark in about half a minute

      return { text: talk ? `The Clawds will think out loud now and then (a ${model} call every 20 seconds or so).` : 'The Clawds keep their thoughts to themselves.' }
    }
    if (arg === 'model' || arg.startsWith('model ')) {
      const name = arg.slice('model'.length).trim()
      if (!name) return { text: `The Clawds talk through ${model}.` }
      model = name
      await $.store.set('model', name)
      complained = false
      return { text: `The Clawds will talk through ${name} now.` }
    }
    if (arg === 'lang' || arg.startsWith('lang ')) {
      const name = arg.slice('lang'.length).trim()
      if (!name) return { text: lang ? `The Clawds speak ${lang}.` : 'The Clawds speak the language you write in.' }
      lang = name === 'auto' ? '' : name
      await $.store.set('lang', lang)
      return { text: lang ? `The Clawds will speak ${lang} now.` : 'The Clawds will speak the language you write in.' }
    }
    if (arg === 'stats') {
      const u = (await $.store.get('usage')) as Usage | null
      if (!u || u.day !== today()) return { text: 'The Clawds have said nothing today.' }
      return { text: `Today the Clawds made ${u.calls} model calls: ${u.input} tokens in, ${u.output} out.` }
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
    lastActivity = now

    return box
  })

  on('prompt.submit', async ($, e, next) => {
    if (toThem(e.text) && !e.command) {
      void obey($, e.text) // whole, so the model sees whom it is for
      return { drop: 'Sent to the Clawds, not to the agent.' }
    }
    await update($, pulse, p => ({ ...p, submit: p.submit + 1 }))
    note('человек отправил сообщение агенту')
    lastActivity = Date.now()
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
    lastActivity = Date.now()
    // A moment after the turn, when the session holds its snapshot to fork from; not every turn, it reads the whole session.
    turns += 1
    if (turns % DEEP_EVERY === 0) $.clock.after(1500, () => void deep($))
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
        if (memory.errors + 1 === 20) await remember($, `${await project($)}: двадцать упавших команд за день`)
      } else {
        if (passed) {
          note(errorsInRow > 0 ? 'тесты прошли после ошибок' : 'тесты прошли')
          if (errorsInRow >= 5) await remember($, `${await project($)}: тесты прошли после ${errorsInRow} ошибок подряд`)
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
      feelings = data.feelings.filter((f): f is string => typeof f === 'string').slice(0, 3)
      return next(e)
    }
    if (data.tag !== 0 && data.tag !== 1 && data.tag !== 2) return next(e)
    const winner = data.tag
    const memory = await recall($)
    const wins: [number, number, number] = [...memory.wins]
    wins[winner] += 1
    await $.store.set('memory', { ...memory, wins })
    await update($, mind, m => ({ ...m, wins }))
    note(`${NAMES[winner]} поймал друга в догонялках`)

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
