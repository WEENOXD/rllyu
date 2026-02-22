/** Paywall modal — shown when free reply limit is hit */

let modalEl: HTMLElement | null = null

export function showPaywall(onDismiss?: () => void) {
  if (modalEl) return

  const root = document.getElementById('modal-root')!

  modalEl = document.createElement('div')
  modalEl.className = 'paywall-backdrop fade-in'
  modalEl.innerHTML = `
    <div class="paywall-modal glass-card fade-up">
      <div class="paywall-emoji">🔮</div>
      <h2 class="paywall-title">You built it.<br>Don't stop now.</h2>
      <p class="paywall-sub">
        You've used your 5 free replies.<br>
        Unlock unlimited access to your clone.
      </p>
      <div class="paywall-features">
        <div class="paywall-feature">✦ Unlimited clone replies</div>
        <div class="paywall-feature">✦ Mode toggles (Raw / Soft / Cold)</div>
        <div class="paywall-feature">✦ Multi-session memory</div>
        <div class="paywall-feature">✦ Fine-tune your clone over time</div>
      </div>
      <button class="btn btn-primary btn-lg w-full paywall-cta">Unlock rllyU</button>
      <button class="btn btn-ghost w-full paywall-dismiss">Maybe later</button>
    </div>
  `

  root.appendChild(modalEl)

  // CTA — placeholder for Stripe
  modalEl.querySelector('.paywall-cta')!.addEventListener('click', () => {
    showToast('Stripe checkout coming soon — stay tuned 🔥')
  })

  // Dismiss
  modalEl.querySelector('.paywall-dismiss')!.addEventListener('click', () => {
    hidePaywall()
    onDismiss?.()
  })

  // Backdrop click
  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) { hidePaywall(); onDismiss?.() }
  })
}

export function hidePaywall() {
  modalEl?.remove()
  modalEl = null
}

// ── Blurred paywall bubble ────────────────────────────────────────────────────
export function createPaywallBubble(partialText: string): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'bubble bubble-clone paywall-bubble-wrap'
  wrap.innerHTML = `
    <div class="paywall-bubble-text">${escHtml(partialText)}…</div>
    <div class="paywall-bubble-blur"></div>
    <button class="paywall-bubble-btn btn btn-primary btn-sm">Unlock to continue</button>
  `
  wrap.querySelector('.paywall-bubble-btn')!.addEventListener('click', () => showPaywall())
  return wrap
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// Import toast for CTA
import { showToast } from '../main.js'
