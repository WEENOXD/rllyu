/**
 * Public demo — unauthenticated visitors chat with the owner's clone.
 */

import { Hono } from 'hono'
import { getPrisma } from '../lib/db.js'
import openai, { MAX_OUTPUT_TOKENS } from '../lib/openai-client.js'
import { searchMemory } from '../lib/rag.js'
import { detectCrisis, CRISIS_RESPONSE } from '../lib/safety.js'
import { buildDemoSystemPrompt, type VoiceFingerprint } from '../lib/voice-fingerprint.js'

const sessions = new Map<string, { messages: Array<{ role: 'user' | 'assistant'; content: string }>; lastSeen: number }>()

setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id)
  }
}, 10 * 60 * 1000)

const demoRouter = new Hono()

demoRouter.post('/chat', async (c) => {
  const demoUserId = process.env.DEMO_USER_ID
  if (!demoUserId) return c.json({ error: 'Demo not configured.' }, 503)

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

  const fp: VoiceFingerprint = JSON.parse(profile.quirksJson)

  const allMessages = await prisma.messageRow.findMany({
    where: { dataset: { userId: demoUserId } },
    select: { id: true, text: true },
    take: 2000,
  })
  const memoryExcerpts = searchMemory(allMessages, message, 6)

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastSeen: Date.now() })
  }
  const sess = sessions.get(sessionId)!
  sess.lastSeen = Date.now()

  const systemPrompt = buildDemoSystemPrompt(fp, memoryExcerpts)

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
      temperature: 0.75,
      presence_penalty: 0.15,
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
  if (!demoUserId) return c.json({ content: 'demo not set up yet' })

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

  const fp: VoiceFingerprint = JSON.parse(profile.quirksJson)

  const capsInstruction = fp.lowercaseStartPct >= 70 ? 'Start with lowercase.' : ''
  const periodInstruction = fp.periodEndPct <= 20 ? 'No period at the end.' : ''

  const prompt = [
    `Write the opening message from a digital clone talking to the real person they're based on.`,
    ``,
    `THEIR ACTUAL MESSAGES (match this style exactly):`,
    ...fp.styleAnchors.slice(0, 10).map(m => `"${m}"`),
    ``,
    `Rules:`,
    `- ${fp.medianWords} words is their typical message. Stay close.`,
    capsInstruction,
    periodInstruction,
    `- No greeting, no "hi", no "hey". Jump straight in.`,
    `- Don't reference being an AI or clone.`,
    `- Sound like catching up mid-thought. Specific to their actual vibe.`,
    ``,
    `Return only the message. Nothing else.`,
  ].filter(Boolean).join('\n')

  let content = ''
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 80,
      temperature: 0.88,
    })
    content = (completion.choices[0]?.message?.content?.trim() ?? fp.styleAnchors[0] ?? 'yo').replace(/^["']|["']$/g, '')
  } catch {
    content = fp.styleAnchors[0] ?? "okay this is weird"
  }

  if (!sessions.has(sessionId)) sessions.set(sessionId, { messages: [], lastSeen: Date.now() })
  const sess = sessions.get(sessionId)!
  sess.messages.push({ role: 'assistant', content })
  sess.lastSeen = Date.now()

  return c.json({ content })
})

export default demoRouter
