import { navigate } from '../router.js'
import { auth, ai, chat, isApiError, type ChatMessage, type ChatSession, type UserMe } from '../api.js'
import { simulateTyping } from '../components/typing-indicator.js'
import { openImportDrawer } from '../components/import-drawer.js'
import { showToast } from '../main.js'

let me: UserMe | null = null
let sessions: ChatSession[] = []
let activeSessionId: string | null = null
let activeMode: 'raw' | 'soft' | 'cold' = 'raw'
let isSending = false

// ── Mount ────────────────────────────────────────────────────────────────────
export async function mountChat(container: HTMLElement) {
  try {
    me = await auth.me()
  } catch {
    navigate('/auth')
    return
  }

  if (!me.hasProfile) {
    navigate('/import')
    return
  }

  injectChatStyles()
  container.innerHTML = renderShell()
  bindShellEvents(container)

  // Load sessions
  try {
    sessions = await chat.sessions()
  } catch { sessions = [] }

  renderSessionList(container)

  // Open first session or create one
  if (sessions.length > 0) {
    await openSession(container, sessions[0].id)
  } else {
    await createNewSession(container)
  }
}

// ── Shell ─────────────────────────────────────────────────────────────────────
function renderShell(): string {
  return `
    <div class="chat-shell" id="chat-shell">
      <!-- Session sidebar -->
      <aside class="chat-sidebar" id="chat-sidebar">
        <div class="sidebar-header">
          <span class="nav-logo sidebar-logo">rllyu<span style="color:var(--c-text-3)">.</span></span>
          <button class="btn btn-icon btn-glass btn-sm" id="new-session-btn" title="New chat">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="session-list" id="session-list"></div>
        <div class="sidebar-footer">
          <button class="btn btn-ghost btn-sm sidebar-footer-btn" id="import-more-btn">
            + Add memories
          </button>
          <button class="btn btn-ghost btn-sm sidebar-footer-btn" id="chat-logout-btn">
            Log out
          </button>
        </div>
      </aside>

      <!-- Main chat area -->
      <div class="chat-main" id="chat-main">
        <!-- Header -->
        <header class="chat-header">
          <button class="btn btn-icon btn-ghost sidebar-toggle" id="sidebar-toggle" title="Sessions">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <div class="chat-header-center">
            <span class="chat-clone-label">rllyU</span>
            <span class="chat-sub text-dim text-xs" id="chat-sub-label">your clone</span>
          </div>
          <div class="chat-header-right">
            <!-- Mode toggle -->
            <div class="mode-toggle" id="mode-toggle">
              <button class="mode-btn active" data-mode="raw">Raw</button>
              <button class="mode-btn" data-mode="soft">Soft</button>
              <button class="mode-btn" data-mode="cold">Cold</button>
            </div>
          </div>
        </header>

        <!-- Messages -->
        <div class="chat-messages" id="chat-messages"></div>

        <!-- Input bar -->
        <div class="chat-input-bar">
          <div class="chat-input-wrap glass-card">
            <textarea
              id="chat-input"
              class="chat-textarea"
              placeholder="Say something…"
              rows="1"
            ></textarea>
            <button class="btn btn-primary chat-send-btn" id="chat-send-btn">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 2L2 8l4 2 2 6 6-14z" fill="currentColor"/>
              </svg>
            </button>
          </div>
          <div class="chat-input-meta">
            <button class="btn btn-ghost btn-sm" id="bottom-import-btn">+ memories</button>
          </div>
        </div>
      </div>
    </div>
  `
}


// ── Shell events ──────────────────────────────────────────────────────────────
function bindShellEvents(container: HTMLElement) {
  // Sidebar toggle (mobile)
  container.querySelector('#sidebar-toggle')?.addEventListener('click', () => {
    container.querySelector('#chat-sidebar')?.classList.toggle('open')
  })
  // Tap outside sidebar to close (mobile)
  container.querySelector('#chat-main')?.addEventListener('click', () => {
    container.querySelector('#chat-sidebar')?.classList.remove('open')
  })

  // New session
  container.querySelector('#new-session-btn')?.addEventListener('click', () => createNewSession(container))

  // Mode toggle
  container.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (me?.plan !== 'pro' && btn.getAttribute('data-mode') !== 'raw') {
        showToast('Mode toggles are a pro feature 🔒', 'error')
        return
      }
      container.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      activeMode = btn.getAttribute('data-mode') as typeof activeMode
    })
  })

  // Import
  container.querySelector('#import-more-btn')?.addEventListener('click', () => openImportDrawer())
  container.querySelector('#bottom-import-btn')?.addEventListener('click', () => openImportDrawer())

  // Logout
  container.querySelector('#chat-logout-btn')?.addEventListener('click', async () => {
    await auth.logout().catch(() => {})
    navigate('/')
  })

  // Send button
  container.querySelector('#chat-send-btn')?.addEventListener('click', () => sendMessage(container))

  // Textarea: Enter sends, Shift+Enter newline
  const textarea = container.querySelector<HTMLTextAreaElement>('#chat-input')!
  textarea?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(container)
    }
  })
  // Auto-resize textarea
  textarea?.addEventListener('input', () => {
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 160) + 'px'
  })
}

// ── Session list ──────────────────────────────────────────────────────────────
function renderSessionList(container: HTMLElement) {
  const list = container.querySelector<HTMLElement>('#session-list')
  if (!list) return

  if (sessions.length === 0) {
    list.innerHTML = `<div class="session-empty text-dim text-sm">No sessions yet</div>`
    return
  }

  list.innerHTML = sessions.map(s => `
    <div
      class="session-item ${s.id === activeSessionId ? 'active' : ''}"
      data-id="${s.id}"
    >
      <div class="session-item-title">${escHtml(s.title)}</div>
      <div class="session-item-sub text-xs text-dim">
        ${s.messageCount ?? 0} messages
      </div>
    </div>
  `).join('')

  list.querySelectorAll('.session-item').forEach(item => {
    item.addEventListener('click', async () => {
      const id = item.getAttribute('data-id')!
      container.querySelector('#chat-sidebar')?.classList.remove('open') // close on mobile
      await openSession(container, id)
    })
  })
}

// ── Open / load a session ─────────────────────────────────────────────────────
async function openSession(container: HTMLElement, sessionId: string) {
  activeSessionId = sessionId
  renderSessionList(container) // highlight active

  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
  messagesEl.innerHTML = `
    <div class="messages-loading">
      <div class="dot-pulse"><span></span><span></span><span></span></div>
    </div>
  `

  try {
    const messages = await chat.messages(sessionId)
    renderMessages(messagesEl, messages)
  } catch {
    messagesEl.innerHTML = `<div class="text-dim text-sm" style="text-align:center;padding:40px">Failed to load messages</div>`
  }
}

// ── Create new session ────────────────────────────────────────────────────────
async function createNewSession(container: HTMLElement) {
  try {
    const session = await chat.create()
    sessions.unshift(session)
    activeSessionId = session.id
    renderSessionList(container)

    const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
    messagesEl.innerHTML = ''

    // Trigger "holy sh*t" first message
    await triggerFirstMessage(container)
  } catch (err) {
    showToast(isApiError(err) ? err.message : 'Failed to create session', 'error')
  }
}

// ── First message (the hook) ──────────────────────────────────────────────────
async function triggerFirstMessage(container: HTMLElement) {
  if (!activeSessionId) return
  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!

  await simulateTyping(messagesEl, (text) => {
    appendBubble(messagesEl, 'clone', text)
    updateReplyCounter(container)
    if (me) me.cloneReplyCount = (me.cloneReplyCount ?? 0) + 1
  }, '…')

  try {
    const { content } = await ai.firstMessage(activeSessionId)
    // Replace the last placeholder
    const lastBubble = messagesEl.querySelector('.bubble-clone:last-child')
    if (lastBubble) lastBubble.remove()

    await simulateTyping(messagesEl, (text) => {
      appendBubble(messagesEl, 'clone', text)
      if (me) me.cloneReplyCount = (me.cloneReplyCount ?? 0) + 1
      updateReplyCounter(container)
    }, content)
  } catch { /* silent fail — user can start */ }
}

// ── Send message ──────────────────────────────────────────────────────────────
async function sendMessage(container: HTMLElement) {
  if (isSending || !activeSessionId) return

  const textarea = container.querySelector<HTMLTextAreaElement>('#chat-input')!
  const text = textarea.value.trim()
  if (!text) return

  isSending = true
  textarea.value = ''
  textarea.style.height = 'auto'
  setSendDisabled(container, true)

  const messagesEl = container.querySelector<HTMLElement>('#chat-messages')!
  appendBubble(messagesEl, 'user', text)

  try {
    // Show typing indicator while waiting for API
    const typingEl = document.createElement('div')
    typingEl.className = 'bubble bubble-clone typing-bubble fade-up'
    typingEl.innerHTML = `<div class="dot-pulse"><span></span><span></span><span></span></div>`
    messagesEl.appendChild(typingEl)
    messagesEl.scrollTop = messagesEl.scrollHeight

    const reply = await ai.chat(activeSessionId, text, activeMode)
    typingEl.remove()

    appendBubble(messagesEl, 'clone', reply.content)

    // Auto-title session on first user message
    const sess = sessions.find(s => s.id === activeSessionId)
    if (sess && sess.title === 'New Chat') {
      const title = text.replace(/\s+/g, ' ').slice(0, 48).trim()
      sess.title = title
      renderSessionList(container)
      chat.rename(activeSessionId, title).catch(() => {})
    }

  } catch (err) {
    showToast(isApiError(err) ? err.message : 'Something went wrong', 'error')
  } finally {
    isSending = false
    setSendDisabled(container, false)
    textarea.focus()
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function appendBubble(messagesEl: HTMLElement, role: 'user' | 'clone', content: string) {
  const bubble = document.createElement('div')
  bubble.className = `bubble bubble-${role} fade-up`
  bubble.textContent = content
  messagesEl.appendChild(bubble)
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function renderMessages(messagesEl: HTMLElement, messages: ChatMessage[]) {
  if (messages.length === 0) {
    messagesEl.innerHTML = `
      <div class="messages-empty text-dim text-sm">
        Your clone is ready. Start talking.
      </div>`
    return
  }
  messagesEl.innerHTML = ''
  for (const m of messages) {
    if (m.role === 'system') continue
    const bubble = document.createElement('div')
    bubble.className = `bubble bubble-${m.role}`
    bubble.textContent = m.content
    messagesEl.appendChild(bubble)
  }
  messagesEl.scrollTop = messagesEl.scrollHeight
}

function setSendDisabled(container: HTMLElement, disabled: boolean) {
  const btn = container.querySelector<HTMLButtonElement>('#chat-send-btn')
  if (btn) btn.disabled = disabled
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
    /* Shell layout */
    .chat-shell {
      display: flex;
      height: 100vh;
      overflow: hidden;
      background: var(--c-bg);
    }

    /* Sidebar */
    .chat-sidebar {
      width: 240px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      border-right: var(--glass-border);
      background: var(--c-bg-2);
      transition: transform var(--dur-mid) var(--ease);
    }
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-4) var(--sp-4);
      border-bottom: var(--glass-border);
    }
    .sidebar-logo {
      font-size: var(--t-md);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .session-list { flex: 1; overflow-y: auto; padding: var(--sp-2); }
    .session-item {
      padding: var(--sp-3) var(--sp-3);
      border-radius: var(--r-md);
      cursor: pointer;
      transition: background var(--dur-fast);
      margin-bottom: 2px;
    }
    .session-item:hover { background: var(--c-surface-hover); }
    .session-item.active { background: var(--c-glass); }
    .session-item-title {
      font-size: var(--t-sm);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .session-empty { padding: var(--sp-4) var(--sp-3); }

    .sidebar-footer {
      border-top: var(--glass-border);
      padding: var(--sp-3);
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sidebar-footer-btn { justify-content: flex-start; font-size: var(--t-sm); }

    /* Main */
    .chat-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Header */
    .chat-header {
      display: flex;
      align-items: center;
      padding: var(--sp-3) var(--sp-4);
      border-bottom: var(--glass-border);
      background: rgba(8,8,8,.8);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
      gap: var(--sp-3);
      flex-shrink: 0;
    }
    .chat-header-center {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .chat-clone-label {
      font-size: var(--t-base);
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .chat-header-right { display: flex; align-items: center; gap: var(--sp-2); }

    .sidebar-toggle { display: none; }

    /* Mode toggle */
    .mode-toggle {
      display: flex;
      background: var(--c-surface);
      border-radius: var(--r-pill);
      padding: 3px;
      gap: 2px;
    }
    .mode-btn {
      padding: 4px 10px;
      border-radius: var(--r-pill);
      font-size: var(--t-xs);
      font-weight: 600;
      color: var(--c-text-3);
      transition: all var(--dur-fast) var(--ease);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .mode-btn.active {
      background: var(--c-glass-strong);
      color: var(--c-text);
    }

    /* Messages */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: var(--sp-6) var(--sp-5);
      display: flex;
      flex-direction: column;
      gap: var(--sp-3);
    }

    .bubble {
      max-width: 75%;
      padding: 12px 16px;
      font-size: var(--t-base);
      line-height: 1.55;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .bubble-clone {
      background: var(--c-bubble-clone);
      border: var(--glass-border);
      border-radius: var(--r-bubble-clone);
      align-self: flex-start;
      color: var(--c-text);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
    }

    .bubble-user {
      background: var(--c-bubble-user);
      border-radius: var(--r-bubble-user);
      align-self: flex-end;
      color: var(--c-text-inv);
    }

    .typing-bubble { opacity: 0.7; }

    .messages-loading, .messages-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 60px 20px;
    }

    /* Paywall bubble */
    .paywall-bubble-wrap {
      position: relative;
      overflow: hidden;
    }
    .paywall-bubble-text {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .paywall-bubble-blur {
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 60%;
      background: linear-gradient(to bottom, transparent, rgba(8,8,8,.95));
    }
    .paywall-bubble-btn {
      margin-top: var(--sp-3);
      position: relative;
      z-index: 1;
    }

    /* Input bar */
    .chat-input-bar {
      padding: var(--sp-4) var(--sp-5) var(--sp-5);
      flex-shrink: 0;
      background: rgba(8,8,8,.7);
      backdrop-filter: var(--blur-sm);
      -webkit-backdrop-filter: var(--blur-sm);
    }
    .chat-input-wrap {
      display: flex;
      align-items: flex-end;
      gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-4);
      border-radius: var(--r-xl);
    }
    .chat-textarea {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      font-size: var(--t-base);
      line-height: 1.5;
      color: var(--c-text);
      max-height: 160px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .chat-textarea::placeholder { color: var(--c-text-3); }
    .chat-send-btn {
      flex-shrink: 0;
      width: 38px;
      height: 38px;
      padding: 0;
      border-radius: var(--r-md);
    }

    .chat-input-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-2) var(--sp-2) 0;
    }

    /* Paywall modal */
    .paywall-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.75);
      backdrop-filter: var(--blur-md);
      -webkit-backdrop-filter: var(--blur-md);
      z-index: 8000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--sp-6);
    }
    .paywall-modal {
      width: 100%;
      max-width: 440px;
      padding: var(--sp-10) var(--sp-8);
      text-align: center;
    }
    .paywall-emoji { font-size: 48px; margin-bottom: var(--sp-4); }
    .paywall-title {
      font-size: var(--t-xl);
      font-weight: 900;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: var(--sp-4);
    }
    .paywall-sub {
      color: var(--c-text-2);
      line-height: 1.6;
      margin-bottom: var(--sp-6);
    }
    .paywall-features {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      margin-bottom: var(--sp-6);
      text-align: left;
    }
    .paywall-feature {
      font-size: var(--t-sm);
      color: var(--c-text-2);
      padding: var(--sp-2) 0;
      border-bottom: var(--glass-border);
    }
    .paywall-cta { margin-bottom: var(--sp-3); }
    .paywall-dismiss { color: var(--c-text-3); }

    /* Import drawer */
    .drawer-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.5);
      z-index: 7000;
    }
    .import-drawer {
      position: fixed;
      right: 0; top: 0; bottom: 0;
      width: min(420px, 100vw);
      z-index: 7001;
      border-radius: var(--r-lg) 0 0 var(--r-lg);
      padding: var(--sp-6);
      display: flex;
      flex-direction: column;
      gap: var(--sp-4);
      transform: translateX(100%);
      transition: transform var(--dur-mid) var(--ease);
      overflow-y: auto;
      background: var(--c-bg-2);
      border: var(--glass-border);
    }
    .import-drawer.open { transform: translateX(0); }
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-title { font-size: var(--t-md); font-weight: 700; }
    .drawer-tabs {
      display: flex;
      background: var(--c-surface);
      border-radius: var(--r-pill);
      padding: 4px;
      gap: 4px;
    }
    .drawer-tab {
      flex: 1;
      padding: 6px;
      border-radius: var(--r-pill);
      font-size: var(--t-sm);
      color: var(--c-text-2);
      transition: all var(--dur-fast) var(--ease);
    }
    .drawer-dump {
      min-height: 200px;
      max-height: 40vh;
      resize: none;
      line-height: 1.65;
    }

    /* Mobile responsive */
    @media (max-width: 768px) {
      .chat-sidebar {
        position: fixed;
        left: 0; top: 0; bottom: 0;
        z-index: 6000;
        transform: translateX(-100%);
        width: 280px;
      }
      .chat-sidebar.open { transform: translateX(0); }
      .sidebar-toggle { display: flex; }
      .chat-messages { padding: var(--sp-4) var(--sp-3); }
      .bubble { max-width: 88%; }
      .mode-toggle { display: none; }
      .chat-input-bar { padding: var(--sp-3) var(--sp-3) var(--sp-4); }
    }

    .fade-out { opacity: 0; transition: opacity var(--dur-mid); }
  `
  document.head.appendChild(style)
}
