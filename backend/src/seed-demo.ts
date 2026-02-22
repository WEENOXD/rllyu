/**
 * One-time seed script — creates the demo user (you) and builds their clone profile.
 * Run:  npx tsx src/seed-demo.ts
 * Then: add DEMO_USER_ID=<output> to .env and fly secrets
 */

import 'dotenv/config'
import bcrypt from 'bcrypt'
import prisma from './lib/prisma.js'
import openai from './lib/openai.js'
import { parseRawInput, hashMessage } from './lib/ingestion.js'
import type { CloneQuirks } from './types.js'

const DEMO_DUMP = `
Let's build an AI SaaS that actually scales.
I want Paradime to feel like pastel blue, frosted glass, Tony Stark energy.
Make it minimal, liquid glass white, Yeezy black.
How do I get to 10k MRR?
Should I use OpenAI or Claude API for this?
I want to sync the ad perfectly to the beat.
Ask me broad questions and wait.
Can we structure it so it upgrades to Postgres later?
How do I market this with only a couple hundred followers?
I don't want to post on my personal, that's embarrassing.
Is this saturated or is there still opportunity?
Make it addictive.
How do I set up Stripe at 15?
What can I do under 18 without a guardian?
I want it to feel like Apple-level UI.
Let's create a master prompt.
Can Claude Code do all the heavy lifting?
I want something people didn't see coming.
Should I brand under Paradime or just the product?
I need something real, think different.
Is this good enough to get into MIT?
Can I run AI locally on an iPhone?
How much does it cost to run locally?
Is this name short and snappy enough?
Give me 20 bold, revolutionary bios.
Can we make unlimited messages free but lock edits behind paywall?
What grades do I need for University of Hawaii?
Roast me in one sentence.
Isn't she beautiful?
How long have we been dating?
Once upon a time, there was a small frog named Toad. This frog lived underground, specifically, in the sewers.
He was a happy frog, but eventually he grew bored from doing the same things everyday.
One day he was just swimming around, and suddenly there was a large explosion underground.
Toad woke up in Las Vegas. Toad had never been to Las Vegas before.
He found the slot machines first, and quickly realised he had incredible luck.
Three spins in a row, he got the jackpot.
After around four hours of winning more and more money, he had won a sum of around eight million dollars!
He was kicked out of the casino by a very angry man.
Eventually, he had hit all the casinos in Vegas, and was outlawed from every single one.
He was worth hundreds of millions, and had gone out to buy multiple houses, all with multiple cars.
He even had contacts with all the top dealerships, realtors, and watch dealers in the country.
He had a private jet just to fly him to the casino every morning.
The Gambling God warned him of greed, and suggested he retired and invested his money.
Thanks man, but I got it from here. My gambling is not an addiction, I'm just very dedicated.
Wow what's this website? Rainbet? Sounds like a good way to make some MONEY!!!
He bet all of his free cash, all on black.
The ball, as the god knew it would, landed on red. Toad was devastated.
He drove back to his most valuable estate, and fell asleep after drinking eight cases of soda.
He couldn't pay taxes after his major loss, so eventually the IRS had no choice but to come and get him.
There was Joey, a man who was arrested for piracy of Disney movies.
He claims he never made a penny and uploaded them online for free.
Then there was Jeremy, who told everybody he was babysitting without a license.
The frog slipped through the cell bars, and the guard, being a man of his word, let the frog leave.
He sold it and put the funds in an IRA and got a job at the pet store.
There he met another frog, and started a family with her.
He built good credit, was financially responsible and lived happily ever after. The End.
I want something people didn't see coming.
Make it addicting.
I need something real.
Think different.
`

async function main() {
  console.log('🌱 Seeding demo user…')

  // Upsert demo user
  const email = 'demo-joseph@rllyu.internal'
  const existing = await prisma.user.findUnique({ where: { email } })
  const user = existing ?? await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(Math.random().toString(36), 10),
      plan: 'pro',
    },
  })
  console.log(`User: ${user.id}`)

  // Delete old datasets for a clean re-seed
  await prisma.dataset.deleteMany({ where: { userId: user.id } })

  // Import the dump
  const parsed = parseRawInput(DEMO_DUMP)
  const dataset = await prisma.dataset.create({
    data: { userId: user.id, name: 'demo-seed', sourceType: 'paste' },
  })

  let count = 0
  for (const msg of parsed) {
    const hash = hashMessage(msg.text, msg.author, msg.timestamp)
    try {
      await prisma.messageRow.create({
        data: { datasetId: dataset.id, text: msg.text.trim(), hash },
      })
      count++
    } catch { /* dupe */ }
  }
  console.log(`Imported ${count} messages`)

  // Build clone profile via OpenAI
  console.log('Building clone profile…')
  const sample = parsed.map(m => m.text).join('\n')

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You are a linguistic analyst. Return ONLY valid JSON, no markdown.' },
      { role: 'user', content: `Analyze these messages and return a JSON voice profile:\n\n${sample}\n\nReturn:\n{\n  "styleSummary": "2-3 sentences",\n  "quirks": {\n    "catchphrases": [],\n    "slang": [],\n    "pacing": "",\n    "humorLevel": "",\n    "bluntness": "",\n    "empathy": "",\n    "commonTopics": [],\n    "punctuationStyle": "",\n    "emojiUsage": ""\n  }\n}` },
    ],
    max_tokens: 600,
    temperature: 0.3,
    response_format: { type: 'json_object' },
  })

  const raw = JSON.parse(completion.choices[0]?.message?.content ?? '{}')
  const styleSummary: string = raw.styleSummary ?? 'A young entrepreneur with big energy.'
  const quirks: CloneQuirks = raw.quirks ?? {}

  await prisma.cloneProfile.upsert({
    where: { userId: user.id },
    create: { userId: user.id, styleSummary, quirksJson: JSON.stringify(quirks) },
    update: { styleSummary, quirksJson: JSON.stringify(quirks) },
  })

  console.log('\n✅ Done. Add this to your .env and fly secrets:\n')
  console.log(`DEMO_USER_ID=${user.id}\n`)
  console.log('Style summary preview:')
  console.log(styleSummary)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
