import type { FastifyPluginAsync } from 'fastify'
import prisma from '../lib/prisma.js'

export const chatRoutes: FastifyPluginAsync = async (app) => {
  // List sessions
  app.get('/sessions', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const sessions = await prisma.chatSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { messages: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' }, select: { content: true, role: true } },
      },
    })

    return reply.send(sessions.map(s => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      messageCount: s._count.messages,
      lastMessage: s.messages[0] ?? null,
    })))
  })

  // Create session
  app.post('/sessions', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const { title = 'New Chat' } = (req.body as { title?: string }) ?? {}

    const session = await prisma.chatSession.create({
      data: { userId, title: title.slice(0, 80) },
    })

    return reply.status(201).send({ id: session.id, title: session.title, createdAt: session.createdAt })
  })

  // Rename session
  app.patch('/sessions/:id', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { id } = req.params as { id: string }
    const { title } = req.body as { title: string }

    const session = await prisma.chatSession.findFirst({ where: { id, userId } })
    if (!session) return reply.status(404).send({ error: 'Not found' })

    await prisma.chatSession.update({ where: { id }, data: { title: title.slice(0, 80) } })
    return reply.send({ ok: true })
  })

  // Delete session
  app.delete('/sessions/:id', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findFirst({ where: { id, userId } })
    if (!session) return reply.status(404).send({ error: 'Not found' })

    await prisma.chatSession.delete({ where: { id } })
    return reply.send({ ok: true })
  })

  // Get messages for a session
  app.get('/sessions/:id/messages', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })
    const { id } = req.params as { id: string }

    const session = await prisma.chatSession.findFirst({ where: { id, userId } })
    if (!session) return reply.status(404).send({ error: 'Not found' })

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'asc' },
    })

    return reply.send(messages)
  })
}
