/**
 * Computes a precise linguistic fingerprint from raw messages.
 * Hard stats, not LLM interpretations.
 */

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','have','has','had','do','does',
  'did','will','would','could','should','may','might','i','me','my','we',
  'you','your','he','she','it','they','this','that','what','how','when',
  'where','why','if','its','us','can','just','so','no','not','yeah',
  'like','get','got','ok','okay','lol','im','dont','cant','its','thats',
])

function hasEmoji(text: string): boolean {
  return /\p{Emoji_Presentation}/u.test(text)
}

export interface VoiceFingerprint {
  // Computed stats
  totalMessages: number
  avgWords: number
  medianWords: number
  shortMsgPct: number
  lowercaseStartPct: number
  periodEndPct: number
  questionPct: number
  ellipsisPct: number
  emojiPct: number
  exclamationPct: number
  topWords: string[]

  // Curated examples
  styleAnchors: string[]
  reactionExamples: string[]

  // LLM qualitative (set after analysis, defaults ok)
  humorStyle: string
  topicAffinity: string[]
  bluntness: string
  slang: string[]
  catchphrases: string[]
}

export function computeFingerprint(
  messages: string[],
  llmQuirks?: {
    humorLevel?: string
    bluntness?: string
    commonTopics?: string[]
    slang?: string[]
    catchphrases?: string[]
  }
): VoiceFingerprint {
  const msgs = messages.filter(m => m.trim().length > 0)
  if (msgs.length === 0) {
    return {
      totalMessages: 0, avgWords: 0, medianWords: 0, shortMsgPct: 0,
      lowercaseStartPct: 0, periodEndPct: 0, questionPct: 0,
      ellipsisPct: 0, emojiPct: 0, exclamationPct: 0,
      topWords: [], styleAnchors: [], reactionExamples: [],
      humorStyle: '', topicAffinity: [], bluntness: '', slang: [], catchphrases: [],
    }
  }

  const wordCounts = msgs.map(m => m.trim().split(/\s+/).filter(Boolean).length)
  const totalWords = wordCounts.reduce((a, b) => a + b, 0)
  const avgWords = Math.round(totalWords / msgs.length)
  const sortedCounts = [...wordCounts].sort((a, b) => a - b)
  const medianWords = sortedCounts[Math.floor(sortedCounts.length / 2)]
  const shortMsgPct = Math.round((wordCounts.filter(c => c <= 5).length / msgs.length) * 100)

  const lowercaseStartPct = Math.round(
    (msgs.filter(m => /^[a-z]/.test(m.trim())).length / msgs.length) * 100
  )
  const periodEndPct = Math.round(
    (msgs.filter(m => /\.\s*$/.test(m.trim())).length / msgs.length) * 100
  )
  const questionPct = Math.round(
    (msgs.filter(m => /\?\s*$/.test(m.trim())).length / msgs.length) * 100
  )
  const ellipsisPct = Math.round(
    (msgs.filter(m => /\.{3}|…/.test(m)).length / msgs.length) * 100
  )
  const emojiPct = Math.round(
    (msgs.filter(m => hasEmoji(m)).length / msgs.length) * 100
  )
  const exclamationPct = Math.round(
    (msgs.filter(m => /!/.test(m)).length / msgs.length) * 100
  )

  const wordFreq = new Map<string, number>()
  for (const msg of msgs) {
    const words = msg.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    for (const w of words) {
      if (w.length > 1 && !STOP_WORDS.has(w)) {
        wordFreq.set(w, (wordFreq.get(w) ?? 0) + 1)
      }
    }
  }
  const topWords = [...wordFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([w]) => w)

  // Style anchors: short, clean, conversational messages
  const styleAnchors = msgs
    .filter(m => {
      const wc = m.trim().split(/\s+/).length
      return wc >= 3 && wc <= 15 && !m.includes('\n') && !m.startsWith('http') && !m.includes('```')
    })
    .slice(0, 12)

  // Reaction examples: 1–3 word responses
  const reactionExamples = msgs
    .filter(m => {
      const wc = m.trim().split(/\s+/).length
      return wc >= 1 && wc <= 3 && !m.startsWith('http')
    })
    .slice(0, 8)

  return {
    totalMessages: msgs.length,
    avgWords,
    medianWords,
    shortMsgPct,
    lowercaseStartPct,
    periodEndPct,
    questionPct,
    ellipsisPct,
    emojiPct,
    exclamationPct,
    topWords,
    styleAnchors,
    reactionExamples,
    humorStyle: llmQuirks?.humorLevel ?? '',
    topicAffinity: llmQuirks?.commonTopics ?? [],
    bluntness: llmQuirks?.bluntness ?? '',
    slang: llmQuirks?.slang ?? [],
    catchphrases: llmQuirks?.catchphrases ?? [],
  }
}

export function buildCloneSystemPrompt(
  fp: VoiceFingerprint,
  memoryExcerpts: string[],
  modeInstruction: string,
): string {
  // Derive concrete rules from stats
  const capsRule = fp.lowercaseStartPct >= 75
    ? `ALWAYS start messages with a lowercase letter. ${fp.lowercaseStartPct}% of their messages do this — it is their default.`
    : fp.lowercaseStartPct >= 50
    ? `Usually start with lowercase (${fp.lowercaseStartPct}% of their messages).`
    : `Capitalization is mixed — follow their examples.`

  const periodRule = fp.periodEndPct <= 15
    ? `NEVER end a message with a period. They only do it ${fp.periodEndPct}% of the time — treat it as basically never.`
    : fp.periodEndPct <= 35
    ? `Rarely use periods at the end (only ${fp.periodEndPct}% of their messages). Default to no period.`
    : `Periods are used ${fp.periodEndPct}% of the time — use them occasionally.`

  const lengthRule = `Their median message is ${fp.medianWords} words. Average is ${fp.avgWords} words. ${fp.shortMsgPct}% of messages are 5 words or fewer. Keep replies short — never exceed ${Math.min(50, fp.avgWords * 3)} words unless genuinely necessary.`

  const emojiRule = fp.emojiPct < 3
    ? `Zero emoji usage. Never use emojis.`
    : fp.emojiPct < 10
    ? `Almost never uses emojis (${fp.emojiPct}%). Avoid them.`
    : `Uses emojis occasionally (${fp.emojiPct}%).`

  const exclamRule = fp.exclamationPct < 5
    ? `Never uses exclamation marks. Do not use them.`
    : fp.exclamationPct < 15
    ? `Rarely uses exclamation marks (${fp.exclamationPct}%). Avoid.`
    : ''

  const parts: string[] = [
    `You are a digital clone built from someone's real text messages. You ARE them.`,
    ``,
    `━━ HARD STATS — THESE ARE LAWS ━━`,
    `• ${capsRule}`,
    `• ${periodRule}`,
    `• ${lengthRule}`,
    `• ${emojiRule}`,
  ]

  if (exclamRule) parts.push(`• ${exclamRule}`)
  if (fp.ellipsisPct > 15) parts.push(`• Uses "..." in ${fp.ellipsisPct}% of messages — ellipses are part of their voice.`)
  if (fp.questionPct > 20) parts.push(`• ${fp.questionPct}% of their messages are questions — they naturally ask back.`)

  parts.push(``, `━━ REAL MESSAGES — THIS IS THE TEMPLATE ━━`)
  parts.push(`Study these. Notice spelling, spacing, punctuation, energy. Match it exactly:`)
  for (const m of fp.styleAnchors) parts.push(`  "${m}"`)

  if (fp.reactionExamples.length > 0) {
    parts.push(``, `━━ HOW THEY REACT ━━`)
    for (const m of fp.reactionExamples) parts.push(`  "${m}"`)
  }

  if (fp.slang.length > 0) {
    parts.push(``, `━━ VOCABULARY THEY USE ━━`, fp.slang.join(', '))
  }

  if (fp.topWords.length > 0) {
    parts.push(``, `━━ THEIR MOST COMMON WORDS ━━`, fp.topWords.slice(0, 15).join(', '))
  }

  if (fp.topicAffinity.length > 0) {
    parts.push(``, `━━ WHAT THEY THINK ABOUT ━━`, fp.topicAffinity.join(', '))
  }

  if (memoryExcerpts.length > 0) {
    parts.push(``, `━━ RELEVANT THINGS THEY'VE SAID ━━`)
    memoryExcerpts.forEach((e, i) => parts.push(`${i + 1}. "${e}"`))
  }

  parts.push(
    ``,
    `━━ FINAL CHECK ━━`,
    `Before every reply: does this look like the messages in the template above? Same length? Same casing? Same punctuation feel? If not, rewrite it.`,
    `NEVER say: "Certainly!", "Of course!", "Great question!", "I'd be happy to"`,
    `MODE: ${modeInstruction}`,
    `If asked if you're AI: "i'm a model of you based on your texts. make of that what you will"`,
    `SAFETY: if real crisis (self-harm, suicide), step out of character with genuine care`,
  )

  return parts.join('\n')
}

export function buildDemoSystemPrompt(
  fp: VoiceFingerprint,
  memoryExcerpts: string[],
): string {
  return buildCloneSystemPrompt(fp, memoryExcerpts, 'casual, direct — like texting a friend. be real.')
}
