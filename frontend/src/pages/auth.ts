import { navigate, getHash } from '../router.js'
import { auth, isApiError } from '../api.js'
import { showToast } from '../main.js'

export function mountAuth(container: HTMLElement) {
  const isSignup = getHash().includes('signup') || window.location.hash.includes('signup')
  let mode: 'login' | 'signup' = isSignup ? 'signup' : 'login'

  function render() {
    container.innerHTML = `
      <div class="page page-center auth-page">
        <div class="auth-card glass-card fade-up">
          <div class="auth-logo">rllyu<span style="color:var(--c-text-3)">.</span></div>
          <div class="auth-tabs">
            <button class="auth-tab ${mode === 'login' ? 'active' : ''}" data-mode="login">Log in</button>
            <button class="auth-tab ${mode === 'signup' ? 'active' : ''}" data-mode="signup">Sign up</button>
          </div>

          <form class="auth-form" id="auth-form" autocomplete="on">
            <div class="auth-field">
              <label class="auth-label">Email</label>
              <input
                class="input"
                type="email"
                id="auth-email"
                name="email"
                autocomplete="email"
                placeholder="you@example.com"
                required
              />
            </div>
            <div class="auth-field">
              <label class="auth-label">Password</label>
              <input
                class="input"
                type="password"
                id="auth-password"
                name="password"
                autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"
                placeholder="${mode === 'signup' ? 'at least 6 characters' : '••••••••'}"
                required
              />
            </div>

            <div id="auth-error" class="auth-error hidden"></div>

            <button class="btn btn-primary w-full" type="submit" id="auth-submit">
              ${mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p class="auth-footer text-dim text-sm">
            ${mode === 'signup'
              ? 'By signing up you agree to our terms. It\'s free to start.'
              : 'Forgot your password? Reset via email — coming soon.'}
          </p>

          <button class="btn btn-ghost auth-back" onclick="window.location.hash='/'">← Back</button>
        </div>
      </div>
    `

    // Tab switching (re-renders form)
    container.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        mode = tab.getAttribute('data-mode') as 'login' | 'signup'
        render()
      })
    })

    // Form submit
    const form = container.querySelector<HTMLFormElement>('#auth-form')!
    const errEl = container.querySelector<HTMLElement>('#auth-error')!
    const submitBtn = container.querySelector<HTMLButtonElement>('#auth-submit')!

    form.addEventListener('submit', async e => {
      e.preventDefault()
      const email = (container.querySelector<HTMLInputElement>('#auth-email')!).value.trim()
      const password = (container.querySelector<HTMLInputElement>('#auth-password')!).value

      errEl.classList.add('hidden')
      errEl.textContent = ''
      submitBtn.disabled = true
      submitBtn.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…'

      try {
        if (mode === 'signup') {
          await auth.signup(email, password)
          showToast('Account created. Let\'s build your clone.')
          navigate('/import')
        } else {
          const user = await auth.login(email, password)
          showToast(`Welcome back.`)
          // Decide where to send them
          navigate(user.cloneReplyCount > 0 ? '/chat' : '/import')
        }
      } catch (err) {
        const msg = isApiError(err) ? err.message : 'Something went wrong'
        errEl.textContent = msg
        errEl.classList.remove('hidden')
        submitBtn.disabled = false
        submitBtn.textContent = mode === 'signup' ? 'Create account' : 'Sign in'
      }
    })

    // Autofocus email
    setTimeout(() => container.querySelector<HTMLInputElement>('#auth-email')?.focus(), 50)
  }

  render()
  injectAuthStyles()
}

function injectAuthStyles() {
  if (document.getElementById('auth-styles')) return
  const style = document.createElement('style')
  style.id = 'auth-styles'
  style.textContent = `
    .auth-page { background: var(--c-bg); }

    .auth-card {
      width: 100%;
      max-width: 420px;
      padding: var(--sp-8);
    }

    .auth-logo {
      font-size: var(--t-xl);
      font-weight: 900;
      letter-spacing: -0.04em;
      margin-bottom: var(--sp-6);
      text-align: center;
    }

    .auth-tabs {
      display: flex;
      background: var(--c-surface);
      border-radius: var(--r-pill);
      padding: 4px;
      margin-bottom: var(--sp-6);
    }
    .auth-tab {
      flex: 1;
      padding: 8px;
      border-radius: var(--r-pill);
      font-size: var(--t-sm);
      font-weight: 500;
      color: var(--c-text-2);
      transition: all var(--dur-fast) var(--ease);
    }
    .auth-tab.active {
      background: var(--c-glass-strong);
      color: var(--c-text);
    }

    .auth-form { display: flex; flex-direction: column; gap: var(--sp-4); }

    .auth-field { display: flex; flex-direction: column; gap: var(--sp-2); }

    .auth-label {
      font-size: var(--t-sm);
      font-weight: 500;
      color: var(--c-text-2);
    }

    .auth-error {
      background: rgba(255,80,80,.12);
      border: 1px solid rgba(255,80,80,.25);
      border-radius: var(--r-sm);
      padding: 10px 14px;
      font-size: var(--t-sm);
      color: rgba(255,160,160,1);
    }
    .auth-error.hidden { display: none; }

    .auth-footer {
      text-align: center;
      margin-top: var(--sp-4);
    }

    .auth-back {
      display: block;
      margin: var(--sp-3) auto 0;
      font-size: var(--t-sm);
    }
  `
  document.head.appendChild(style)
}
