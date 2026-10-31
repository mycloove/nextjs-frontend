import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import ts from 'typescript'

// Run separately with: node --test tests/auth/admin-signout.ui.mjs
// Render the real frame/toast with React in Chromium. Every HTTP request and
// Supabase call is intercepted; no running app, credentials or live DB is used.
const origin = 'https://auth.example.test'
const root = fileURLToPath(new URL('../../', import.meta.url))
const sources = Object.fromEntries(['AdminFrame', 'BenchToast', 'BenchIcon'].map((name) => [
  `./${name}`,
  ts.transpileModule(readFileSync(resolve(root, `app/admin/${name}.tsx`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText,
]))
const css = readFileSync(resolve(root, 'app/admin/bench.module.css'), 'utf8').replace(/:global\(([^)]+)\)/g, '$1')
let browser
before(async () => { browser = await chromium.launch({ headless: true }) })
after(async () => { await browser?.close() })

async function frame(t, { theme = 'dark', width = 1440, beforeLogout } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  const state = { status: 200, abort: false, providerFailure: null, providerCalls: 0, logouts: [], pageErrors: [] }
  page.on('pageerror', (error) => state.pageErrors.push(error.message))
  t.after(async () => {
    await context.close()
    assert.deepEqual(state.pageErrors, [])
  })
  await context.addCookies([
    { name: 'smilepdf_auth', value: 'synthetic-custom-session', url: origin, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'sb-test-auth-token', value: 'synthetic-provider-session', url: origin, secure: true, sameSite: 'Lax' },
  ])
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname === '/api/auth/logout') {
      state.logouts.push({ method: request.method(), cookie: request.headers().cookie })
      await beforeLogout?.()
      if (state.abort) return route.abort()
      return route.fulfill({
        status: state.status,
        contentType: 'application/json',
        headers: state.status === 200 ? { 'Set-Cookie': 'smilepdf_auth=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax' } : {},
        body: JSON.stringify({ ok: state.status === 200 }),
      })
    }
    if (url.pathname === '/admin' || url.pathname === '/login') {
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html data-theme="${theme}"><head><style>body{margin:0}${css}</style></head><body><div id="root">${url.pathname === '/login' ? 'Log in' : ''}</div></body></html>` })
    }
    return route.fulfill({ status: 204, body: '' })
  })
  await page.exposeFunction('providerSignOut', async () => {
    state.providerCalls += 1
    if (state.providerFailure === 'throw') throw new Error('Synthetic provider outage')
    return { error: state.providerFailure ? { message: 'Synthetic provider refusal' } : null, localCleared: state.providerFailure === 'cleared' }
  })
  await page.goto(`${origin}/admin`)
  await page.addScriptTag({ path: resolve(root, 'node_modules/react/umd/react.development.js') })
  await page.addScriptTag({ path: resolve(root, 'node_modules/react-dom/umd/react-dom.development.js') })
  await page.evaluate((code) => {
    const { React, ReactDOM } = window
    const mocks = {
      react: React,
      'next/navigation': { usePathname: () => '/admin', useRouter: () => ({ refresh() {}, replace() { throw new Error('Logout must discard the cached router tree') } }) },
      'next/link': (props) => React.createElement('a', props),
      'next/image': (props) => React.createElement('img', props),
      '@/components/KineticSphere': () => null,
      '@/lib/supabase/client': { createClient: () => ({ auth: { signOut: async () => {
        const result = await window.providerSignOut()
        if (!result.error || result.localCleared) document.cookie = 'sb-test-auth-token=; Max-Age=0; Path=/; Secure; SameSite=Lax'
        return result
      } } }) },
      './bench.module.css': { __esModule: true, default: new Proxy({}, { get: (_, name) => name }) },
    }
    const modules = new Map()
    function load(name) {
      if (name in mocks) return mocks[name]
      if (modules.has(name)) return modules.get(name).exports
      if (!(name in code)) throw new Error(`Unexpected UI test dependency: ${name}`)
      const entry = { exports: {} }
      modules.set(name, entry)
      new Function('require', 'module', 'exports', 'React', code[name])(load, entry, entry.exports, React)
      return entry.exports
    }
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(load('./AdminFrame').default, {
      email: 'owner@example.test', role: 'Owner',
    }, React.createElement('main', null, 'Admin content')))
  }, sources)
  const button = page.getByRole('button', { name: 'Sign out of the bench' })
  await expect(button).toBeEnabled()
  return { context, page, button, state }
}

test('successful admin sign-out clears both cookies before a fresh login navigation', async (t) => {
  const { context, page, button, state } = await frame(t)
  await button.click()
  await page.waitForURL(`${origin}/login`)
  assert.equal(state.logouts.length, 1)
  assert.equal(state.logouts[0].method, 'POST')
  assert.match(state.logouts[0].cookie, /smilepdf_auth=synthetic-custom-session/)
  assert.equal(state.providerCalls, 1)
  assert.deepEqual((await context.cookies()).map((cookie) => cookie.name), [])
})

for (const theme of ['dark', 'light']) {
  for (const width of [1440, 390]) {
    test(`logout rejection is visible, keyboard-dismissible and retryable (${theme}, ${width}px)`, async (t) => {
      const { page, button, state } = await frame(t, { theme, width })
      state.status = 503
      await button.click()
      const notice = page.getByRole('status')
      await expect(notice).toContainText('Sign-out did not finish. Check your connection and try again.')
      await expect(button).toBeEnabled()
      assert.equal(page.url(), `${origin}/admin`)
      assert.equal(state.providerCalls, 0)
      const box = await notice.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 900)
      if (process.env.AUTH_UI_SCREENSHOT_DIR) {
        await page.screenshot({ path: resolve(process.env.AUTH_UI_SCREENSHOT_DIR, `admin-logout-${theme}-${width}.png`) })
      }
      const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true })
      await dismiss.focus()
      await page.keyboard.press('Enter')
      await expect(notice).toHaveCount(0)
      state.status = 200
      await button.click()
      await page.waitForURL(`${origin}/login`)
    })
  }
}

for (const failure of ['network', 'provider error', 'provider throw', 'provider error after local clear']) {
  test(`${failure} cannot claim logout success and permits retry`, async (t) => {
    const { context, page, button, state } = await frame(t)
    state.abort = failure === 'network'
    state.providerFailure = failure === 'provider error after local clear' ? 'cleared'
      : failure === 'provider error' ? 'error' : failure === 'provider throw' ? 'throw' : null
    await button.click()
    await expect(page.getByRole('status')).toContainText('Sign-out did not finish.')
    await expect(button).toBeEnabled()
    assert.equal(page.url(), `${origin}/admin`)
    assert.equal((await context.cookies()).some((cookie) => cookie.name === 'sb-test-auth-token'), failure !== 'provider error after local clear')
    state.abort = false
    state.providerFailure = null
    await button.click()
    await page.waitForURL(`${origin}/login`)
    assert.deepEqual((await context.cookies()).map((cookie) => cookie.name), [])
  })
}

test('repeated sign-out clicks cannot start duplicate logout requests', async (t) => {
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const { page, button, state } = await frame(t, { beforeLogout: () => pending })
  t.after(() => release())
  await Promise.all([
    page.waitForRequest(`${origin}/api/auth/logout`),
    button.evaluate((element) => { element.click(); element.click() }),
  ])
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  assert.equal(state.logouts.length, 1)
  release()
  await page.waitForURL(`${origin}/login`)
  assert.equal(state.logouts.length, 1)
  assert.equal(state.providerCalls, 1)
})
