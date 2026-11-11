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

test('district data is saved in the browser and survives a reload', async ({ page }) => {
  await page.goto('./')

  await expect(page.getByRole('checkbox')).toHaveCount(18)
  await expect(page.getByText('0 of 18')).toBeVisible()
  await expect(page.getByText('nothing yet')).toBeVisible()

  await page.getByRole('checkbox', { name: 'Praga-Południe' }).check()
  await page.getByRole('checkbox', { name: 'Żoliborz' }).check()
  await expect(page.getByText('2 of 18')).toBeVisible()
  // A tick shows at once and is written a moment later; wait for the write.
  await expect(page.getByRole('status')).toHaveText('Everything is saved')

  await page.reload()

  await expect(page.getByText('2 of 18')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Praga-Południe' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Żoliborz' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Bemowo' })).not.toBeChecked()
  await expect(page.getByText('nothing yet')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Żoliborz' }).uncheck()
  await expect(page.getByRole('status')).toHaveText('Everything is saved')
  await page.reload()
  await expect(page.getByText('1 of 18')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Żoliborz' })).not.toBeChecked()
})
