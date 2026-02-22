import { navigate } from '../router.js'
import { auth } from '../api.js'

export async function mountLanding(container: HTMLElement) {
  // If already logged in, redirect to chat
  try {
    const me = await auth.me()
    if (me) {
      navigate(me.hasProfile ? '/chat' : '/import')
      return
    }
  } catch { /* not logged in */ }

  container.innerHTML = `
    <div class="landing-page page">
      <!-- Nav -->
      <nav class="nav">
        <div class="nav-logo">rllyu<span>.</span></div>
        <div class="flex gap-3">
          <button class="btn btn-ghost" id="l-login">Log in</button>
          <button class="btn btn-primary btn-sm" id="l-signup">Get started</button>
        </div>
      </nav>

      <!-- Hero -->
      <main class="landing-hero page-center">
        <div class="hero-content fade-up">
          <div class="hero-tag">texts → clone → conversation</div>
          <h1 class="hero-title">
            Talk to a clone<br>of yourself.
          </h1>
          <p class="hero-sub">
            Paste your texts. We build a model of your voice.<br>
            Then you meet yourself. Free, forever.
          </p>
          <div class="hero-cta-group">
            <button class="btn btn-primary btn-lg" id="l-start">
              Build my clone →
            </button>
            <button class="btn btn-glass" id="l-demo">
              Try a real clone first
            </button>
            <span class="hero-disclaimer">free · no app · takes 60 seconds</span>
          </div>

          <!-- Preview bubble cluster -->
          <div class="hero-bubbles" aria-hidden="true">
            <div class="preview-bubble clone-bubble">yo did you ever text back sarah lol</div>
            <div class="preview-bubble user-bubble">wait what</div>
            <div class="preview-bubble clone-bubble">exactly what i thought. classic you.</div>
          </div>
        </div>
      </main>

      <!-- Features strip -->
      <section class="features-strip">
        <div class="feature-item glass-card">
          <div class="feature-icon">💬</div>
          <div class="feature-label">Paste anything — texts, DMs, notes</div>
        </div>
        <div class="feature-item glass-card">
          <div class="feature-icon">🧬</div>
          <div class="feature-label">We learn your exact voice</div>
        </div>
        <div class="feature-item glass-card">
          <div class="feature-icon">🔮</div>
          <div class="feature-label">Chat with your clone</div>
        </div>
      </section>

      <footer class="landing-footer">
        <span class="text-dim text-sm">rllyU · built different · 2025</span>
        <span class="text-dim text-xs" style="margin-top:6px;display:block;opacity:0.4;letter-spacing:0.08em;text-transform:uppercase">a paradime technology production</span>
      </footer>
    </div>
  `

  container.querySelector('#l-login')!.addEventListener('click', () => navigate('/auth'))
  container.querySelector('#l-signup')!.addEventListener('click', () => navigate('/auth?mode=signup'))
  container.querySelector('#l-start')!.addEventListener('click', () => navigate('/auth?mode=signup'))
  container.querySelector('#l-demo')!.addEventListener('click', () => navigate('/demo'))

  injectLandingStyles()
}

function injectLandingStyles() {
  if (document.getElementById('landing-styles')) return
  const style = document.createElement('style')
  style.id = 'landing-styles'
  style.textContent = `
    .landing-page { background: var(--c-bg); }

    .landing-hero { padding: var(--sp-10) var(--sp-6); }

    .hero-content {
      max-width: 640px;
      text-align: center;
    }

    .hero-tag {
      display: inline-block;
      background: var(--c-glass);
      border: var(--glass-border);
      border-radius: var(--r-pill);
      padding: 6px 14px;
      font-size: var(--t-sm);
      color: var(--c-text-2);
      letter-spacing: 0.04em;
      text-transform: uppercase;
      margin-bottom: var(--sp-6);
    }

    .hero-title {
      font-size: clamp(48px, 8vw, 88px);
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 1.0;
      color: var(--c-text);
      margin-bottom: var(--sp-5);
    }

    .hero-sub {
      font-size: var(--t-md);
      color: var(--c-text-2);
      line-height: 1.6;
      margin-bottom: var(--sp-8);
    }

    .hero-cta-group {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--sp-3);
      margin-bottom: var(--sp-10);
    }

    .hero-disclaimer {
      font-size: var(--t-xs);
      color: var(--c-text-3);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    /* Preview bubbles */
    .hero-bubbles {
      display: flex;
      flex-direction: column;
      gap: var(--sp-2);
      max-width: 360px;
      margin: 0 auto;
    }
    .preview-bubble {
      padding: 10px 16px;
      border-radius: 18px;
      font-size: var(--t-sm);
      max-width: 80%;
      line-height: 1.5;
      animation: fade-up var(--dur-slow) var(--ease) both;
    }
    .clone-bubble {
      background: var(--c-bubble-clone);
      border: var(--glass-border);
      border-radius: var(--r-bubble-clone);
      align-self: flex-start;
      color: var(--c-text);
      animation-delay: 0.3s;
    }
    .user-bubble {
      background: var(--c-bubble-user);
      border-radius: var(--r-bubble-user);
      align-self: flex-end;
      color: var(--c-text-inv);
      animation-delay: 0.5s;
    }
    .preview-bubble:nth-child(3) { animation-delay: 0.7s; }

    /* Features */
    .features-strip {
      display: flex;
      justify-content: center;
      gap: var(--sp-4);
      padding: var(--sp-8) var(--sp-6);
      flex-wrap: wrap;
    }
    .feature-item {
      display: flex;
      align-items: center;
      gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-5);
    }
    .feature-icon { font-size: 20px; }
    .feature-label { font-size: var(--t-sm); color: var(--c-text-2); }

    .landing-footer {
      text-align: center;
      padding: var(--sp-6);
      border-top: var(--glass-border);
    }

    @media (max-width: 600px) {
      .hero-title { font-size: 40px; }
      .feature-item { width: 100%; }
    }
  `
  document.head.appendChild(style)
}
