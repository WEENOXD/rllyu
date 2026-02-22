/**
 * Lightweight TF-IDF similarity search — no embeddings.
 * Used to pull relevant "memory excerpts" from imported messages.
 */

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','shall','can','not',
  'no','nor','so','yet','both','either','neither','just','i','me','my','we',
  'our','you','your','he','she','it','they','them','their','this','that',
  'these','those','what','which','who','how','when','where','why','if',
])

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t))
}

interface Doc {
  id: string
  text: string
  tokens: string[]
  tf: Map<string, number>
}

export class TfIdfIndex {
  private docs: Doc[] = []
  private idf: Map<string, number> = new Map()
  private built = false

  add(id: string, text: string) {
    const tokens = tokenize(text)
    const tf = new Map<string, number>()
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1 / tokens.length)
    this.docs.push({ id, text, tokens, tf })
    this.built = false
  }

  build() {
    const N = this.docs.length
    if (N === 0) return
    const df = new Map<string, number>()
    for (const doc of this.docs) {
      for (const term of new Set(doc.tokens)) {
        df.set(term, (df.get(term) ?? 0) + 1)
      }
    }
    for (const [term, count] of df) {
      this.idf.set(term, Math.log(N / count) + 1)
    }
    this.built = true
  }

  search(query: string, topK = 5): string[] {
    if (!this.built) this.build()
    if (this.docs.length === 0) return []

    const qTokens = tokenize(query)
    const scores: [number, Doc][] = []

    for (const doc of this.docs) {
      let score = 0
      for (const term of qTokens) {
        const tf = doc.tf.get(term) ?? 0
        const idf = this.idf.get(term) ?? 0
        score += tf * idf
      }
      if (score > 0) scores.push([score, doc])
    }

    scores.sort((a, b) => b[0] - a[0])
    return scores.slice(0, topK).map(([, doc]) => doc.text)
  }
}

/**
 * Build a TF-IDF index from message rows and search it.
 * Returns up to maxK short snippets relevant to the query.
 */
export function searchMemory(
  messages: Array<{ id: string; text: string }>,
  query: string,
  maxK = 5,
): string[] {
  const idx = new TfIdfIndex()
  for (const m of messages) idx.add(m.id, m.text)
  idx.build()
  const results = idx.search(query, maxK)
  // Trim each result to a reasonable length
  return results.map(r => (r.length > 200 ? r.slice(0, 200) + '…' : r))
}
