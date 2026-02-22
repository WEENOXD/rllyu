import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { parseRawInput, filterUserMessages, hashMessage } from '../lib/ingestion.js'

const PasteBody = z.object({
  raw: z.string().min(10).max(2_000_000),
  name: z.string().max(100).default('Pasted texts'),
})

export const importRoutes: FastifyPluginAsync = async (app) => {
  // Import pasted text
  app.post('/paste', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const parse = PasteBody.safeParse(req.body)
    if (!parse.success) return reply.status(400).send({ error: 'Invalid input' })
    const { raw, name } = parse.data

    const { count, datasetId } = await ingestText(raw, userId, name, 'paste')
    return reply.status(201).send({ datasetId, count, message: `Imported ${count} messages` })
  })

  // Upload file
  app.post('/upload', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    let raw = ''
    let fileName = 'Uploaded file'

    try {
      const data = await req.file()
      if (!data) return reply.status(400).send({ error: 'No file provided' })
      fileName = data.filename || fileName
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (!['txt', 'csv', 'jsonl', 'json'].includes(ext ?? '')) {
        return reply.status(400).send({ error: 'Unsupported file type. Use .txt, .csv, or .jsonl' })
      }
      const bufs: Buffer[] = []
      for await (const chunk of data.file) bufs.push(chunk)
      raw = Buffer.concat(bufs).toString('utf-8')
    } catch {
      return reply.status(400).send({ error: 'Failed to read file' })
    }

    if (!raw.trim()) return reply.status(400).send({ error: 'File is empty' })

    const { count, datasetId } = await ingestText(raw, userId, fileName, 'upload')
    return reply.status(201).send({ datasetId, count, message: `Imported ${count} messages from ${fileName}` })
  })

  // List datasets
  app.get('/datasets', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const datasets = await prisma.dataset.findMany({
      where: { userId },
      include: { _count: { select: { messages: true } } },
      orderBy: { createdAt: 'desc' },
    })

    return reply.send(datasets.map(d => ({
      id: d.id,
      name: d.name,
      sourceType: d.sourceType,
      messageCount: d._count.messages,
      createdAt: d.createdAt,
    })))
  })

  // Delete dataset
  app.delete('/datasets/:id', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { id } = req.params as { id: string }

    const dataset = await prisma.dataset.findFirst({ where: { id, userId } })
    if (!dataset) return reply.status(404).send({ error: 'Dataset not found' })

    await prisma.dataset.delete({ where: { id } })
    return reply.send({ ok: true })
  })

  // Sample file download
  app.get('/sample', async (_, reply) => {
    const sample = `[12/15/23, 2:34 PM] You: yo did you see that movie last night
[12/15/23, 2:35 PM] Friend: which one lol
[12/15/23, 2:35 PM] You: the one i mentioned like 3 times
[12/15/23, 2:36 PM] Friend: dude i have no idea what you're talking about
[12/15/23, 2:36 PM] You: ok whatever i'll send you the trailer
[12/15/23, 2:45 PM] You: actually nvm it's better if you don't know anything going in
[12/15/23, 3:01 PM] You: trust me on this one
[12/15/23, 8:23 PM] You: so did you watch it
[12/15/23, 8:24 PM] Friend: i forgot
[12/15/23, 8:24 PM] You: bro.`
    reply.header('Content-Type', 'text/plain')
    reply.header('Content-Disposition', 'attachment; filename="sample-chat.txt"')
    return reply.send(sample)
  })
}

async function ingestText(
  raw: string,
  userId: string,
  name: string,
  sourceType: 'paste' | 'upload',
): Promise<{ count: number; datasetId: string }> {
  const parsed = parseRawInput(raw)
  const userMessages = filterUserMessages(parsed)

  if (userMessages.length === 0) {
    return { count: 0, datasetId: '' }
  }

  // Create dataset
  const dataset = await prisma.dataset.create({
    data: { userId, name, sourceType },
  })

  // Deduplicate and insert
  let count = 0
  for (const msg of userMessages) {
    const hash = hashMessage(msg.text, msg.author, msg.timestamp)
    try {
      await prisma.messageRow.create({
        data: {
          datasetId: dataset.id,
          text: msg.text.trim(),
          author: msg.author ?? null,
          timestamp: msg.timestamp ?? null,
          hash,
        },
      })
      count++
    } catch {
      // duplicate hash — skip
    }
  }

  return { count, datasetId: dataset.id }
}
