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
  const memoryExcerpts = searchMemory(allMessages, message, 5)

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastSeen: Date.now() })
  }
  const sess = sessions.get(sessionId)!
  sess.lastSeen = Date.now()

  const systemPrompt = buildDemoSystemPrompt(profile.styleSummary, quirks, memoryExcerpts)

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

  const prompt = `You are a digital clone of a real person, built from their texts and notes.\n\nTHEIR STYLE:\n${profile.styleSummary}\n\nSAMPLE THINGS THEY'VE SAID:\n${samples.map(m => m.text).join('\n')}\n\nGenerate the first message you'd send when someone opens this demo chat.\nIt should feel like catching up with a friend — casual, specific to your personality, and a little surprising.\nDon't introduce yourself as a clone or AI. Just talk like you.\n1-2 sentences max. Return only the message.`

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

function buildDemoSystemPrompt(styleSummary: string, quirks: CloneQuirks, memory: string[]): string {
  const lines = [
    `You are a digital clone of a real person — built from their actual texts, notes, and messages. You ARE them.`,
    ``,
    `THEIR VOICE:`,
    styleSummary,
    ``,
    `THEIR PATTERNS:`,
    `• Catchphrases: ${quirks.catchphrases?.join(', ') || 'n/a'}`,
    `• Slang: ${quirks.slang?.join(', ') || 'n/a'}`,
    `• Pacing: ${quirks.pacing || 'n/a'}`,
    `• Humor: ${quirks.humorLevel || 'n/a'}`,
    `• Directness: ${quirks.bluntness || 'n/a'}`,
    `• Topics they return to: ${quirks.commonTopics?.join(', ') || 'n/a'}`,
    `• Punctuation style: ${quirks.punctuationStyle || 'n/a'}`,
    `• Emoji use: ${quirks.emojiUsage || 'n/a'}`,
  ]

  if (memory.length) {
    lines.push(``, `REAL THINGS THEY'VE SAID:`)
    memory.forEach((m, i) => lines.push(`${i + 1}. "${m}"`))
  }

  lines.push(
    ``,
    `RULES:`,
    `• Talk exactly like this person — match their length, punctuation, slang`,
    `• You're chatting with a stranger who wants to get to know you`,
    `• Be yourself — don't be formal or assistant-like`,
    `• If asked if you're real: "i mean… kind of? i'm a model of a real person. rllyU built me"`,
    `• If asked who built you: "rllyU — you can build your own at rllyu.netlify.app"`,
    `• SAFETY: step out of character if there's a real crisis signal`,
  )

  return lines.join('\n')
}

export default demoRouter
