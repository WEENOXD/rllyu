/** Animated typing indicator — works with the messages-inner wrapper */

export function createTypingIndicator(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bubble bubble-clone typing-bubble'
  el.innerHTML = `
    <span class="tdot"></span>
    <span class="tdot"></span>
    <span class="tdot"></span>
  `
  return el
}

export async function simulateTyping(
  messagesEl: HTMLElement,
  onReveal: (text: string) => void,
  text: string,
): Promise<void> {
  const inner = messagesEl.querySelector<HTMLElement>('.messages-inner') ?? messagesEl
  const indicator = createTypingIndicator()
  inner.appendChild(indicator)
  autoScroll(messagesEl)

  const wpm = 60 + Math.random() * 40
  const msPerWord = 60000 / wpm
  const wordCount = text.split(' ').length
  const duration = Math.min(Math.max(wordCount * msPerWord, 800), 3000)

  await new Promise(r => setTimeout(r, duration))
  indicator.remove()
  onReveal(text)
}

export function autoScroll(el: HTMLElement) {
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
}
