import { Hono } from 'hono'
import { getPrisma } from '../lib/db.js'
import { getSession } from '../lib/session.js'
import openai, { MAX_OUTPUT_TOKENS } from '../lib/openai-client.js'
import { searchMemory } from '../lib/rag.js'
import { detectCrisis, CRISIS_RESPONSE } from '../lib/safety.js'
import { computeFingerprint, buildCloneSystemPrompt, type VoiceFingerprint } from '../lib/voice-fingerprint.js'

const aiRouter = new Hono()

// Build / rebuild clone profile
aiRouter.post('/clone-profile', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const rows = await prisma.messageRow.findMany({
    where: { dataset: { userId: sess.userId } },
    select: { text: true },
    take: 2000,
  })

  if (rows.length < 5) {
    return c.json({ error: 'Not enough messages. Import at least 5 messages first.' }, 400)
  }

  const texts = rows.map(r => r.text)

  // Step 1: Qualitative LLM analysis (topics, humor, slang only)
  const sample = texts.sort(() => Math.random() - 0.5).slice(0, 200).join('\n')
  let llmQuirks: { humorLevel?: string; bluntness?: string; commonTopics?: string[]; slang?: string[]; catchphrases?: string[] } = {}

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You analyze how a real person texts. Return ONLY valid JSON.' },
        { role: 'user', content: `Study these real messages. Extract ONLY qualitative personality traits — do NOT describe formatting or punctuation (we measure those separately).\n\n${sample}\n\nReturn JSON:\n{\n  "humorLevel": "how they use humor in 1 sentence",\n  "bluntness": "how direct/indirect they are in 1 sentence",\n  "commonTopics": ["up to 8 topics they return to"],\n  "slang": ["actual slang words or phrases they use"],\n  "catchphrases": ["phrases they repeat verbatim"]\n}` },
      ],
      max_tokens: 500,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    })
    llmQuirks = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
  } catch {
    // continue with empty qualitative data
  }

  // Step 2: Compute hard fingerprint
  const fp = computeFingerprint(texts, llmQuirks)

  // styleSummary is a human-readable description derived from stats
  const styleSummary = buildStyleSummary(fp)

  const profile = await prisma.cloneProfile.upsert({
    where: { userId: sess.userId },
    create: { userId: sess.userId, styleSummary, quirksJson: JSON.stringify(fp) },
    update: { styleSummary, quirksJson: JSON.stringify(fp), updatedAt: new Date() },
  })

  return c.json({
    id: profile.id,
    styleSummary,
    messageCount: texts.length,
    stats: {
      avgWords: fp.avgWords,
      lowercaseStartPct: fp.lowercaseStartPct,
      periodEndPct: fp.periodEndPct,
      shortMsgPct: fp.shortMsgPct,
    },
  })
})

// Get clone profile
aiRouter.get('/clone-profile', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const profile = await prisma.cloneProfile.findUnique({ where: { userId: sess.userId } })
  if (!profile) return c.json({ error: 'No profile yet' }, 404)

  const fp: VoiceFingerprint = JSON.parse(profile.quirksJson)
  return c.json({
    id: profile.id,
    styleSummary: profile.styleSummary,
    stats: {
      avgWords: fp.avgWords,
      lowercaseStartPct: fp.lowercaseStartPct,
      periodEndPct: fp.periodEndPct,
      shortMsgPct: fp.shortMsgPct,
      emojiPct: fp.emojiPct,
    },
    updatedAt: profile.updatedAt,
  })
})

// Chat with clone
aiRouter.post('/chat', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => null)
  const { sessionId, message, mode = 'raw' } = body ?? {}

  if (!sessionId || !message?.trim()) {
    return c.json({ error: 'sessionId and message are required' }, 400)
  }

  const prisma = getPrisma()
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: sess.userId } })
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const user = await prisma.user.findUnique({ where: { id: sess.userId } })
  if (!user) return c.json({ error: 'User not found' }, 401)

  if (detectCrisis(message)) {
    await prisma.chatMessage.createMany({
      data: [
        { sessionId, role: 'user', content: message },
        { sessionId, role: 'clone', content: CRISIS_RESPONSE },
      ],
    })
    return c.json({ content: CRISIS_RESPONSE, isCrisisResponse: true })
  }

  const profile = await prisma.cloneProfile.findUnique({ where: { userId: sess.userId } })
  if (!profile) return c.json({ error: 'No clone profile. Import texts first.' }, 400)

  const fp: VoiceFingerprint = JSON.parse(profile.quirksJson)

  const allMessages = await prisma.messageRow.findMany({
    where: { dataset: { userId: sess.userId } },
    select: { id: true, text: true },
    take: 2000,
  })
  const memoryExcerpts = searchMemory(allMessages, message, 6)

  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  history.reverse()

  const modeInstructions: Record<string, string> = {
    raw: 'completely unfiltered — raw, real, no softening.',
    soft: 'a touch warmer but still unmistakably them.',
    cold: 'minimal, dry, almost disengaged. still authentic.',
  }

  const systemPrompt = buildCloneSystemPrompt(fp, memoryExcerpts, modeInstructions[mode] ?? modeInstructions.raw)

  const openAiMessages = [
    { role: 'system' as const, content: systemPrompt },
    ...history.slice(-18).map(m => ({
      role: m.role === 'clone' ? 'assistant' as const : 'user' as const,
      content: m.content,
    })),
    { role: 'user' as const, content: message },
  ]

  let cloneResponse = ''
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openAiMessages,
      max_tokens: MAX_OUTPUT_TOKENS,
      temperature: 0.75,
      presence_penalty: 0.15,
      frequency_penalty: 0.1,
    })
    cloneResponse = completion.choices[0]?.message?.content ?? '…'
  } catch {
    return c.json({ error: 'AI temporarily unavailable' }, 502)
  }

  await prisma.chatMessage.createMany({
    data: [
      { sessionId, role: 'user', content: message },
      { sessionId, role: 'clone', content: cloneResponse },
    ],
  })
  await prisma.user.update({ where: { id: sess.userId }, data: { cloneReplyCount: { increment: 1 } } })

  return c.json({ content: cloneResponse, cloneReplyCount: user.cloneReplyCount + 1 })
})

// Generate opening message
aiRouter.post('/first-message', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => null)
  const { sessionId } = body ?? {}
  if (!sessionId) return c.json({ error: 'sessionId required' }, 400)

  const prisma = getPrisma()
  const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId: sess.userId } })
  if (!session) return c.json({ error: 'Session not found' }, 404)

  const existing = await prisma.chatMessage.count({ where: { sessionId } })
  if (existing > 0) return c.json({ error: 'Session already started' }, 409)

  const profile = await prisma.cloneProfile.findUnique({ where: { userId: sess.userId } })
  if (!profile) return c.json({ error: 'No profile' }, 400)

  const fp: VoiceFingerprint = JSON.parse(profile.quirksJson)

  const capsInstruction = fp.lowercaseStartPct >= 70 ? 'Start with lowercase.' : ''
  const periodInstruction = fp.periodEndPct <= 20 ? 'No period at the end.' : ''

  const prompt = [
    `You are a digital clone opening a chat with the real person you're based on. Write their first message.`,
    ``,
    `THEIR ACTUAL MESSAGES (match this style exactly):`,
    ...fp.styleAnchors.slice(0, 8).map(m => `"${m}"`),
    ``,
    `Rules:`,
    `- ${fp.medianWords} words is their typical message length. Stay close.`,
    capsInstruction,
    periodInstruction,
    `- Make it feel like catching mid-thought — no greeting, no "hi"`,
    `- Don't mention being an AI or clone. Just talk like them.`,
    `- Make it feel eerily accurate — reference something specific to their vibe`,
    ``,
    `Return only the message. Nothing else.`,
  ].filter(Boolean).join('\n')

  let content = ''
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.85,
    })
    content = completion.choices[0]?.message?.content?.trim() ?? '…'
  } catch {
    content = fp.styleAnchors[0] ?? 'okay this is weird'
  }

  await prisma.chatMessage.create({ data: { sessionId, role: 'clone', content } })
  await prisma.user.update({ where: { id: sess.userId }, data: { cloneReplyCount: { increment: 1 } } })

  return c.json({ content })
})

function buildStyleSummary(fp: VoiceFingerprint): string {
  const parts: string[] = []
  if (fp.lowercaseStartPct >= 70) parts.push(`types in lowercase`)
  if (fp.periodEndPct <= 20) parts.push(`skips periods`)
  if (fp.shortMsgPct >= 50) parts.push(`keeps it short`)
  if (fp.emojiPct < 5) parts.push(`no emojis`)
  if (fp.questionPct > 25) parts.push(`asks a lot of questions`)
  if (fp.topicAffinity.length > 0) parts.push(`talks about ${fp.topicAffinity.slice(0,3).join(', ')}`)
  return `${fp.totalMessages} messages analyzed. ${parts.join(', ')}. avg ${fp.avgWords} words per message.`
}

export default aiRouter
