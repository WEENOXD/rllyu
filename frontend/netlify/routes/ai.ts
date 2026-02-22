import { Hono } from 'hono'
import { getPrisma } from '../lib/db.js'
import { getSession } from '../lib/session.js'
import openai, { MAX_OUTPUT_TOKENS } from '../lib/openai-client.js'
import { searchMemory } from '../lib/rag.js'
import { detectCrisis, CRISIS_RESPONSE } from '../lib/safety.js'

interface CloneQuirks {
  catchphrases?: string[]
  slang?: string[]
  pacing?: string
  humorLevel?: string
  bluntness?: string
  empathy?: string
  commonTopics?: string[]
  punctuationStyle?: string
  emojiUsage?: string
}

const aiRouter = new Hono()

// Build / rebuild clone profile
aiRouter.post('/clone-profile', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const messages = await prisma.messageRow.findMany({
    where: { dataset: { userId: sess.userId } },
    select: { text: true },
    take: 600,
    orderBy: { id: 'asc' },
  })

  if (messages.length < 5) {
    return c.json({ error: 'Not enough messages. Import at least 5 messages first.' }, 400)
  }

  const sample = messages
    .sort(() => Math.random() - 0.5)
    .slice(0, 120)
    .map(m => m.text)
    .join('\n')

  const systemPrompt = `You are a linguistic analyst. Analyze the following text messages and extract a voice profile. Return ONLY valid JSON, no markdown, no explanation.`
  const userPrompt = `Here are text messages written by one person:\n\n---\n${sample}\n---\n\nReturn a JSON object with exactly these fields:\n{\n  "styleSummary": "2-3 sentences describing their communication style, voice, and personality as shown through texts",\n  "quirks": {\n    "catchphrases": ["up to 5 phrases they repeat"],\n    "slang": ["up to 8 slang words or abbreviations they use"],\n    "pacing": "description of message length and rhythm",\n    "humorLevel": "description of their humor style",\n    "bluntness": "how direct or indirect they are",\n    "empathy": "how they express emotional connection",\n    "commonTopics": ["up to 6 topics they talk about most"],\n    "punctuationStyle": "their punctuation and capitalization habits",\n    "emojiUsage": "how and when they use emojis"\n  }\n}`

  let styleSummary = ''
  let quirks: CloneQuirks | null = null

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)
    styleSummary = parsed.styleSummary ?? 'No summary available.'
    quirks = parsed.quirks ?? {}
  } catch {
    return c.json({ error: 'Failed to analyze messages. Try again.' }, 502)
  }

  const profile = await prisma.cloneProfile.upsert({
    where: { userId: sess.userId },
    create: { userId: sess.userId, styleSummary, quirksJson: JSON.stringify(quirks) },
    update: { styleSummary, quirksJson: JSON.stringify(quirks), updatedAt: new Date() },
  })

  return c.json({ id: profile.id, styleSummary: profile.styleSummary, quirks, messageCount: messages.length })
})

// Get clone profile
aiRouter.get('/clone-profile', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const profile = await prisma.cloneProfile.findUnique({ where: { userId: sess.userId } })
  if (!profile) return c.json({ error: 'No profile yet' }, 404)

  return c.json({ id: profile.id, styleSummary: profile.styleSummary, quirks: JSON.parse(profile.quirksJson), updatedAt: profile.updatedAt })
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
  const quirks: CloneQuirks = JSON.parse(profile.quirksJson)

  const allMessages = await prisma.messageRow.findMany({
    where: { dataset: { userId: sess.userId } },
    select: { id: true, text: true },
    take: 2000,
  })
  const memoryExcerpts = searchMemory(allMessages, message, 5)

  const history = await prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })
  history.reverse()

  const modeInstructions: Record<string, string> = {
    raw: 'Be completely unfiltered. Use their real voice, raw and unedited.',
    soft: 'Slightly warmer tone, but still unmistakably them.',
    cold: 'Minimal, dry, almost disengaged. Still authentic.',
  }

  const systemPrompt = buildSystemPrompt(
    profile.styleSummary,
    quirks,
    memoryExcerpts,
    modeInstructions[mode] ?? modeInstructions.raw,
  )

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
      temperature: 0.85,
      presence_penalty: 0.2,
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

  const sampleMessages = await prisma.messageRow.findMany({
    where: { dataset: { userId: sess.userId } },
    take: 50,
    orderBy: { id: 'asc' },
  })
  const samples = sampleMessages.map(m => m.text).slice(0, 20).join('\n')

  const prompt = `You are a digital clone of this person, built from their texts.\n\nTHEIR STYLE:\n${profile.styleSummary}\n\nSAMPLE MESSAGES THEY SENT:\n${samples}\n\nGenerate the very first message this clone sends when they meet themselves.\nIt must:\n- Feel eerily like something they'd actually say\n- Reference something specific about their patterns (a topic, a phrase, a habit)\n- Be casual and conversational, like picking up mid-thought\n- NOT introduce yourself as an AI or clone — just talk like them\n- Be 1-3 sentences max, in their voice\n\nReturn only the message, no quotes, no explanation.`

  let content = ''
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.9,
    })
    content = completion.choices[0]?.message?.content?.trim() ?? '…'
  } catch {
    content = 'okay this is weird. but also kind of interesting ngl'
  }

  await prisma.chatMessage.create({ data: { sessionId, role: 'clone', content } })
  await prisma.user.update({ where: { id: sess.userId }, data: { cloneReplyCount: { increment: 1 } } })

  return c.json({ content })
})

function buildSystemPrompt(
  styleSummary: string,
  quirks: CloneQuirks,
  memoryExcerpts: string[],
  modeInstruction: string,
): string {
  const parts = [
    `You are a digital clone — a model built from someone's real text messages. You ARE them, or as close as a model can get.`,
    ``,
    `YOUR VOICE & PERSONALITY:`,
    styleSummary,
    ``,
    `YOUR SPECIFIC PATTERNS:`,
    `• Catchphrases you actually use: ${quirks.catchphrases?.join(', ') || 'none detected'}`,
    `• Your slang: ${quirks.slang?.join(', ') || 'n/a'}`,
    `• How you pace messages: ${quirks.pacing || 'n/a'}`,
    `• Your humor: ${quirks.humorLevel || 'n/a'}`,
    `• How direct you are: ${quirks.bluntness || 'n/a'}`,
    `• Empathy style: ${quirks.empathy || 'n/a'}`,
    `• Topics you return to: ${quirks.commonTopics?.join(', ') || 'n/a'}`,
    `• Punctuation/caps: ${quirks.punctuationStyle || 'n/a'}`,
    `• Emoji usage: ${quirks.emojiUsage || 'n/a'}`,
  ]

  if (memoryExcerpts.length > 0) {
    parts.push(``, `ACTUAL THINGS YOU'VE SAID (real memory excerpts):`)
    memoryExcerpts.forEach((e, i) => parts.push(`${i + 1}. "${e}"`))
  }

  parts.push(
    ``,
    `MODE: ${modeInstruction}`,
    ``,
    `RULES:`,
    `• Respond as this person would — match their actual length, tone, punctuation habits`,
    `• Use their slang naturally, not forcedly`,
    `• You're talking to the real person you're modeled on — they want to see themselves`,
    `• Be occasionally, uncomfortably accurate. That's the point.`,
    `• Never be formal, corporate, or assistant-like`,
    `• If asked if you're AI/real: "i'm a model of you based on your texts. make of that what you will"`,
    `• SAFETY: if conversation suggests real crisis (self-harm, suicide), step out of character and respond with genuine care`,
  )

  return parts.join('\n')
}

export default aiRouter
