import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
})

export default openai

export const MAX_OUTPUT_TOKENS = 400
export const MAX_CONTEXT_MESSAGES = 20 // last N chat messages for context

/** Trim a string to a max token approximation (1 token ≈ 4 chars) */
export function trimToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + '…'
}
