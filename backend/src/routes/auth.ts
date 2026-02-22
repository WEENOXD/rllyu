import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import { z } from 'zod'
import prisma from '../lib/prisma.js'

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(128),
})

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string(),
})

export const authRoutes: FastifyPluginAsync = async (app) => {
  // Sign up
  app.post('/signup', {
    config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const parse = SignupBody.safeParse(req.body)
    if (!parse.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parse.error.flatten() })
    }
    const { email, password } = parse.data

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) return reply.status(409).send({ error: 'Email already registered' })

    const passwordHash = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), passwordHash },
    })

    req.session.set('userId', user.id)
    return reply.status(201).send({ id: user.id, email: user.email, plan: user.plan })
  })

  // Login
  app.post('/login', {
    config: { rateLimit: { max: 20, timeWindow: '5 minutes' } },
  }, async (req, reply) => {
    const parse = LoginBody.safeParse(req.body)
    if (!parse.success) return reply.status(400).send({ error: 'Invalid input' })
    const { email, password } = parse.data

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' })

    req.session.set('userId', user.id)
    return reply.send({ id: user.id, email: user.email, plan: user.plan, cloneReplyCount: user.cloneReplyCount })
  })

  // Logout
  app.post('/logout', async (req, reply) => {
    req.session.delete()
    return reply.send({ ok: true })
  })

  // Me
  app.get('/me', async (req, reply) => {
    const userId = req.session.get('userId')
    if (!userId) return reply.status(401).send({ error: 'Not authenticated' })

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      req.session.delete()
      return reply.status(401).send({ error: 'User not found' })
    }

    const hasProfile = !!(await prisma.cloneProfile.findUnique({ where: { userId } }))
    const datasetCount = await prisma.dataset.count({ where: { userId } })

    return reply.send({
      id: user.id,
      email: user.email,
      plan: user.plan,
      cloneReplyCount: user.cloneReplyCount,
      hasProfile,
      datasetCount,
    })
  })
}
