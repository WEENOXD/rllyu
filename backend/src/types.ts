import type { FastifyRequest } from 'fastify'

// Augment fastify session
declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string
  }
}

export interface AuthedRequest extends FastifyRequest {
  userId: string
}

export interface CloneQuirks {
  catchphrases: string[]
  slang: string[]
  pacing: string           // e.g. "rapid-fire short bursts"
  humorLevel: string       // e.g. "dry sarcasm"
  bluntness: string        // e.g. "very direct"
  empathy: string          // e.g. "low surface-level, high depth"
  commonTopics: string[]
  punctuationStyle: string // e.g. "minimal caps, no periods"
  emojiUsage: string       // e.g. "rare, only 💀 and lmao"
}

export interface ParsedMessage {
  timestamp?: Date
  author?: string
  text: string
}
