import { navigate } from '../router.js'
import { auth, imports, ai, isApiError } from '../api.js'
import { showToast } from '../main.js'

type Step = 'import' | 'building' | 'done'

let currentStep: Step = 'import'
let importedCount = 0

export async function mountImport(container: HTMLElement) {
  try {
    await auth.me()
  } catch {
    navigate('/auth')
    return
  }

  currentStep = 'import'
  importedCount = 0

  render(container)
  injectImportStyles()
}

function render(container: HTMLElement) {
  container.innerHTML = `
    <div class="import-page page">
      <nav class="nav">
        <div class="nav-logo">rllyu<span style="color:var(--c-text-3)">.</span></div>
        <button class="btn btn-ghost btn-sm" id="imp-logout">Log out</button>
      </nav>

      <main class="import-main">
        ${currentStep === 'import'  ? renderDump()     :
          currentStep === 'building' ? renderBuilding() :
          renderDone()}
      </main>
    </div>
  `

  bindEvents(container)
}

function renderDump(): string {
  return `
    <div class="dump-wrap fade-up">
      <div class="dump-heading">
        <h1 class="dump-title">dump it all here.</h1>
        <p class="dump-sub">notes, captions, DMs, texts — anything you've written.<br>the more, the more accurate your clone.</p>
      </div>

      <div class="dump-box-wrap">
        <textarea
          id="dump-area"
          class="dump-area"
          placeholder="Paste anything—notes, captions, DMs, texts."
          spellcheck="false"
          autocorrect="off"
        ></textarea>
        <div class="dump-meta">
          <span id="dump-count" class="dump-count">—</span>
          <button class="btn btn-primary dump-btn" id="dump-btn" disabled>
            Build my clone →
          </button>
        </div>
      </div>

      <p class="dump-hint">
        Works with iMessage exports, Twitter DMs, Discord logs, journal entries, captions, anything.<br>
        No format required — just paste.
      </p>
    </div>
  `
}

function renderBuilding(): string {
  return `
    <div class="building-wrap fade-up">
      <div class="dot-pulse building-dots">
        <span></span><span></span><span></span>
      </div>
      <h2 class="building-title">Building your clone…</h2>
      <p class="text-muted building-sub">
        Reading ${importedCount.toLocaleString()} messages. Mapping your voice.
      </p>
      <div id="build-progress-msg" class="building-progress">Reading your patterns…</div>
    </div>
  `
}

function renderDone(): string {
  return `
    <div class="done-wrap fade-up">
      <div class="done-glyph">🔮</div>
      <h2 class="done-title">Clone built.</h2>
      <p class="text-muted done-sub">
        ${importedCount.toLocaleString()} messages ingested.<br>Time to meet yourself.
      </p>
      <button class="btn btn-primary btn-lg" id="imp-go-chat">
        Start chatting →
      </button>
    </div>
  `
}

function bindEvents(container: HTMLElement) {
  container.querySelector('#imp-logout')?.addEventListener('click', async () => {
    await auth.logout().catch(() => {})
    navigate('/')
  })

  if (currentStep === 'import') {
    const area = container.querySelector<HTMLTextAreaElement>('#dump-area')!
    const countEl = container.querySelector<HTMLElement>('#dump-count')!
    const btn = container.querySelector<HTMLButtonElement>('#dump-btn')!

    area.addEventListener('input', () => {
      const len = area.value.trim().length
      const words = len ? area.value.trim().split(/\s+/).length : 0
      countEl.textContent = len ? `${words.toLocaleString()} words` : '—'
      btn.disabled = len < 20
    })

    // Auto-focus
    setTimeout(() => area.focus(), 60)

    btn.addEventListener('click', async () => {
      const raw = area.value.trim()
      if (!raw) return
      await doImport(raw, container)
    })
  }

  if (currentStep === 'done') {
    container.querySelector('#imp-go-chat')?.addEventListener('click', () => navigate('/chat'))
  }
}

async function doImport(raw: string, container: HTMLElement) {
  currentStep = 'building'
  // Optimistic render so it feels instant
  try {
    const result = await imports.paste(raw)
    importedCount = result.count
  } catch {
    importedCount = 0
  }
  render(container)

  const progressMsgs = [
    'Reading your patterns…',
    'Catching your slang…',
    'Mapping your humor…',
    'Learning your pacing…',
    'Locking in your voice…',
  ]
  let i = 0
  const tick = setInterval(() => {
    const el = document.querySelector<HTMLElement>('#build-progress-msg')
    if (el && progressMsgs[i]) el.textContent = progressMsgs[i++]
  }, 1800)

  try {
    await ai.buildProfile()
    clearInterval(tick)
    currentStep = 'done'
    render(container)
  } catch (err) {
    clearInterval(tick)
    showToast(isApiError(err) ? err.message : 'Failed to build profile — try more text', 'error')
    currentStep = 'import'
    render(container)
  }
}

function injectImportStyles() {
  if (document.getElementById('import-styles')) return
  const style = document.createElement('style')
  style.id = 'import-styles'
  style.textContent = `
    .import-page { background: var(--c-bg); display: flex; flex-direction: column; height: 100vh; }

    .import-main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--sp-6) var(--sp-6) var(--sp-8);
    }

    /* ── Dump box ─── */
    .dump-wrap {
      width: 100%;
      max-width: 680px;
      display: flex;
      flex-direction: column;
      gap: var(--sp-5);
    }

    .dump-heading { text-align: center; }

    .dump-title {
      font-size: clamp(36px, 6vw, 64px);
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 1.0;
      margin-bottom: var(--sp-3);
    }

    .dump-sub {
      font-size: var(--t-md);
      color: var(--c-text-2);
      line-height: 1.6;
    }

    .dump-box-wrap {
      background: var(--c-glass);
      backdrop-filter: var(--blur-md);
      -webkit-backdrop-filter: var(--blur-md);
      border: var(--glass-border);
      border-radius: var(--r-xl);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      position: relative;
    }
    .dump-box-wrap::before {
      content: '';
      position: absolute;
      inset: 0;
      background: var(--specular);
      pointer-events: none;
      z-index: 0;
    }

    .dump-area {
      position: relative;
      z-index: 1;
      display: block;
      width: 100%;
      min-height: 280px;
      max-height: 52vh;
      padding: var(--sp-6) var(--sp-6) var(--sp-3);
      background: transparent;
      border: none;
      outline: none;
      resize: none;
      font-size: var(--t-base);
      line-height: 1.7;
      color: var(--c-text);
      font-family: var(--font);
      overflow-y: auto;
    }
    .dump-area::placeholder {
      color: var(--c-text-3);
      font-size: var(--t-md);
    }

    .dump-meta {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: var(--sp-3) var(--sp-4) var(--sp-4);
      border-top: var(--glass-border);
    }

    .dump-count {
      font-size: var(--t-sm);
      color: var(--c-text-3);
      font-variant-numeric: tabular-nums;
    }

    .dump-btn {
      min-width: 160px;
    }

    .dump-hint {
      text-align: center;
      font-size: var(--t-sm);
      color: var(--c-text-3);
      line-height: 1.6;
    }

    /* ── Building ─── */
    .building-wrap {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-4);
    }
    .building-dots { justify-content: center; }
    .building-title {
      font-size: var(--t-xl);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .building-sub { line-height: 1.6; }
    .building-progress {
      font-size: var(--t-sm);
      color: var(--c-text-3);
      min-height: 20px;
      transition: opacity var(--dur-mid);
    }

    /* ── Done ─── */
    .done-wrap {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-4);
    }
    .done-glyph { font-size: 56px; }
    .done-title {
      font-size: var(--t-xl);
      font-weight: 900;
      letter-spacing: -0.03em;
    }
    .done-sub { line-height: 1.6; }

    @media (max-width: 600px) {
      .dump-title { font-size: 32px; }
      .dump-area { min-height: 200px; }
      .dump-sub { font-size: var(--t-base); }
    }
  `
  document.head.appendChild(style)
}
