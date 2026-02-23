/**
 * Public demo — talk to Joseph's clone, no login required.
 */
import { navigate } from '../router.js'
import { showToast } from '../main.js'

const SESSION_ID = crypto.randomUUID()
let messageCount = 0
let isSending = false

export function mountDemo(container: HTMLElement) {
  injectDemoStyles()
  container.innerHTML = renderShell()
  bindEvents(container)
  triggerFirstMessage(container)
}

function renderShell(): string {
  return `
    <div class="demo-shell">
      <header class="demo-header">
        <div class="demo-header-left">
          <div class="demo-avatar">J</div>
          <div>
            <div class="demo-name">joseph's clone</div>
            <div class="demo-badge">built with rllyU</div>
          </div>
        </div>
        <button class="demo-cta-pill" id="demo-build-btn">Build yours →</button>
      </header>

      <div class="demo-msgs-outer">
        <div class="demo-messages" id="demo-messages">
          <div class="messages-inner">
            <div class="demo-intro-card">
              You're talking to an AI clone of a real person — built from their actual texts.
              <span class="demo-intro-sub">This is what rllyU does. Imagine it was you.</span>
            </div>
          </div>
        </div>
      </div>

      <div class="demo-composer">
        <div class="demo-nudge hidden" id="demo-nudge">
          <span>Impressed? This is what YOUR clone could sound like.</span>
          <button class="nudge-btn" id="demo-nudge-btn">Build mine →</button>
        </div>

        <div class="composer-pill" id="demo-composer-pill">
          <textarea
            id="demo-input"
            class="composer-textarea"
            placeholder="Say something…"
            rows="1"
            autocomplete="off"
          ></textarea>
          <button class="composer-send" id="demo-send-btn" disabled>
            <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
              <path d="M7.5 12.5V2.5M3 7l4.5-4.5L12 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="composer-meta">
          <span class="demo-footer-left text-xs">
            free · no signup ·
            <a href="/" style="color:var(--c-text-2);text-decoration:underline;text-underline-offset:2px">what is rllyU?</a>
          </span>
          <button class="demo-own-chip" id="demo-own-btn">Build your own →</button>
        </div>
      </div>
    </div>
  `
}

function bindEvents(container: HTMLElement) {
  container.querySelector('#demo-build-btn')?.addEventListener('click', () => navigate('/auth?mode=signup'))
  container.querySelector('#demo-own-btn')?.addEventListener('click', () => navigate('/auth?mode=signup'))
  container.querySelector('#demo-nudge-btn')?.addEventListener('click', () => navigate('/auth?mode=signup'))

  const textarea = container.querySelector<HTMLTextAreaElement>('#demo-input')!
  const sendBtn = container.querySelector<HTMLButtonElement>('#demo-send-btn')!

  sendBtn.addEventListener('click', () => send(container))

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(container) }
  })
  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + 'px'
    sendBtn.disabled = textarea.value.trim().length === 0
  })
}

async function triggerFirstMessage(container: HTMLElement) {
  const messagesEl = container.querySelector<HTMLElement>('#demo-messages')!
  const inner = getInner(messagesEl)
  const typingEl = makeTypingBubble()
  inner.appendChild(typingEl)
  scrollBottom(messagesEl)

  try {
    const res = await fetch('/api/demo/first-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION_ID }),
    })
    const data = await res.json()
    typingEl.remove()
    if (data.content) {
      appendBubble(messagesEl, 'clone', data.content)
      messageCount++
    }
  } catch {
    typingEl.remove()
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

  const inner = getInner(messagesEl)
  const typingEl = makeTypingBubble()
  inner.appendChild(typingEl)
  scrollBottom(messagesEl)

  try {
    const res = await fetch('/api/demo/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: SESSION_ID }),
    })

    if (res.status === 503) {
      typingEl.remove()
      showToast('Demo being set up — check back soon!', 'error')
      return
    }

    const data = await res.json()
    typingEl.remove()

    if (data.content) {
      appendBubble(messagesEl, 'clone', data.content)
      messageCount++
      if (messageCount >= 4) {
        container.querySelector('#demo-nudge')?.classList.remove('hidden')
      }
    }
  } catch {
    typingEl.remove()
    showToast('Connection error — try again', 'error')
  } finally {
    isSending = false
    sendBtn.disabled = false
    textarea.focus()
  }
}

function getInner(messagesEl: HTMLElement): HTMLElement {
  return messagesEl.querySelector<HTMLElement>('.messages-inner') ?? messagesEl
}

function appendBubble(messagesEl: HTMLElement, role: 'clone' | 'user', content: string) {
  const inner = getInner(messagesEl)
  const bubble = document.createElement('div')
  bubble.className = `bubble bubble-${role}`
  bubble.textContent = content
  inner.appendChild(bubble)
  if (role === 'user') {
    requestAnimationFrame(() => scrollBottom(messagesEl))
  } else {
    scrollBottom(messagesEl)
  }
}

function makeTypingBubble(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bubble bubble-clone typing-bubble'
  el.innerHTML = `<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>`
  return el
}

function scrollBottom(el: HTMLElement) {
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
  if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
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
    }

    /* Header */
    .demo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: var(--glass-border);
      background: rgba(8,8,8,0.9);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      flex-shrink: 0;
      z-index: 10;
    }
    .demo-header-left { display: flex; align-items: center; gap: 12px; }
    .demo-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.08);
      border: var(--glass-border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      color: var(--c-text);
    }
    .demo-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .demo-badge {
      font-size: 11px;
      color: var(--c-text-3);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-top: 1px;
    }
    .demo-cta-pill {
      padding: 8px 18px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 600;
      background: var(--c-accent);
      color: var(--c-text-inv);
      transition: all var(--dur-fast) var(--ease);
    }
    .demo-cta-pill:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(255,255,255,.2); }

    /* Messages */
    .demo-msgs-outer {
      flex: 1;
      overflow: hidden;
      position: relative;
      min-height: 0;
    }
    .demo-msgs-outer::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 50px;
      background: linear-gradient(to top, var(--c-bg) 0%, transparent 100%);
      pointer-events: none;
      z-index: 2;
    }
    .demo-messages {
      height: 100%;
      overflow-y: auto;
      padding: 24px 20px 40px;
      scroll-behavior: smooth;
    }
    .messages-inner {
      max-width: 720px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* Intro card */
    .demo-intro-card {
      text-align: center;
      font-size: 13px;
      color: var(--c-text-3);
      line-height: 1.7;
      padding: 16px 24px 20px;
      background: rgba(255,255,255,0.03);
      border: var(--glass-border);
      border-radius: 16px;
      margin-bottom: 8px;
    }
    .demo-intro-sub {
      display: block;
      margin-top: 4px;
      color: rgba(255,255,255,0.2);
      font-size: 12px;
    }

    /* Bubbles (shared styles defined in chat styles, but redeclare for demo) */
    .bubble {
      max-width: 76%;
      padding: 10px 15px;
      font-size: 15px;
      line-height: 1.62;
      white-space: pre-wrap;
      word-break: break-word;
      animation: msg-in 0.32s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    @keyframes msg-in {
      from { opacity: 0; transform: translateY(10px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .bubble-clone {
      align-self: flex-start;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.09);
      border-radius: 4px 18px 18px 18px;
      color: var(--c-text);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }
    .bubble-user {
      align-self: flex-end;
      background: rgba(255,255,255,0.94);
      border-radius: 18px 4px 18px 18px;
      color: #0a0a0a;
      font-weight: 450;
    }
    .typing-bubble {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 13px 16px;
      min-width: 56px;
    }
    .tdot {
      display: block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: rgba(255,255,255,0.35);
      animation: tdot-pulse 1.35s ease-in-out infinite;
      flex-shrink: 0;
    }
    .tdot:nth-child(2) { animation-delay: 0.15s; }
    .tdot:nth-child(3) { animation-delay: 0.3s; }
    @keyframes tdot-pulse {
      0%, 60%, 100% { opacity: 0.25; transform: scale(0.8); }
      30%            { opacity: 0.9;  transform: scale(1.15); }
    }

    /* Composer */
    .demo-composer {
      flex-shrink: 0;
      padding: 8px 16px 20px;
      z-index: 10;
    }
    .demo-nudge {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      background: rgba(255,255,255,0.07);
      border: var(--glass-border);
      border-radius: 16px;
      padding: 12px 20px;
      margin-bottom: 10px;
      font-size: 13px;
      color: var(--c-text-2);
      max-width: 720px;
      margin-left: auto;
      margin-right: auto;
      animation: msg-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    .demo-nudge.hidden { display: none; }
    .nudge-btn {
      padding: 6px 16px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      background: white;
      color: #080808;
      flex-shrink: 0;
      transition: all var(--dur-fast) var(--ease);
    }
    .nudge-btn:hover { transform: scale(1.04); }

    /* Pill (shared with chat) */
    .composer-pill {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.11);
      border-radius: 20px;
      padding: 12px 10px 12px 18px;
      transition: border-color 220ms ease, box-shadow 220ms ease, background 220ms ease;
      max-width: 720px;
      margin: 0 auto;
    }
    .composer-pill:focus-within {
      border-color: rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.09);
      box-shadow: 0 0 0 3px rgba(255,255,255,0.04);
    }
    .composer-textarea {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      font-size: 15px;
      line-height: 1.55;
      color: var(--c-text);
      max-height: 180px;
      overflow-y: auto;
      padding: 1px 0;
      font-family: inherit;
    }
    .composer-textarea::placeholder { color: rgba(255,255,255,0.27); }
    .composer-send {
      flex-shrink: 0;
      width: 34px;
      height: 34px;
      border-radius: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255,255,255,0.1);
      color: rgba(255,255,255,0.3);
      transition: all 180ms cubic-bezier(0.16, 1, 0.3, 1);
      cursor: not-allowed;
    }
    .composer-send:not([disabled]) {
      background: #ffffff;
      color: #080808;
      cursor: pointer;
      box-shadow: 0 2px 10px rgba(255,255,255,0.18);
    }
    .composer-send:not([disabled]):hover {
      transform: scale(1.08);
      box-shadow: 0 4px 18px rgba(255,255,255,0.28);
    }
    .composer-send:not([disabled]):active { transform: scale(0.94); }

    .composer-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 4px 0;
      max-width: 720px;
      margin: 0 auto;
    }
    .demo-footer-left { color: rgba(255,255,255,0.28); }
    .demo-own-chip {
      font-size: 12px;
      color: rgba(255,255,255,0.35);
      padding: 4px 8px;
      border-radius: 8px;
      transition: color 150ms ease, background 150ms ease;
    }
    .demo-own-chip:hover { color: rgba(255,255,255,0.65); background: rgba(255,255,255,0.06); }

    @media (max-width: 600px) {
      .demo-nudge { flex-direction: column; gap: 10px; text-align: center; }
      .demo-messages { padding: 16px 14px 36px; }
      .demo-composer { padding: 6px 12px 16px; }
      .bubble { max-width: 88%; }
    }
  `
  document.head.appendChild(style)
}
