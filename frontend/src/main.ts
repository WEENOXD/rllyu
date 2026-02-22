import './styles/global.css'
import { addRoute, startRouter } from './router.js'
import { mountLanding } from './pages/landing.js'
import { mountAuth } from './pages/auth.js'
import { mountImport } from './pages/import.js'
import { mountChat } from './pages/chat.js'

// ── Toast system (exported for components) ────────────────────────────────────
let toastContainer: HTMLElement | null = null

function ensureToastContainer() {
  if (toastContainer) return toastContainer
  toastContainer = document.createElement('div')
  toastContainer.id = 'toast-container'
  document.body.appendChild(toastContainer)
  return toastContainer
}

export function showToast(message: string, type: 'default' | 'error' = 'default', duration = 3000) {
  const container = ensureToastContainer()
  const toast = document.createElement('div')
  toast.className = `toast${type === 'error' ? ' error' : ''}`
  toast.textContent = message
  container.appendChild(toast)
  setTimeout(() => {
    toast.style.opacity = '0'
    toast.style.transition = 'opacity 0.3s'
    setTimeout(() => toast.remove(), 300)
  }, duration)
}

// ── Routes ─────────────────────────────────────────────────────────────────────
addRoute('/', mountLanding)
addRoute('/auth', mountAuth)
addRoute('/import', mountImport)
addRoute('/chat', mountChat)

// ── Start ──────────────────────────────────────────────────────────────────────
startRouter()
