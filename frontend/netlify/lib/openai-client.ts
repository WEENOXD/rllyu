import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

export default openai
export const MAX_OUTPUT_TOKENS = 400
