import { expect, test } from '@playwright/test'

test('the app opens under the Pages sub-path on a phone screen', async ({ page, baseURL }) => {
  const appUrl = baseURL ?? ''
  const outside: string[] = []
  const failed: string[] = []
  page.on('request', (request) => {
    const isNetwork = /^https?:/.test(request.url())
    if (isNetwork && !request.url().startsWith(appUrl)) outside.push(request.url())
  })
  page.on('websocket', (socket) => outside.push(socket.url()))
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', (request) => failed.push(`failed ${request.url()}`))

  await page.goto('./')

  await expect(page.getByRole('heading', { level: 1, name: 'Pinezka' })).toBeVisible()
  await expect(page.getByText(/^Build /)).toBeVisible()

  // Leaves a quiet half second, so a request made just after first render is seen.
  await page.waitForLoadState('networkidle')
  // Every file comes from under the app's own path: a build that ignored the
  // sub-path would ask for /assets/... at the site root, which Pages cannot serve.
  // This also covers the fixed constraint of no requests to anywhere else,
  // for the start screen while it loads.
  expect(outside).toEqual([])
  expect(failed).toEqual([])
})
