/** Typed API client — all calls go through the Fastify server. */

const BASE = '/api'

async function req<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err: ApiError = new Error((data as any).error ?? `HTTP ${res.status}`) as ApiError
    err.status = res.status
    err.data = data
    throw err
  }
  return data as T
}

export interface ApiError extends Error {
  status: number
  data: unknown
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && 'status' in e
}

// ── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  signup: (email: string, password: string) =>
    req<User>('/auth/signup', { method: 'POST', body: JSON.stringify({ email, password }) }),

  login: (email: string, password: string) =>
    req<User>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  logout: () => req('/auth/logout', { method: 'POST' }),

  me: () => req<UserMe>('/auth/me'),
}

// ── Import ──────────────────────────────────────────────────────────────────
export const imports = {
  paste: (raw: string, name?: string) =>
    req<ImportResult>('/import/paste', { method: 'POST', body: JSON.stringify({ raw, name }) }),

  upload: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return fetch(BASE + '/import/upload', {
      method: 'POST',
      credentials: 'include',
      body: form,
    }).then(async res => {
      const data = await res.json()
      if (!res.ok) throw Object.assign(new Error(data.error), { status: res.status, data })
      return data as ImportResult
    })
  },

  datasets: () => req<Dataset[]>('/import/datasets'),

  deleteDataset: (id: string) => req(`/import/datasets/${id}`, { method: 'DELETE' }),

  sampleUrl: () => BASE + '/import/sample',
}

// ── AI ──────────────────────────────────────────────────────────────────────
export const ai = {
  buildProfile: () => req<CloneProfile>('/ai/clone-profile', { method: 'POST' }),

  getProfile: () => req<CloneProfile>('/ai/clone-profile'),

  chat: (sessionId: string, message: string, mode: string = 'raw') =>
    req<ChatReply>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ sessionId, message, mode }),
    }),

  firstMessage: (sessionId: string) =>
    req<{ content: string }>('/ai/first-message', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    }),
}

// ── Chat sessions ────────────────────────────────────────────────────────────
export const chat = {
  sessions: () => req<ChatSession[]>('/chat/sessions'),

  create: (title?: string) =>
    req<ChatSession>('/chat/sessions', { method: 'POST', body: JSON.stringify({ title }) }),

  rename: (id: string, title: string) =>
    req(`/chat/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),

  delete: (id: string) => req(`/chat/sessions/${id}`, { method: 'DELETE' }),

  messages: (sessionId: string) => req<ChatMessage[]>(`/chat/sessions/${sessionId}/messages`),
}

// ── Types ────────────────────────────────────────────────────────────────────
export interface User {
  id: string
  email: string
  plan: 'free' | 'pro'
  cloneReplyCount: number
}
export interface UserMe extends User {
  hasProfile: boolean
  datasetCount: number
}
export interface ImportResult {
  datasetId: string
  count: number
  message: string
}
export interface Dataset {
  id: string
  name: string
  sourceType: 'paste' | 'upload'
  messageCount: number
  createdAt: string
}
export interface CloneProfile {
  id: string
  styleSummary: string
  quirks: Record<string, unknown>
  updatedAt?: string
  messageCount?: number
}
export interface ChatSession {
  id: string
  title: string
  createdAt: string
  messageCount?: number
  lastMessage?: { content: string; role: string } | null
}
export interface ChatMessage {
  id: string
  sessionId: string
  role: 'user' | 'clone' | 'system'
  content: string
  createdAt: string
}
export interface ChatReply {
  content: string
  cloneReplyCount: number
  paywallHit?: boolean
  isCrisisResponse?: boolean
}
