import { Hono } from 'hono'
import { getPrisma } from '../lib/db.js'
import { getSession } from '../lib/session.js'

const chatRouter = new Hono()

chatRouter.get('/sessions', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const sessions = await prisma.chatSession.findMany({
    where: { userId: sess.userId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { messages: true } },
      messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { content: true, role: true } },
    },
  })

  return c.json(sessions.map(s => ({
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    messageCount: s._count.messages,
    lastMessage: s.messages[0] ?? null,
  })))
})

chatRouter.post('/sessions', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const body = await c.req.json().catch(() => ({}))
  const title = String(body?.title ?? 'New Chat').slice(0, 80)

  const prisma = getPrisma()
  const session = await prisma.chatSession.create({ data: { userId: sess.userId, title } })
  return c.json({ id: session.id, title: session.title, createdAt: session.createdAt }, 201)
})

chatRouter.patch('/sessions/:id', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (!body?.title) return c.json({ error: 'title required' }, 400)

  const prisma = getPrisma()
  const session = await prisma.chatSession.findFirst({ where: { id, userId: sess.userId } })
  if (!session) return c.json({ error: 'Not found' }, 404)

  await prisma.chatSession.update({ where: { id }, data: { title: String(body.title).slice(0, 80) } })
  return c.json({ ok: true })
})

chatRouter.delete('/sessions/:id', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const prisma = getPrisma()
  const session = await prisma.chatSession.findFirst({ where: { id, userId: sess.userId } })
  if (!session) return c.json({ error: 'Not found' }, 404)

  await prisma.chatSession.delete({ where: { id } })
  return c.json({ ok: true })
})

chatRouter.get('/sessions/:id/messages', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')

  const prisma = getPrisma()
  const session = await prisma.chatSession.findFirst({ where: { id, userId: sess.userId } })
  if (!session) return c.json({ error: 'Not found' }, 404)

  const messages = await prisma.chatMessage.findMany({
    where: { sessionId: id },
    orderBy: { createdAt: 'asc' },
  })
  return c.json(messages)
})

export default chatRouter
