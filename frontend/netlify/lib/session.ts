import { createHmac } from 'node:crypto'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

const COOKIE_NAME = 'sess'
const MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function secret(): string {
  const s = process.env.SESSION_SECRET
  if (!s) throw new Error('SESSION_SECRET not set')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

export function getSession(c: Context): Record<string, string> | null {
  const raw = getCookie(c, COOKIE_NAME)
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot === -1) return null
  const payload = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  if (sign(payload) !== sig) return null
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'))
  } catch { return null }
}

export function setSession(c: Context, data: Record<string, string>): void {
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url')
  setCookie(c, COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: process.env.NETLIFY === 'true',
    sameSite: 'Lax',
    maxAge: MAX_AGE,
    path: '/',
  })
}

export function clearSession(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: '/' })
}
