/** Slide-in drawer for adding more text without leaving chat */

import { imports, ai } from '../api.js'
import { showToast } from '../main.js'

type OnImportDone = (count: number) => void

let drawerEl: HTMLElement | null = null
let backdropEl: HTMLElement | null = null

export function openImportDrawer(onDone?: OnImportDone) {
  if (drawerEl) return

  backdropEl = document.createElement('div')
  backdropEl.className = 'drawer-backdrop fade-in'
  backdropEl.addEventListener('click', closeImportDrawer)
  document.body.appendChild(backdropEl)

  drawerEl = document.createElement('div')
  drawerEl.className = 'import-drawer glass-card'
  drawerEl.innerHTML = `
    <div class="drawer-header">
      <span class="drawer-title">Add more memories</span>
      <button class="btn btn-icon btn-ghost drawer-close">✕</button>
    </div>

    <p class="text-sm text-muted" style="line-height:1.6">
      Paste anything—notes, captions, DMs, texts.<br>
      More input = sharper clone. We'll rebuild your profile automatically.
    </p>

    <textarea
      id="drawer-dump"
      class="input drawer-dump"
      placeholder="Paste anything here…"
      spellcheck="false"
      autocorrect="off"
    ></textarea>

    <div style="display:flex;align-items:center;justify-content:space-between">
      <span id="drawer-word-count" class="text-xs text-dim">—</span>
      <button class="btn btn-primary" id="drawer-submit-btn" disabled>Add memories</button>
    </div>

    <div id="drawer-status" class="text-sm text-muted" style="text-align:center;min-height:18px"></div>
  `

  document.body.appendChild(drawerEl)
  requestAnimationFrame(() => drawerEl?.classList.add('open'))

  drawerEl.querySelector('.drawer-close')!.addEventListener('click', closeImportDrawer)

  const area = drawerEl.querySelector<HTMLTextAreaElement>('#drawer-dump')!
  const countEl = drawerEl.querySelector<HTMLElement>('#drawer-word-count')!
  const submitBtn = drawerEl.querySelector<HTMLButtonElement>('#drawer-submit-btn')!
  const status = drawerEl.querySelector<HTMLElement>('#drawer-status')!

  area.addEventListener('input', () => {
    const words = area.value.trim() ? area.value.trim().split(/\s+/).length : 0
    countEl.textContent = words ? `${words.toLocaleString()} words` : '—'
    submitBtn.disabled = area.value.trim().length < 20
  })

  setTimeout(() => area.focus(), 100)

  submitBtn.addEventListener('click', async () => {
    const raw = area.value.trim()
    if (!raw) return

    submitBtn.disabled = true
    status.textContent = 'Importing…'

    try {
      const result = await imports.paste(raw)

      status.textContent = 'Rebuilding your clone…'
      await ai.buildProfile()

      showToast(`✓ ${result.message} — clone updated`)
      onDone?.(result.count)
      setTimeout(closeImportDrawer, 900)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Something went wrong'
      status.textContent = msg
      showToast(msg, 'error')
      submitBtn.disabled = false
    }
  })
}

export function closeImportDrawer() {
  drawerEl?.classList.remove('open')
  backdropEl?.classList.add('fade-out')
  setTimeout(() => {
    drawerEl?.remove()
    backdropEl?.remove()
    drawerEl = null
    backdropEl = null
  }, 300)
}
