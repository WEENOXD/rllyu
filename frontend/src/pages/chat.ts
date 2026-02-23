import { navigate } from '../router.js'
import { auth, ai, chat, isApiError, type ChatMessage, type ChatSession, type UserMe } from '../api.js'
import { simulateTyping, autoScroll } from '../components/typing-indicator.js'
import { openImportDrawer } from '../components/import-drawer.js'
import { showToast } from '../main.js'

let me: UserMe | null = null
let sessions: ChatSession[] = []
let activeSessionId: string | null = null
let activeMode: 'raw' | 'soft' | 'cold' = 'raw'
let isSending = false

// ── Mount ────────────────────────────────────────────────────────────────────
export async function mountChat(container: HTMLElement) {
  try { me = await auth.me() } catch { navigate('/auth'); return }
  if (!me.hasProfile) { navigate('/import'); return }

  injectChatStyles()
  container.innerHTML = renderShell()
  bindShellEvents(container)

  try { sessions = await chat.sessions() } catch { sessions = [] }
  renderSessionList(container)

  if (sessions.length > 0) {
    await openSession(container, sessions[0].id)
  } else {
    await createNewSession(container)
  }
}

// ── Shell HTML ────────────────────────────────────────────────────────────────
function renderShell(): string {
  return `
    <div class="chat-shell" id="chat-shell">
      <aside class="chat-sidebar" id="chat-sidebar">
        <div class="sidebar-header">
          <span class="sidebar-logo">rllyu<span>.</span></span>
          <button class="icon-btn" id="new-session-btn" title="New chat">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="session-list" id="session-list"></div>
        <div class="sidebar-footer">
          <button class="sidebar-action-btn" id="import-more-btn">+ Add memories</button>
          <button class="sidebar-action-btn" id="chat-logout-btn">Log out</button>
        </div>
      </aside>

      <div class="chat-main" id="chat-main">
        <header class="chat-header">
          <button class="icon-btn sidebar-toggle" id="sidebar-toggle">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <div class="chat-header-center">
            <span class="chat-title">your clone</span>
            <span class="chat-subtitle" id="chat-sub-label">rllyU</span>
          </div>
          <div class="mode-toggle" id="mode-toggle">
            <button class="mode-btn active" data-mode="raw">Raw</button>
            <button class="mode-btn" data-mode="soft">Soft</button>
            <button class="mode-btn" data-mode="cold">Cold</button>
          </div>
        </header>

        <div class="msgs-outer">
          <div class="chat-messages" id="chat-messages"></div>
        </div>

        <div class="chat-composer">
          <div class="composer-pill" id="composer-pill">
            <textarea
              id="chat-input"
              class="composer-textarea"
              placeholder="Message your clone…"
              rows="1"
              autocomplete="off"
              spellcheck="true"
            ></textarea>
            <button class="composer-send" id="chat-send-btn" disabled>
              <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                <path d="M7.5 12.5V2.5M3 7l4.5-4.5L12 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <div class="composer-meta">
            <button class="composer-chip" id="bottom-import-btn">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M5 1v8M1 5h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
              memories
            </button>
            <span class="composer-hint">shift + ↵ newline</span>
          </div>
        </div>
      </div>
    </div>
  `
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindShellEvents(container: HTMLElement) {
  container.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
    container.querySelector('#chat-sidebar')?.classList.toggle('open')
  })
  container.querySelector('#chat-main')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#chat-sidebar')) return
    container.querySelector('#chat-sidebar')?.classList.remove('open')
  })

  container.querySelector('#new-session-btn')?.addEventListener('click', () => createNewSession(container))
  container.querySelector('#import-more-btn')?.addEventListener('click', () => openImportDrawer())
  container.querySelector('#bottom-import-btn')?.addEventListener('click', () => openImportDrawer())

  container.querySelector('#chat-logout-btn')?.addEventListener('click', async () => {
    await auth.logout().catch(() => {})
    navigate('/')
  })

  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (me?.plan !== 'pro' && btn.getAttribute('data-mode') !== 'raw') {
        showToast('Mode toggles are a pro feature', 'error'); return
      }
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      activeMode = btn.getAttribute('data-mode') as typeof activeMode
    })
  })

  const textarea = container.querySelector<HTMLTextAreaElement>('#chat-input')!
  const sendBtn = container.querySelector<HTMLButtonElement>('#chat-send-btn')!

  sendBtn.addEventListener('click', () => sendMessage(container))

  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(container) }
  })

  textarea.addEventListener('input', () => {
    // Auto-resize
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px'
    // Toggle send button
    const hasText = textarea.value.trim().length > 0
    sendBtn.disabled = !hasText
  })
}

// ── Session list ──────────────────────────────────────────────────────────────
function renderSessionList(container: HTMLElement) {
  const list = container.querySelector<HTMLElement>('#session-list')!
  if (sessions.length === 0) {
    list.innerHTML = `<div class="session-empty">No sessions yet</div>`
    return
  }
  list.innerHTML = sessions.map(s => `
    <div class="session-item ${s.id === activeSessionId ? 'active' : ''}" data-id="${s.id}">
      <div class="session-title">${escHtml(s.title)}</div>
      <div class="session-count">${s.messageCount ?? 0} msg</div>
    </div>
  `).join('')

  list.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', async () => {
      container.querySelector('#chat-sidebar')?.classList.remove('open')
      await openSession(container, item.getAttribute('data-id')!)
    })
  })
}

// ── Open session ──────────────────────────────────────────────────────────────
async function openSession(container: HTMLElement, sessionId: string) {
  activeSessionId = sessionId
  renderSessionList(container)

  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
  messagesEl.innerHTML = `
    <div class="messages-inner">
      <div class="msgs-loading">
        <span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>
      </div>
    </div>
  `
  try {
    const messages = await chat.messages(sessionId)
    renderMessages(messagesEl, messages)
  } catch {
    messagesEl.innerHTML = `<div class="msgs-error">Failed to load — try again</div>`
  }
}

// ── Create session ────────────────────────────────────────────────────────────
async function createNewSession(container: HTMLElement) {
  try {
    const session = await chat.create()
    sessions.unshift(session)
    activeSessionId = session.id
    renderSessionList(container)
    const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
    messagesEl.innerHTML = `<div class="messages-inner"></div>`
    await triggerFirstMessage(container)
  } catch (err) {
    showToast(isApiError(err) ? err.message : 'Failed to create session', 'error')
  }
}

// ── First message ─────────────────────────────────────────────────────────────
async function triggerFirstMessage(container: HTMLElement) {
  if (!activeSessionId) return
  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
  await simulateTyping(messagesEl, (text) => {
    appendBubble(messagesEl, 'clone', text)
    if (me) me.cloneReplyCount = (me.cloneReplyCount ?? 0) + 1
  }, '…')
  try {
    const { content } = await ai.firstMessage(activeSessionId)
    messagesEl.querySelector('.bubble-clone:last-child')?.remove()
    await simulateTyping(messagesEl, (text) => {
      appendBubble(messagesEl, 'clone', text)
      if (me) me.cloneReplyCount = (me.cloneReplyCount ?? 0) + 1
    }, content)
  } catch { /* silent */ }
}

// ── Send ──────────────────────────────────────────────────────────────────────
async function sendMessage(container: HTMLElement) {
  if (isSending || !activeSessionId) return
  const textarea = container.querySelector<HTMLTextAreaElement>('#chat-input')!
  const text = textarea.value.trim()
  if (!text) return

  isSending = true
  textarea.value = ''
  textarea.style.height = 'auto'
  const sendBtn = container.querySelector<HTMLButtonElement>('#chat-send-btn')!
  sendBtn.disabled = true

  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
  appendBubble(messagesEl, 'user', text)

  // Typing indicator
  const inner = getOrCreateInner(messagesEl)
  const typingEl = createTypingBubble()
  inner.appendChild(typingEl)
  autoScroll(messagesEl)

  try {
    const reply = await ai.chat(activeSessionId, text, activeMode)
    typingEl.remove()
    appendBubble(messagesEl, 'clone', reply.content)

    // Auto-title
    const sess = sessions.find(s => s.id === activeSessionId)
    if (sess && sess.title === 'New Chat') {
      sess.title = text.replace(/\s+/g, ' ').slice(0, 48).trim()
      renderSessionList(container)
      chat.rename(activeSessionId, sess.title).catch(() => {})
    }
  } catch (err) {
    typingEl.remove()
    showToast(isApiError(err) ? err.message : 'Something went wrong', 'error')
  } finally {
    isSending = false
    textarea.focus()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getOrCreateInner(messagesEl: HTMLElement): HTMLElement {
  let inner = messagesEl.querySelector<HTMLElement>('.messages-inner')
  if (!inner) {
    inner = document.createElement('div')
    inner.className = 'messages-inner'
    messagesEl.appendChild(inner)
  }
  return inner
}

function appendBubble(messagesEl: HTMLElement, role: 'user' | 'clone', content: string) {
  const inner = getOrCreateInner(messagesEl)
  const bubble = document.createElement('div')
  bubble.className = `bubble bubble-${role}`
  bubble.textContent = content
  inner.appendChild(bubble)
  // Always scroll on user message; smart scroll on clone
  if (role === 'user') {
    requestAnimationFrame(() => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' }))
  } else {
    autoScroll(messagesEl)
  }
}

function renderMessages(messagesEl: HTMLElement, messages: ChatMessage[]) {
  if (messages.length === 0) {
    messagesEl.innerHTML = `
      <div class="messages-inner">
        <div class="msgs-empty">Your clone is ready.<br>Start the conversation.</div>
      </div>`
    return
  }
  const inner = document.createElement('div')
  inner.className = 'messages-inner'
  for (const m of messages) {
    if (m.role === 'system') continue
    const bubble = document.createElement('div')
    bubble.className = `bubble bubble-${m.role}`
    bubble.textContent = m.content
    inner.appendChild(bubble)
  }
  messagesEl.innerHTML = ''
  messagesEl.appendChild(inner)
  requestAnimationFrame(() => messagesEl.scrollTop = messagesEl.scrollHeight)
}

function createTypingBubble(): HTMLElement {
  const el = document.createElement('div')
  el.className = 'bubble bubble-clone typing-bubble'
  el.innerHTML = `<span class="tdot"></span><span class="tdot"></span><span class="tdot"></span>`
  return el
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Styles ────────────────────────────────────────────────────────────────────
function injectChatStyles() {
  if (document.getElementById('chat-styles')) return
  const style = document.createElement('style')
  style.id = 'chat-styles'
  style.textContent = `
    /* ── Layout ── */
    .chat-shell {
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: var(--c-bg);
    }

    /* ── Sidebar ── */
    .chat-sidebar {
      width: 240px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      background: var(--c-bg-2);
      border-right: var(--glass-border);
      transition: transform var(--dur-mid) var(--ease);
    }
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px;
      border-bottom: var(--glass-border);
    }
    .sidebar-logo {
      font-size: 17px;
      font-weight: 900;
      letter-spacing: -0.04em;
    }
    .sidebar-logo span { color: var(--c-text-3); }
    .icon-btn {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--c-text-2);
      transition: background var(--dur-fast), color var(--dur-fast);
    }
    .icon-btn:hover { background: var(--c-surface); color: var(--c-text); }
    .session-list { flex: 1; overflow-y: auto; padding: 8px; }
    .session-item {
      padding: 10px 12px;
      border-radius: 12px;
      cursor: pointer;
      transition: background var(--dur-fast);
      margin-bottom: 1px;
    }
    .session-item:hover { background: var(--c-surface-hover); }
    .session-item.active { background: var(--c-glass); }
    .session-title {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--c-text);
    }
    .session-count { font-size: 11px; color: var(--c-text-3); margin-top: 2px; }
    .session-empty { padding: 16px 12px; font-size: 13px; color: var(--c-text-3); }
    .sidebar-footer {
      border-top: var(--glass-border);
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .sidebar-action-btn {
      text-align: left;
      padding: 8px 10px;
      font-size: 13px;
      color: var(--c-text-3);
      border-radius: 10px;
      transition: background var(--dur-fast), color var(--dur-fast);
    }
    .sidebar-action-btn:hover { background: var(--c-surface); color: var(--c-text-2); }

    /* ── Main ── */
    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    /* ── Header ── */
    .chat-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-bottom: var(--glass-border);
      background: rgba(8,8,8,0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      flex-shrink: 0;
      z-index: 10;
    }
    .sidebar-toggle { display: none; }
    .chat-header-center { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .chat-title { font-size: 14px; font-weight: 600; color: var(--c-text); letter-spacing: -0.01em; }
    .chat-subtitle { font-size: 11px; color: var(--c-text-3); text-transform: uppercase; letter-spacing: 0.06em; }

    /* Mode toggle */
    .mode-toggle {
      display: flex;
      background: rgba(255,255,255,0.06);
      border-radius: 999px;
      padding: 3px;
      gap: 2px;
    }
    .mode-btn {
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      color: var(--c-text-3);
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: all var(--dur-fast) var(--ease);
    }
    .mode-btn.active { background: var(--c-glass-strong); color: var(--c-text); }

    /* ── Messages ── */
    .msgs-outer {
      flex: 1;
      overflow: hidden;
      position: relative;
      min-height: 0;
    }
    .msgs-outer::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 60px;
      background: linear-gradient(to top, var(--c-bg) 0%, transparent 100%);
      pointer-events: none;
      z-index: 2;
    }
    .chat-messages {
      height: 100%;
      overflow-y: auto;
      padding: 28px 20px 48px;
      scroll-behavior: smooth;
    }
    .messages-inner {
      max-width: 740px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* ── Bubbles ── */
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

    /* Typing dots */
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

    /* States */
    .msgs-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 60px 20px;
      opacity: 0.5;
    }
    .msgs-loading .tdot { background: var(--c-text-2); }
    .msgs-empty, .msgs-error {
      text-align: center;
      color: var(--c-text-3);
      font-size: 14px;
      line-height: 1.7;
      padding: 60px 20px;
    }

    /* ── Composer ── */
    .chat-composer {
      flex-shrink: 0;
      padding: 8px 16px 20px;
      z-index: 10;
    }
    .composer-pill {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.11);
      border-radius: 20px;
      padding: 12px 10px 12px 18px;
      transition:
        border-color 220ms ease,
        box-shadow 220ms ease,
        background 220ms ease;
      max-width: 740px;
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
      max-height: 200px;
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
      max-width: 740px;
      margin: 0 auto;
    }
    .composer-chip {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: rgba(255,255,255,0.32);
      padding: 4px 8px;
      border-radius: 8px;
      transition: color 150ms ease, background 150ms ease;
    }
    .composer-chip:hover { color: rgba(255,255,255,0.6); background: rgba(255,255,255,0.06); }
    .composer-hint {
      font-size: 11px;
      color: rgba(255,255,255,0.18);
      letter-spacing: 0.02em;
    }

    /* ── Import drawer ── */
    .drawer-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,.5);
      z-index: 7000;
    }
    .import-drawer {
      position: fixed;
      right: 0; top: 0; bottom: 0;
      width: min(420px, 100vw);
      z-index: 7001;
      background: var(--c-bg-2);
      border: var(--glass-border);
      border-radius: var(--r-lg) 0 0 var(--r-lg);
      padding: var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      transform: translateX(100%);
      transition: transform var(--dur-mid) var(--ease);
      overflow-y: auto;
    }
    .import-drawer.open { transform: translateX(0); }
    .drawer-header { display: flex; align-items: center; justify-content: space-between; }
    .drawer-title { font-size: var(--t-md); font-weight: 700; }
    .drawer-dump { min-height: 200px; max-height: 40vh; resize: none; line-height: 1.65; }

    /* ── Mobile ── */
    @media (max-width: 768px) {
      .chat-sidebar {
        position: fixed;
        left: 0; top: 0; bottom: 0;
        z-index: 6000;
        transform: translateX(-100%);
        width: 280px;
        box-shadow: var(--shadow-lg);
      }
      .chat-sidebar.open { transform: translateX(0); }
      .sidebar-toggle { display: flex; }
      .mode-toggle { display: none; }
      .bubble { max-width: 88%; }
      .chat-messages { padding: 20px 14px 40px; }
      .chat-composer { padding: 6px 12px 16px; }
      .composer-pill { border-radius: 18px; }
      .composer-hint { display: none; }
    }
  `
  document.head.appendChild(style)
}
