import { expect, test } from './fixtures.ts'

test('the app opens under the Pages sub-path on a phone screen', async ({ page }) => {
  const failed: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`)
  })
  page.on('requestfailed', (request) => failed.push(`failed ${request.url()}`))

  await page.goto('./')

  // Chrome on a Polish phone would offer to translate the English page, which
  // sends its text away and breaks the screens it rewrites.
  await expect(page.locator('html')).toHaveAttribute('translate', 'no')

  await expect(page.getByRole('heading', { level: 1, name: 'Districts' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('list').getByRole('link')).toHaveCount(18)

  await page.getByRole('link', { name: 'Praga-Południe Not done', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Praga-Południe' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: 'Done' })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expect(page.getByText(/^Build /)).toBeVisible()

  // Leaves a quiet half second, so a request made just after a screen is drawn is seen.
  await page.waitForLoadState('networkidle')
  // Every file comes from under the app's own path: a build that ignored the
  // sub-path would ask for /assets/... at the site root, which Pages cannot
  // serve. Such a request also counts as one to somewhere else, which the
  // shared `test` refuses in every test, this one included.
  expect(failed).toEqual([])
})
