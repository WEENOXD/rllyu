import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import secureSession from '@fastify/secure-session'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'

import { authRoutes } from './routes/auth.js'
import { importRoutes } from './routes/import.js'
import { aiRoutes } from './routes/ai.js'
import { chatRoutes } from './routes/chat.js'

// ── Env validation ──────────────────────────────────────────────────────────
const required = ['OPENAI_API_KEY', 'SESSION_SECRET', 'DATABASE_URL']
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required env var: ${key}`)
    process.exit(1)
  }
}

const SESSION_SECRET = process.env.SESSION_SECRET!
if (SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be at least 32 characters')
  process.exit(1)
}

// ── Server ──────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
  },
})

// CORS — allow frontend origin
await app.register(cors, {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
})

// Secure session (encrypted, stored in a HttpOnly cookie)
// SESSION_SECRET must be exactly 32 bytes for libsodium — pad/trim as needed
const keyBuf = Buffer.from(SESSION_SECRET.padEnd(32, '0').slice(0, 32))
await app.register(secureSession, {
  key: keyBuf,
  cookieName: 'rllyu-sess',
  cookie: {
    path: '/',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },
})

// Multipart (file uploads)
await app.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
})

// Rate limiting (global fallback)
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
  keyGenerator: (req) => req.session.get('userId') || req.ip,
})

// ── Routes ───────────────────────────────────────────────────────────────────
await app.register(authRoutes, { prefix: '/api/auth' })
await app.register(importRoutes, { prefix: '/api/import' })
await app.register(aiRoutes, { prefix: '/api/ai' })
await app.register(chatRoutes, { prefix: '/api/chat' })

// Health check
app.get('/health', () => ({ ok: true, ts: Date.now() }))

// ── Start ─────────────────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT || '3001', 10)
try {
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`\n🖤 rllyU backend running → http://localhost:${port}\n`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
