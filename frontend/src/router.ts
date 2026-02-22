/** Minimal hash-based SPA router */

type Route = {
  pattern: RegExp
  mount: (container: HTMLElement, params: Record<string, string>) => Promise<void> | void
  cleanup?: () => void
}

let currentCleanup: (() => void) | undefined

const routes: Route[] = []

export function addRoute(
  path: string | RegExp,
  mount: (container: HTMLElement, params: Record<string, string>) => Promise<void> | void,
  cleanup?: () => void,
) {
  const pattern =
    typeof path === 'string'
      ? new RegExp(
          '^' +
            path.replace(/:[^/]+/g, '([^/]+)').replace(/\//g, '\\/') +
            '(?:\\?.*)?$',
        )
      : path

  routes.push({ pattern, mount, cleanup })
}

export function navigate(path: string) {
  window.location.hash = path
}

export function getHash(): string {
  return window.location.hash.slice(1) || '/'
}

async function handleRoute() {
  // Run cleanup for previous page
  if (currentCleanup) {
    currentCleanup()
    currentCleanup = undefined
  }

  const hash = getHash()
  const container = document.getElementById('app')!
  container.innerHTML = ''

  for (const route of routes) {
    const match = hash.match(route.pattern)
    if (match) {
      // Named params: extract from hash using regex groups
      const paramNames = (
        typeof route.pattern === 'string'
          ? route.pattern
          : route.pattern.source
      )
        .match(/\([^)]+\)/g)
        ?.map((_, i) => `p${i}`) ?? []

      const params: Record<string, string> = {}
      match.slice(1).forEach((val, i) => {
        if (paramNames[i]) params[paramNames[i]] = val
      })

      await route.mount(container, params)
      if (route.cleanup) currentCleanup = route.cleanup
      return
    }
  }

  // 404 fallback
  container.innerHTML = `
    <div class="page page-center">
      <div style="text-align:center">
        <div style="font-size:var(--t-3xl);font-weight:900;opacity:.15">404</div>
        <p class="text-muted mt-4">Page not found.</p>
        <button class="btn btn-glass mt-6" onclick="window.location.hash='/'">Go home</button>
      </div>
    </div>`
}

export function startRouter() {
  window.addEventListener('hashchange', handleRoute)
  handleRoute()
}
