const CRISIS_PATTERNS = [
  /\bkill\s+(my)?self\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bend\s+(it|my life)\b/i,
  /\bself[\s-]?harm\b/i,
  /\bcut\s+(my)?self\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+)?alive\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
]

export function detectCrisis(text: string): boolean {
  return CRISIS_PATTERNS.some(p => p.test(text))
}

export const CRISIS_RESPONSE = `hey — stepping outside the bit for a sec.

are you actually okay?

if you're going through something real, please reach out:
• crisis text line: text HOME to 741741
• 988 suicide & crisis lifeline: call or text 988
• international: findahelpline.com

i'm a model of you, not the real you — but the real you matters. 💙`
