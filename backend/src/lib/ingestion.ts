import crypto from 'crypto'
import type { ParsedMessage } from '../types.js'

/** Hash a message for deduplication */
export function hashMessage(text: string, author?: string, ts?: Date): string {
  const rounded = ts ? Math.floor(ts.getTime() / 60000) * 60000 : 0
  const raw = `${text.trim()}::${author ?? ''}::${rounded}`
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

// ── Format detectors ──────────────────────────────────────────────────────────

const JSONL_FIELDS_TEXT = ['text', 'message', 'content', 'body', 'msg']
const JSONL_FIELDS_AUTHOR = ['author', 'sender', 'from', 'name', 'who']
const JSONL_FIELDS_TS = ['timestamp', 'ts', 'time', 'date', 'created_at', 'createdAt']

function parseJsonl(raw: string): ParsedMessage[] {
  const msgs: ParsedMessage[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      const textKey = JSONL_FIELDS_TEXT.find(k => obj[k] !== undefined)
      if (!textKey) continue
      const text = String(obj[textKey]).trim()
      if (!text) continue
      const authorKey = JSONL_FIELDS_AUTHOR.find(k => obj[k] !== undefined)
      const tsKey = JSONL_FIELDS_TS.find(k => obj[k] !== undefined)
      msgs.push({
        text,
        author: authorKey ? String(obj[authorKey]) : undefined,
        timestamp: tsKey ? new Date(obj[tsKey]) : undefined,
      })
    } catch {
      // skip bad lines
    }
  }
  return msgs
}

function parseCsv(raw: string): ParsedMessage[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length < 2) return []

  // Parse header
  const headerLine = lines[0]
  const headers = headerLine.split(',').map(h => h.replace(/['"]/g, '').trim().toLowerCase())

  const textIdx = headers.findIndex(h => JSONL_FIELDS_TEXT.includes(h))
  if (textIdx === -1) return []
  const authorIdx = headers.findIndex(h => JSONL_FIELDS_AUTHOR.includes(h))
  const tsIdx = headers.findIndex(h => JSONL_FIELDS_TS.includes(h))

  const msgs: ParsedMessage[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line)
    const text = (cols[textIdx] ?? '').replace(/^["']|["']$/g, '').trim()
    if (!text) continue
    msgs.push({
      text,
      author: authorIdx >= 0 ? (cols[authorIdx] ?? '').replace(/^["']|["']$/g, '').trim() || undefined : undefined,
      timestamp: tsIdx >= 0 ? new Date(cols[tsIdx] ?? '') : undefined,
    })
  }
  return msgs
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  result.push(cur)
  return result
}

// Patterns for structured chat logs
const PATTERNS = [
  // [MM/DD/YY, HH:MM:SS AM] Name: message  (iMessage export)
  /^\[(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)\]\s+([^:]+):\s+(.+)$/i,
  // YYYY-MM-DD HH:MM:SS Name: message
  /^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s+([^:]+):\s+(.+)$/,
  // Name [timestamp]: message
  /^([^[]+)\s+\[([^\]]+)\]:\s+(.+)$/,
  // Name: message (no timestamp)
  /^([A-Za-z][A-Za-z\s]{0,25}):\s+(.+)$/,
]

function parsePlainText(raw: string): ParsedMessage[] {
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const msgs: ParsedMessage[] = []

  for (const line of lines) {
    let matched = false

    // Try timestamp + author patterns
    for (const pattern of PATTERNS.slice(0, 3)) {
      const m = line.match(pattern)
      if (m) {
        const [, tsOrName, nameOrTs, text] = m
        const ts = new Date(tsOrName)
        if (!isNaN(ts.getTime())) {
          msgs.push({ text: text.trim(), author: nameOrTs.trim(), timestamp: ts })
        } else {
          // Maybe order is name, ts, text
          const ts2 = new Date(nameOrTs)
          msgs.push({ text: text.trim(), author: tsOrName.trim(), timestamp: !isNaN(ts2.getTime()) ? ts2 : undefined })
        }
        matched = true
        break
      }
    }

    if (!matched) {
      // Name: message
      const nameMsg = line.match(PATTERNS[3])
      if (nameMsg) {
        msgs.push({ text: nameMsg[2].trim(), author: nameMsg[1].trim() })
        matched = true
      }
    }

    if (!matched && line.length > 2) {
      // Plain message, no author
      msgs.push({ text: line })
    }
  }

  return msgs
}

export type SourceType = 'paste' | 'upload'

/**
 * Detect format and parse raw input into normalized messages.
 * Returns array of ParsedMessage.
 */
export function parseRawInput(raw: string): ParsedMessage[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  // Try JSONL
  if (trimmed.startsWith('{') && trimmed.includes('\n')) {
    const result = parseJsonl(trimmed)
    if (result.length > 0) return result
  }

  // Try JSON array
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr)) {
        const asJsonl = arr.map((o: unknown) => JSON.stringify(o)).join('\n')
        const result = parseJsonl(asJsonl)
        if (result.length > 0) return result
      }
    } catch {}
  }

  // Try CSV (has a comma-separated header line)
  const firstLine = trimmed.split('\n')[0]
  if (firstLine.includes(',')) {
    const result = parseCsv(trimmed)
    if (result.length > 0) return result
  }

  // Fallback: plain text
  return parsePlainText(trimmed)
}

/**
 * Filter to messages likely sent by the primary user.
 * If we can detect a dominant author, return only their messages.
 * Otherwise return all messages (can't determine who is "you").
 */
export function filterUserMessages(messages: ParsedMessage[]): ParsedMessage[] {
  const withAuthor = messages.filter(m => m.author)
  if (withAuthor.length === 0) return messages

  // Count by author
  const counts = new Map<string, number>()
  for (const m of withAuthor) {
    const key = m.author!.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  // The most common author is assumed to be "you" if they're >40% of messages
  let maxAuthor = ''
  let maxCount = 0
  for (const [author, count] of counts) {
    if (count > maxCount) { maxCount = count; maxAuthor = author }
  }

  const ratio = maxCount / withAuthor.length
  if (ratio < 0.3) {
    // Can't identify a clear "you", return all
    return messages
  }

  return messages.filter(m => !m.author || m.author.toLowerCase() === maxAuthor)
}
