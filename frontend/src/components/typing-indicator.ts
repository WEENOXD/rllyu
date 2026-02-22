/** Animated typing indicator bubble — renders into a container */

export function createTypingIndicator(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bubble bubble-clone typing-bubble fade-up'
  el.innerHTML = `<div class="dot-pulse"><span></span><span></span><span></span></div>`
  return el
}

/**
 * Show a typing indicator, then reveal the message after a human-ish delay.
 * Returns a cleanup function.
 */
export async function simulateTyping(
  container: HTMLElement,
  onReveal: (text: string) => void,
  text: string,
): Promise<void> {
  const indicator = createTypingIndicator()
  container.appendChild(indicator)
  container.scrollTop = container.scrollHeight

  // Typing duration: base + per-char, clamped to feel natural
  const wpm = 60 + Math.random() * 40 // 60–100 WPM
  const msPerWord = 60000 / wpm
  const wordCount = text.split(' ').length
  const duration = Math.min(Math.max(wordCount * msPerWord, 800), 3200)

  await sleep(duration)
  indicator.remove()
  onReveal(text)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
