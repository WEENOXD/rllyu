import type { FastifyPluginAsync } from 'fastify'
import prisma from '../lib/prisma.js'
import openai, { MAX_OUTPUT_TOKENS } from '../lib/openai.js'
import { searchMemory } from '../lib/rag.js'
import { detectCrisis, CRISIS_RESPONSE } from '../lib/safety.js'
import type { CloneQuirks } from '../types.js'

// No reply limit — free for everyone

export const aiRoutes: FastifyPluginAsync = async (app) => {
  // Build / rebuild clone profile from imported messages
  app.post('/clone-profile', {
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    // Gather all user messages
    const messages = await prisma.messageRow.findMany({
      where: { dataset: { userId } },
      select: { text: true },
      take: 600,
      orderBy: { id: 'asc' },
    })

    if (messages.length < 5) {
      return reply.status(400).send({ error: 'Not enough messages to build a profile. Import at least 5 messages.' })
    }

    // Sample messages for the prompt (keep it affordable)
    const sample = messages
      .sort(() => Math.random() - 0.5)
      .slice(0, 120)
      .map(m => m.text)
      .join('\n')

    const systemPrompt = `You are a linguistic analyst. Analyze the following text messages and extract a voice profile. Return ONLY valid JSON, no markdown, no explanation.`

    const userPrompt = `Here are text messages written by one person:

---
${sample}
---

Return a JSON object with exactly these fields:
{
  "styleSummary": "2-3 sentences describing their communication style, voice, and personality as shown through texts",
  "quirks": {
    "catchphrases": ["up to 5 phrases they repeat"],
    "slang": ["up to 8 slang words or abbreviations they use"],
    "pacing": "description of message length and rhythm (e.g. 'rapid-fire single sentences, rarely uses paragraphs')",
    "humorLevel": "description of their humor style",
    "bluntness": "how direct or indirect they are",
    "empathy": "how they express emotional connection",
    "commonTopics": ["up to 6 topics they talk about most"],
    "punctuationStyle": "their punctuation and capitalization habits",
    "emojiUsage": "how and when they use emojis"
  }
}`

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
    } catch (err) {
      app.log.error(err, 'Failed to build clone profile via OpenAI')
      return reply.status(502).send({ error: 'Failed to analyze messages. Try again.' })
    }

    // Upsert profile
    const profile = await prisma.cloneProfile.upsert({
      where: { userId },
      create: { userId, styleSummary, quirksJson: JSON.stringify(quirks) },
      update: { styleSummary, quirksJson: JSON.stringify(quirks), updatedAt: new Date() },
    })

    return reply.send({
      id: profile.id,
      styleSummary: profile.styleSummary,
      quirks,
      messageCount: messages.length,
    })
  })

  // Get clone profile
  app.get('/clone-profile', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const profile = await prisma.cloneProfile.findUnique({ where: { userId } })
    if (!profile) return reply.status(404).send({ error: 'No profile yet' })

    return reply.send({
      id: profile.id,
      styleSummary: profile.styleSummary,
      quirks: JSON.parse(profile.quirksJson),
      updatedAt: profile.updatedAt,
    })
  })

  // Chat with clone
  app.post('/chat', {
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const { sessionId, message, mode = 'raw' } = req.body as {
      sessionId: string
      message: string
      mode?: 'raw' | 'soft' | 'cold'
    }

    if (!sessionId || !message?.trim()) {
      return reply.status(400).send({ error: 'sessionId and message are required' })
    }

    // Validate session ownership
    const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId } })
    if (!session) return reply.status(404).send({ error: 'Session not found' })

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return reply.status(401).send({ error: 'User not found' })

    // Safety check on user message
    if (detectCrisis(message)) {
      // Save the user message and crisis response
      await prisma.chatMessage.createMany({
        data: [
          { sessionId, role: 'user', content: message },
          { sessionId, role: 'clone', content: CRISIS_RESPONSE },
        ],
      })
      return reply.send({ content: CRISIS_RESPONSE, isCrisisResponse: true })
    }

    // Load clone profile
    const profile = await prisma.cloneProfile.findUnique({ where: { userId } })
    if (!profile) {
      return reply.status(400).send({ error: 'No clone profile. Import texts first.' })
    }
    const quirks: CloneQuirks = JSON.parse(profile.quirksJson)

    // Load all user messages for RAG
    const allMessages = await prisma.messageRow.findMany({
      where: { dataset: { userId } },
      select: { id: true, text: true },
      take: 2000,
    })

    // Find relevant memory excerpts
    const memoryExcerpts = searchMemory(allMessages, message, 5)

    // Load recent chat history
    const history = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    })
    history.reverse()

    // Build system prompt
    const modeInstructions = {
      raw: 'Be completely unfiltered. Use their real voice, raw and unedited.',
      soft: 'Slightly warmer tone, but still unmistakably them.',
      cold: 'Minimal, dry, almost disengaged. Still authentic.',
    }

    const systemPrompt = buildSystemPrompt(profile.styleSummary, quirks, memoryExcerpts, modeInstructions[mode as keyof typeof modeInstructions] ?? modeInstructions.raw)

    // Build messages for OpenAI
    const openAiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-18).map(m => ({
        role: m.role === 'clone' ? 'assistant' as const : 'user' as const,
        content: m.content,
      })),
      { role: 'user', content: message },
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
    } catch (err) {
      app.log.error(err, 'OpenAI chat error')
      return reply.status(502).send({ error: 'AI temporarily unavailable' })
    }

    // Save messages and increment counter
    await prisma.chatMessage.createMany({
      data: [
        { sessionId, role: 'user', content: message },
        { sessionId, role: 'clone', content: cloneResponse },
      ],
    })

    await prisma.user.update({
      where: { id: userId },
      data: { cloneReplyCount: { increment: 1 } },
    })

    return reply.send({
      content: cloneResponse,
      cloneReplyCount: user.cloneReplyCount + 1,
    })
  })

  // Generate the "holy sh*t" first message
  app.post('/first-message', {
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { sessionId } = req.body as { sessionId: string }

    const session = await prisma.chatSession.findFirst({ where: { id: sessionId, userId } })
    if (!session) return reply.status(404).send({ error: 'Session not found' })

    // Check if session already has messages
    const existing = await prisma.chatMessage.count({ where: { sessionId } })
    if (existing > 0) return reply.status(409).send({ error: 'Session already started' })

    const profile = await prisma.cloneProfile.findUnique({ where: { userId } })
    if (!profile) return reply.status(400).send({ error: 'No profile' })

    const quirks: CloneQuirks = JSON.parse(profile.quirksJson)

    // Sample a few real messages for the opening
    const sampleMessages = await prisma.messageRow.findMany({
      where: { dataset: { userId } },
      take: 50,
      orderBy: { id: 'asc' },
    })
    const samples = sampleMessages.map(m => m.text).slice(0, 20).join('\n')

    const prompt = `You are a digital clone of this person, built from their texts.

THEIR STYLE:
${profile.styleSummary}

SAMPLE MESSAGES THEY SENT:
${samples}

Generate the very first message this clone sends when they meet themselves.
It must:
- Feel eerily like something they'd actually say
- Reference something specific about their patterns (a topic, a phrase, a habit)
- Be casual and conversational, like picking up mid-thought
- NOT introduce yourself as an AI or clone — just talk like them
- Be 1-3 sentences max, in their voice

Return only the message, no quotes, no explanation.`

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

    await prisma.chatMessage.create({
      data: { sessionId, role: 'clone', content },
    })

    await prisma.user.update({
      where: { id: userId },
      data: { cloneReplyCount: { increment: 1 } },
    })

    return reply.send({ content })
  })
}

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

// Import type fix
import type OpenAI from 'openai'
