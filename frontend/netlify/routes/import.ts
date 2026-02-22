import { Hono } from 'hono'
import { getPrisma } from '../lib/db.js'
import { getSession } from '../lib/session.js'
import { parseRawInput, filterUserMessages, hashMessage } from '../lib/ingestion.js'

const importRouter = new Hono()

importRouter.post('/paste', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => null)
  if (!body?.raw || String(body.raw).trim().length < 10) {
    return c.json({ error: 'raw text required (min 10 chars)' }, 400)
  }

  const raw = String(body.raw).slice(0, 2_000_000)
  const name = String(body.name ?? 'Pasted texts').slice(0, 100)

  const { count, datasetId } = await ingestText(raw, sess.userId, name, 'paste')
  return c.json({ datasetId, count, message: `Imported ${count} messages` }, 201)
})

importRouter.get('/datasets', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const datasets = await prisma.dataset.findMany({
    where: { userId: sess.userId },
    include: { _count: { select: { messages: true } } },
    orderBy: { createdAt: 'desc' },
  })

  return c.json(datasets.map(d => ({
    id: d.id,
    name: d.name,
    sourceType: d.sourceType,
    messageCount: d._count.messages,
    createdAt: d.createdAt,
  })))
})

importRouter.delete('/datasets/:id', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const prisma = getPrisma()
  const dataset = await prisma.dataset.findFirst({ where: { id, userId: sess.userId } })
  if (!dataset) return c.json({ error: 'Dataset not found' }, 404)

  await prisma.dataset.delete({ where: { id } })
  return c.json({ ok: true })
})

async function ingestText(
  raw: string,
  userId: string,
  name: string,
  sourceType: 'paste' | 'upload',
): Promise<{ count: number; datasetId: string }> {
  const parsed = parseRawInput(raw)
  const userMessages = filterUserMessages(parsed)
  if (userMessages.length === 0) return { count: 0, datasetId: '' }

  const prisma = getPrisma()
  const dataset = await prisma.dataset.create({ data: { userId, name, sourceType } })

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
    } catch { /* duplicate hash — skip */ }
  }

  return { count, datasetId: dataset.id }
}

export default importRouter
