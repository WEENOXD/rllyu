import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import { getPrisma } from '../lib/db.js'
import { getSession, setSession, clearSession } from '../lib/session.js'

const auth = new Hono()

auth.post('/signup', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.email || !body?.password) return c.json({ error: 'email and password required' }, 400)

  const email = String(body.email).toLowerCase().trim()
  const password = String(body.password)
  if (!email.includes('@') || password.length < 6) {
    return c.json({ error: 'Invalid email or password too short (min 6 chars)' }, 400)
  }

  const prisma = getPrisma()
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const passwordHash = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({ data: { email, passwordHash } })

  setSession(c, { userId: user.id })
  return c.json({ id: user.id, email: user.email, plan: user.plan }, 201)
})

auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body?.email || !body?.password) return c.json({ error: 'email and password required' }, 400)

  const email = String(body.email).toLowerCase().trim()
  const password = String(body.password)

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) return c.json({ error: 'Invalid credentials' }, 401)

  setSession(c, { userId: user.id })
  return c.json({ id: user.id, email: user.email, plan: user.plan, cloneReplyCount: user.cloneReplyCount })
})

auth.post('/logout', async (c) => {
  clearSession(c)
  return c.json({ ok: true })
})

auth.get('/me', async (c) => {
  const sess = getSession(c)
  if (!sess?.userId) return c.json({ error: 'Not authenticated' }, 401)

  const prisma = getPrisma()
  const user = await prisma.user.findUnique({ where: { id: sess.userId } })
  if (!user) { clearSession(c); return c.json({ error: 'User not found' }, 401) }

  const hasProfile = !!(await prisma.cloneProfile.findUnique({ where: { userId: user.id } }))
  const datasetCount = await prisma.dataset.count({ where: { userId: user.id } })

  return c.json({
    id: user.id,
    email: user.email,
    plan: user.plan,
    cloneReplyCount: user.cloneReplyCount,
    hasProfile,
    datasetCount,
  })
})

export default auth
