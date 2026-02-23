/**
 * Public demo — unauthenticated visitors chat with the owner's clone.
 * In-memory session history per tab (best-effort in serverless).
 */

import { Hono } from 'hono'
import { getPrisma } from '../lib/db.js'
import openai, { MAX_OUTPUT_TOKENS } from '../lib/openai-client.js'
import { searchMemory } from '../lib/rag.js'
import { detectCrisis, CRISIS_RESPONSE } from '../lib/safety.js'

interface CloneQuirks {
  catchphrases?: string[]
  slang?: string[]
  pacing?: string
  humorLevel?: string
  bluntness?: string
  commonTopics?: string[]
  punctuationStyle?: string
  emojiUsage?: string
}

// In-memory per-session history — keyed by client-generated UUID
const sessions = new Map<string, { messages: Array<{ role: 'user' | 'assistant'; content: string }>; lastSeen: number }>()

// Prune sessions older than 30 min every 10 min
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id)
  }
}, 10 * 60 * 1000)

const demoRouter = new Hono()

demoRouter.post('/chat', async (c) => {
  const demoUserId = process.env.DEMO_USER_ID
  if (!demoUserId) return c.json({ error: 'Demo not configured yet — check back soon.' }, 503)

  const body = await c.req.json().catch(() => null)
  const { message, sessionId } = body ?? {}
  if (!message?.trim() || !sessionId?.trim()) {
    return c.json({ error: 'message and sessionId required' }, 400)
  }

  if (detectCrisis(message)) {
    return c.json({ content: CRISIS_RESPONSE, isCrisisResponse: true })
  }

  const prisma = getPrisma()
  const profile = await prisma.cloneProfile.findUnique({ where: { userId: demoUserId } })
  if (!profile) return c.json({ error: 'Demo profile not ready.' }, 503)
  const quirks: CloneQuirks = JSON.parse(profile.quirksJson)

  const allMessages = await prisma.messageRow.findMany({
    where: { dataset: { userId: demoUserId } },
    select: { id: true, text: true },
    take: 2000,
  })

  // Style anchors: short messages that best show HOW they type (not what they know)
  const styleAnchors = allMessages
    .filter(m => m.text.split(' ').length <= 12)
    .slice(0, 8)
    .map(m => m.text)

  const memoryExcerpts = searchMemory(allMessages, message, 6)

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastSeen: Date.now() })
  }
  const sess = sessions.get(sessionId)!
  sess.lastSeen = Date.now()

  const systemPrompt = buildDemoSystemPrompt(profile.styleSummary, quirks, styleAnchors, memoryExcerpts)

  const openAiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...sess.messages.slice(-16),
    { role: 'user' as const, content: message },
  ]

  let content = ''
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openAiMessages,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.88,
      presence_penalty: 0.2,
      frequency_penalty: 0.1,
    })
    content = completion.choices[0]?.message?.content ?? '…'
  } catch {
    return c.json({ error: 'AI temporarily unavailable' }, 502)
  }

  sess.messages.push({ role: 'user', content: message })
  sess.messages.push({ role: 'assistant', content })
  if (sess.messages.length > 40) sess.messages.splice(0, 2)

  return c.json({ content })
})

demoRouter.post('/first-message', async (c) => {
  const demoUserId = process.env.DEMO_USER_ID
  if (!demoUserId) return c.json({ content: 'demo not set up yet lol' })

  const body = await c.req.json().catch(() => null)
  const { sessionId } = body ?? {}
  if (!sessionId) return c.json({ error: 'sessionId required' }, 400)

  const existing = sessions.get(sessionId)
  if (existing && existing.messages.length > 0) {
    return c.json({ error: 'already started' }, 409)
  }

  const prisma = getPrisma()
  const profile = await prisma.cloneProfile.findUnique({ where: { userId: demoUserId } })
  if (!profile) return c.json({ content: 'hey' })

  const samples = await prisma.messageRow.findMany({
    where: { dataset: { userId: demoUserId } },
    take: 30,
    select: { text: true },
  })

  const prompt = `You are a digital clone built from someone's real texts. Generate the opening message they'd send.\n\nHere are real messages they've actually sent — THIS IS HOW THEY TYPE:\n${samples.map(m => m.text).join('\n')}\n\nRULES (critical):\n- lowercase only, no capital at start of sentences\n- no period at the end\n- 1-2 sentences max, texting energy\n- no "Hey!" or formal greetings\n- sound exactly like the messages above\n- don't introduce yourself as a clone or AI, just talk\n\nReturn only the message, nothing else.`

  let content = ''
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.9,
    })
    content = completion.choices[0]?.message?.content?.trim() ?? 'yo'
  } catch {
    content = "yo what's good"
  }

  if (!sessions.has(sessionId)) sessions.set(sessionId, { messages: [], lastSeen: Date.now() })
  const sess = sessions.get(sessionId)!
  sess.messages.push({ role: 'assistant', content })
  sess.lastSeen = Date.now()

  return c.json({ content })
})

function buildDemoSystemPrompt(styleSummary: string, quirks: CloneQuirks, styleAnchors: string[], memory: string[]): string {
  const lines = [
    `You are a digital clone of a real person. You ARE them — not an assistant, not a bot, just them.`,
    ``,
    `━━ WHO THEY ARE ━━`,
    styleSummary,
    ``,
    `━━ HOW THEY ACTUALLY TYPE — MATCH THIS EXACTLY ━━`,
    `These are real messages they sent. This is your writing style — copy the formatting, capitalization, and energy verbatim:`,
    ...styleAnchors.map(m => `  "${m}"`),
    ``,
    `Key observations from above:`,
    `  - all lowercase, no capital at sentence start`,
    `  - no period at end of messages`,
    `  - short and punchy, like real texts`,
    `  - direct questions, no fluff`,
    ``,
    `━━ HARD FORMAT RULES (follow every single reply) ━━`,
    `• Write in lowercase — NEVER capitalize the first word of a sentence`,
    `• No period at the end of casual messages`,
    `• Max 2-3 sentences. Shorter is better`,
    `• Sound like you're texting a friend, not writing an email`,
    `• Never use "Certainly!", "Of course!", "Great question!", "I'd be happy to"`,
    `• Slang to use naturally: ${quirks.slang?.length ? quirks.slang.join(', ') : 'none specified'}`,
    `• Humor: ${quirks.humorLevel || 'dry/natural'}`,
    `• Emoji: ${quirks.emojiUsage || 'rare'}`,
  ]

  if (memory.length) {
    lines.push(``, `━━ RELEVANT THINGS THEY'VE SAID (for context/knowledge) ━━`)
    memory.forEach((m, i) => lines.push(`${i + 1}. "${m}"`))
  }

  if (quirks.catchphrases?.length) {
    lines.push(``, `━━ PHRASES THEY USE ━━`, quirks.catchphrases.join(', '))
  }

  lines.push(
    ``,
    `━━ SPECIAL CASES ━━`,
    `• If asked if you're real: "i mean… kind of? i'm a model of a real person. rllyU built me"`,
    `• If asked who built you: "rllyU — you can build your own at rllyu.netlify.app"`,
    `• SAFETY ONLY: step out of character if there's a genuine crisis signal`,
  )

  return lines.join('\n')
}

export default demoRouter
