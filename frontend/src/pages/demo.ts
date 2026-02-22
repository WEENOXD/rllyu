/**
 * Public demo — talk to Joseph's clone, no login required.
 * After the experience, CTA to build your own.
 */

import { navigate } from '../router.js'
import { showToast } from '../main.js'

// Unique session ID per browser tab
const SESSION_ID = crypto.randomUUID()

let messageCount = 0
let isSending = false

type Message = { role: 'clone' | 'user'; content: string }
const history: Message[] = []

export function mountDemo(container: HTMLElement) {
  injectDemoStyles()
  container.innerHTML = renderShell()
  bindEvents(container)
  triggerFirstMessage(container)
}

function renderShell(): string {
  return `
    <div class="demo-shell">
      <!-- Header -->
      <header class="demo-header">
        <div class="demo-header-left">
          <div class="demo-avatar">J</div>
          <div>
            <div class="demo-name">joseph's clone</div>
            <div class="demo-badge">built with rllyU</div>
          </div>
        </div>
        <button class="btn btn-primary btn-sm demo-cta-btn" id="demo-build-btn">
          Build yours →
        </button>
      </header>

      <!-- Messages -->
      <div class="demo-messages" id="demo-messages">
        <div class="demo-intro-hint text-dim text-sm">
          You're talking to an AI clone of a real person — built from their actual texts.<br>
          <span style="color:var(--c-text-3)">This is what rllyU does. Now imagine it was you.</span>
        </div>
      </div>

      <!-- Input -->
      <div class="demo-input-bar">
        <div class="demo-input-wrap glass-card">
          <textarea
            id="demo-input"
            class="chat-textarea"
            placeholder="Say something…"
            rows="1"
          ></textarea>
          <button class="btn btn-primary chat-send-btn" id="demo-send-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M14 2L2 8l4 2 2 6 6-14z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div class="demo-footer-row">
          <span class="text-xs text-dim">free · no signup · <a href="/" style="color:var(--c-text-2);text-decoration:underline">what is rllyU?</a></span>
          <button class="btn btn-ghost btn-sm" id="demo-own-btn">Build your own clone →</button>
        </div>
      </div>

      <!-- Sticky nudge (shown after 4 messages) -->
      <div class="demo-nudge hidden" id="demo-nudge">
        <span>Impressed? This is what YOUR clone could sound like.</span>
        <button class="btn btn-primary btn-sm" id="demo-nudge-btn">Build mine →</button>
      </div>
    </div>
  `
}

function bindEvents(container: HTMLElement) {
  container.querySelector('#demo-build-btn')?.addEventListener('click', () => navigate('/auth?mode=signup'))
  container.querySelector('#demo-own-btn')?.addEventListener('click', () => navigate('/auth?mode=signup'))
  container.querySelector('#demo-nudge-btn')?.addEventListener('click', () => navigate('/auth?mode=signup'))

  const textarea = container.querySelector<HTMLTextAreaElement>('#demo-input')!
  container.querySelector('#demo-send-btn')?.addEventListener('click', () => send(container))

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(container) }
  })
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
  })
}

async function triggerFirstMessage(container: HTMLElement) {
  const messagesEl = container.querySelector<HTMLElement>('#demo-messages')!
  const indicator = typingIndicator()
  messagesEl.appendChild(indicator)
  messagesEl.scrollTop = messagesEl.scrollHeight

  try {
    const res = await fetch('/api/demo/first-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID }),
    })
    const data = await res.json()
    indicator.remove()
    if (data.content) {
      appendBubble(messagesEl, 'clone', data.content)
      history.push({ role: 'clone', content: data.content })
      messageCount++
    }
  } catch {
    indicator.remove()
  }
}

async function send(container: HTMLElement) {
  if (isSending) return
  const textarea = container.querySelector<HTMLTextAreaElement>('#demo-input')!
  const text = textarea.value.trim()
  if (!text) return

  isSending = true
  textarea.value = ''
  textarea.style.height = 'auto'
  const sendBtn = container.querySelector<HTMLButtonElement>('#demo-send-btn')!
  sendBtn.disabled = true

  const messagesEl = container.querySelector<HTMLElement>('#demo-messages')!
  appendBubble(messagesEl, 'user', text)
  history.push({ role: 'user', content: text })

  const indicator = typingIndicator()
  messagesEl.appendChild(indicator)
  messagesEl.scrollTop = messagesEl.scrollHeight

  try {
    const res = await fetch('/api/demo/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: SESSION_ID }),
    })

    if (res.status === 503) {
      indicator.remove()
      showToast('Demo being set up — check back soon!', 'error')
      return
    }

    const data = await res.json()
    indicator.remove()

    if (data.content) {
      appendBubble(messagesEl, 'clone', data.content)
      history.push({ role: 'clone', content: data.content })
      messageCount++

      // Show nudge after 4th clone reply
      if (messageCount >= 4) {
        container.querySelector('#demo-nudge')?.classList.remove('hidden')
      }
    }
  } catch {
    indicator.remove()
    showToast('Connection error — try again', 'error')
  } finally {
    isSending = false
    sendBtn.disabled = false
    textarea.focus()
  }
}

function appendBubble(el: HTMLElement, role: 'clone' | 'user', content: string) {
  const bubble = document.createElement('div')
  bubble.className = `bubble bubble-${role} fade-up`
  bubble.textContent = content
  el.appendChild(bubble)
  el.scrollTop = el.scrollHeight
}

function typingIndicator(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bubble bubble-clone typing-bubble fade-up'
  el.innerHTML = `<div class="dot-pulse"><span></span><span></span><span></span></div>`
  return el
}

function injectDemoStyles() {
  if (document.getElementById('demo-styles')) return
  const style = document.createElement('style')
  style.id = 'demo-styles'
  style.textContent = `
    .demo-shell {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--c-bg);
      position: relative;
    }

    .demo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-4) var(--sp-5);
      border-bottom: var(--glass-border);
      background: rgba(8,8,8,.85);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
      flex-shrink: 0;
    }
    .demo-header-left { display: flex; align-items: center; gap: var(--sp-3); }

    .demo-avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--c-glass-strong);
      border: var(--glass-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: var(--t-md);
    }

    .demo-name {
      font-size: var(--t-base);
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .demo-badge {
      font-size: var(--t-xs);
      color: var(--c-text-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .demo-messages {
      flex: 1;
      overflow-y: auto;
      padding: var(--sp-5);
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }

    .demo-intro-hint {
      text-align: center;
      padding: var(--sp-4) var(--sp-6);
      line-height: 1.7;
      max-width: 440px;
      margin: 0 auto var(--sp-2);
    }

    .demo-input-bar {
      padding: var(--sp-4) var(--sp-5) var(--sp-5);
      flex-shrink: 0;
      background: rgba(8,8,8,.7);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
    }
    .demo-input-wrap {
      display: flex;
      align-items: flex-end;
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4);
      border-radius: var(--r-xl);
      margin-bottom: var(--sp-2);
    }

    .demo-footer-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--sp-2);
    }

    /* Sticky nudge */
    .demo-nudge {
      position: fixed;
      bottom: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--c-glass-strong);
      backdrop-filter: var(--blur-md);
      -webkit-backdrop-filter: var(--blur-md);
      border: var(--glass-border);
      border-radius: var(--r-pill);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: var(--sp-4);
      box-shadow: var(--shadow-lg);
      font-size: var(--t-sm);
      color: var(--c-text-2);
      white-space: nowrap;
      z-index: 100;
      animation: fade-up var(--dur-slow) var(--ease) both;
    }
    .demo-nudge.hidden { display: none; }

    @media (max-width: 600px) {
      .demo-nudge { white-space: normal; text-align: center; flex-direction: column; bottom: 120px; width: calc(100% - 40px); }
      .demo-footer-row .btn { display: none; }
    }
  `
  document.head.appendChild(style)
}
