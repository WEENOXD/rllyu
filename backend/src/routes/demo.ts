/**
 * Public demo — lets unauthenticated visitors chat with the owner's clone.
 * Rate-limited by IP. Session history lives in memory (resets on redeploy, fine for demo).
 */

import type { FastifyPluginAsync } from 'fastify'
import prisma from '../lib/prisma.js'
import openai, { MAX_OUTPUT_TOKENS } from '../lib/openai.js'
import { searchMemory } from '../lib/rag.js'
import { detectCrisis, CRISIS_RESPONSE } from '../lib/safety.js'
import type { CloneQuirks } from '../types.js'

// In-memory per-session history — keyed by client-generated UUID
const sessions = new Map<string, { messages: Array<{ role: 'user' | 'assistant'; content: string }>; lastSeen: number }>()

// Prune sessions older than 30 min every 10 min
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000
  for (const [id, s] of sessions) {
    if (s.lastSeen < cutoff) sessions.delete(id)
  }
}, 10 * 60 * 1000)

export const demoRoutes: FastifyPluginAsync = async (app) => {
  app.post('/chat', {
    config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const demoUserId = process.env.DEMO_USER_ID
    if (!demoUserId) {
      return reply.status(503).send({ error: 'Demo not configured yet — check back soon.' })
    }

    const { message, sessionId } = req.body as { message: string; sessionId: string }
    if (!message?.trim() || !sessionId?.trim()) {
      return reply.status(400).send({ error: 'message and sessionId required' })
    }

    if (detectCrisis(message)) {
      return reply.send({ content: CRISIS_RESPONSE, isCrisisResponse: true })
    }

    // Load clone profile
    const profile = await prisma.cloneProfile.findUnique({ where: { userId: demoUserId } })
    if (!profile) {
      return reply.status(503).send({ error: 'Demo profile not ready.' })
    }
    const quirks: CloneQuirks = JSON.parse(profile.quirksJson)

    // Load memory
    const allMessages = await prisma.messageRow.findMany({
      where: { dataset: { userId: demoUserId } },
      select: { id: true, text: true },
      take: 2000,
    })
    const memoryExcerpts = searchMemory(allMessages, message, 5)

    // Per-session history
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, { messages: [], lastSeen: Date.now() })
    }
    const sess = sessions.get(sessionId)!
    sess.lastSeen = Date.now()

    const systemPrompt = buildDemoSystemPrompt(profile.styleSummary, quirks, memoryExcerpts)

    const openAiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...sess.messages.slice(-16),
      { role: 'user', content: message },
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
      return reply.status(502).send({ error: 'AI temporarily unavailable' })
    }

    // Persist to session history (cap at 40 messages)
    sess.messages.push({ role: 'user', content: message })
    sess.messages.push({ role: 'assistant', content })
    if (sess.messages.length > 40) sess.messages.splice(0, 2)

    return reply.send({ content })
  })

  // First message — proactively opens the demo
  app.post('/first-message', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const demoUserId = process.env.DEMO_USER_ID
    if (!demoUserId) return reply.send({ content: 'demo not set up yet lol' })

    const { sessionId } = req.body as { sessionId: string }
    if (!sessionId) return reply.status(400).send({ error: 'sessionId required' })

    // Only fire once per session
    const existing = sessions.get(sessionId)
    if (existing && existing.messages.length > 0) {
      return reply.status(409).send({ error: 'already started' })
    }

    const profile = await prisma.cloneProfile.findUnique({ where: { userId: demoUserId } })
    if (!profile) return reply.send({ content: 'hey' })

    const samples = await prisma.messageRow.findMany({
      where: { dataset: { userId: demoUserId } },
      take: 30,
      select: { text: true },
    })

    const prompt = `You are a digital clone of a real person, built from their texts and notes.

THEIR STYLE:
${profile.styleSummary}

SAMPLE THINGS THEY'VE SAID:
${samples.map(m => m.text).join('\n')}

Generate the first message you'd send when someone opens this demo chat.
It should feel like catching up with a friend — casual, specific to your personality, and a little surprising.
Don't introduce yourself as a clone or AI. Just talk like you.
1-2 sentences max. Return only the message.`

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

    return reply.send({ content })
  })
}

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
