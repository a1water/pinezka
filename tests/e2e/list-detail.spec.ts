// These tests hand functions to the page to run there, so they need the
// browser's types as well as Node's.
/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test'
import { expect, test } from './fixtures.ts'

// Every test starts with empty storage: Playwright gives each one a browser
// profile of its own.

const heading = (page: Page) => page.getByRole('heading', { level: 1 })
const cards = (page: Page) => page.getByRole('main').getByRole('list').getByRole('link')
/** One card, by everything a screen reader says for it: "Mokotów Not done", "Mokotów Done 12 Oct 2026". */
const card = (page: Page, name: string) => page.getByRole('link', { name, exact: true })
const tab = (page: Page, name: string) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name })
const filter = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Show' }).getByRole('button', { name, exact: true })
const backButton = (page: Page) => page.getByRole('button', { name: 'Back to Districts' })
const doneTick = (page: Page) => page.getByRole('checkbox', { name: 'Done', exact: true })
const dateField = (page: Page) => page.getByLabel('Date', { exact: true })
const distanceField = (page: Page) => page.getByRole('textbox', { name: 'Distance in km' })
const linkField = (page: Page) => page.getByRole('textbox', { name: 'Strava link' })
const notesField = (page: Page) => page.getByRole('textbox', { name: 'Notes' })
/** The word beside the place name that says how saving went. */
const saveStatus = (page: Page) => page.getByTestId('save-status')
/** The visible explanation of a failed save, with its buttons. */
const banner = (page: Page) => page.getByRole('region', { name: 'Not saved' })
/** What a screen reader is told about a failed save. Always on the page; empty when nothing failed. */
const saveAlert = (page: Page) => page.getByRole('alert')

/** The three figures of the list's header, each matched as a whole so "1 of 18" never passes for "11 of 18". */
async function expectTotals(page: Page, done: number, left: string, km: string) {
  const totals = page.getByRole('region', { name: 'Progress' })
  await expect(totals.getByText(`${done} of 18 done`, { exact: true })).toBeVisible()
  await expect(totals.getByText(left, { exact: true })).toBeVisible()
  await expect(totals.getByText(km, { exact: true })).toBeVisible()
}

async function openDistrict(page: Page, cardName: string, name: string) {
  await card(page, cardName).click()
  await expect(heading(page)).toHaveText(name)
}

const scrollY = (page: Page) => page.evaluate(() => window.scrollY)

async function expectScrolledTo(page: Page, y: number) {
  // Within a few px: the phone profile's pixel ratio makes scroll positions fractional.
  await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(2)
}

const journalKeys = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('pinezka:unsaved-edits:')).length)

/** Makes every write of a record fail like a full disk for as long as `window.__failSaves` is true. */
async function allowFailingSaves(page: Page) {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if ((window as { __failSaves?: boolean }).__failSaves) throw new DOMException('', 'QuotaExceededError')
      return put.apply(this, args)
    }
  })
}

const failSaves = (page: Page, fail: boolean) =>
  page.evaluate((value) => {
    ;(window as { __failSaves?: boolean }).__failSaves = value
  }, fail)

/**
 * Keeps every save waiting until `releaseSaves`, by holding a transaction of
 * its own open on all of the app's data. The database must exist by then, so
 * call it only once the app has shown its data.
 */
async function holdSaves(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        // No version: the database is taken as the app made it.
        const request = indexedDB.open('pinezka')
        request.onerror = () => reject(new Error(request.error?.message ?? 'The database did not open'))
        request.onsuccess = () => {
          const db = request.result
          const names = Array.from(db.objectStoreNames)
          const [first] = names
          if (first === undefined) {
            db.close()
            reject(new Error('The app has not made its database yet'))
            return
          }
          const transaction = db.transaction(names, 'readwrite')
          const store = transaction.objectStore(first)
          let held = true
          // A transaction ends by itself when it has nothing left to do, so it
          // is handed one small read after another for as long as it must last.
          const spin = () => {
            if (held) store.count().onsuccess = spin
          }
          spin()
          ;(window as { __releaseSaves?: () => void }).__releaseSaves = () => {
            held = false
          }
          // Closed, so this connection never stands in the way of the app's own.
          transaction.oncomplete = () => db.close()
          resolve()
        }
      }),
  )
}

const releaseSaves = (page: Page) =>
  page.evaluate(() => {
    ;(window as { __releaseSaves?: () => void }).__releaseSaves?.()
  })

/** A note of so many lines, each short enough never to wrap. */
const linesOfNote = (count: number) => Array.from({ length: count }, (_, index) => `Line ${index + 1}`).join('\n')

/** How far the page can scroll at all. */
const scrollRoom = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight)

test('1: a district is ticked, dated and measured, and the list and totals show it', async ({ page }) => {
  await page.goto('./')

  await expectTotals(page, 0, '18 left', '0 km')
  const firstStep = page.getByText('No districts done yet. Tap one to open it, then tick Done.')
  await expect(firstStep).toBeVisible()
  await expect(cards(page)).toHaveCount(18)

  await openDistrict(page, 'Mokotów Not done', 'Mokotów')
  await expect(page).toHaveURL(/#\/warsaw-districts\/mokotow$/)
  await expect(page).toHaveTitle('Mokotów – Pinezka')
  // Nothing was edited on this visit yet, so there is nothing to report.
  await expect(saveStatus(page)).toHaveText('')

  await doneTick(page).check()
  await dateField(page).fill('2026-10-12')
  await distanceField(page).pressSequentially('12,4')
  await distanceField(page).press('Enter')
  await expect(saveStatus(page)).toHaveText('Saved')
  // Left with Enter, the field shows the distance the way it is stored.
  await expect(distanceField(page)).toHaveValue('12.4')

  // The phone's own back button.
  await page.goBack()
  await expect(heading(page)).toHaveText('Districts')
  await expectTotals(page, 1, '17 left', '12.4 km')
  await expect(card(page, 'Mokotów Done 12 Oct 2026')).toBeVisible()
  await expect(firstStep).toHaveCount(0)

  // The card's name only proves that the word is in the page. The badge must
  // also be drawn: of a real size, not cut away, and with nothing lying over it.
  const badge = card(page, 'Mokotów Done 12 Oct 2026').getByText('Done', { exact: true })
  await badge.scrollIntoViewIfNeeded()
  const drawn = await badge.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    return { width: box.width, height: box.height, onTop: top !== null && element.contains(top) }
  })
  expect(drawn.width).toBeGreaterThanOrEqual(16)
  expect(drawn.height).toBeGreaterThanOrEqual(16)
  expect(drawn.onTop).toBe(true)

  await page.reload()
  await expectTotals(page, 1, '17 left', '12.4 km')
  await expect(card(page, 'Mokotów Done 12 Oct 2026')).toBeVisible()
  await expect(cards(page)).toHaveCount(18)

  await openDistrict(page, 'Mokotów Done 12 Oct 2026', 'Mokotów')
  await expect(distanceField(page)).toHaveValue('12.4')
  await expect(dateField(page)).toHaveValue('2026-10-12')
  await expect(doneTick(page)).toBeChecked()
})

test('2: the totals change at once, before the save is confirmed', async ({ page }) => {
  await page.goto('./')
  await openDistrict(page, 'Ochota Not done', 'Ochota')
  // Left alone, a save is confirmed within a few milliseconds, and the totals
  // would be right either way. So no save can finish until it is let through.
  await holdSaves(page)

  await distanceField(page).pressSequentially('7,5')
  // Straight back, without leaving the field and without waiting for "Saved".
  await page.goBack()
  await expectTotals(page, 0, '18 left', '7.5 km')
  // Guards the check itself: the distance was still waiting to be saved just now.
  expect(await journalKeys(page)).toBe(1)

  await releaseSaves(page)
  // Only once the database has the distance does the reload prove it was stored.
  await expect.poll(() => journalKeys(page)).toBe(0)
  await page.reload()
  await expectTotals(page, 0, '18 left', '7.5 km')
})

test('3: a note typed in the instant before a reload is kept', async ({ page }) => {
  await page.goto('./')
  await openDistrict(page, 'Wola Not done', 'Wola')

  await notesField(page).pressSequentially('Windy by the river')
  await page.reload()

  await expect(heading(page)).toHaveText('Wola')
  await expect(notesField(page)).toHaveValue('Windy by the river')

  // The note of unconfirmed edits is cleared once the database has the text,
  // so from then on the text comes from the database alone.
  await expect.poll(() => journalKeys(page)).toBe(0)
  await page.reload()
  await expect(notesField(page)).toHaveValue('Windy by the river')

  await tab(page, 'Districts').click()
  await openDistrict(page, 'Wola Not done', 'Wola')
  await expect(notesField(page)).toHaveValue('Windy by the river')
})

test('4: a distance that is not a number is kept on screen, explained, and never saved', async ({ page }) => {
  await page.goto('./')

  // The beginning of a mistyped entry ("12," on the way to "12,,4") reads as a
  // number. It must not stay saved when the whole text turns out wrong and the
  // screen is left before any error could be shown.
  await openDistrict(page, 'Ursus Not done', 'Ursus')
  await distanceField(page).pressSequentially('12,,4')
  await page.goBack()
  await expectTotals(page, 0, '18 left', '0 km')

  await openDistrict(page, 'Bielany Not done', 'Bielany')
  const distance = distanceField(page)
  const error = page.getByText('Enter the distance as a number, like 12.4 or 12,4.')

  await distance.pressSequentially('12,4')
  await distance.blur()
  await expect(saveStatus(page)).toHaveText('Saved')

  await distance.fill('12,4,5')
  // Nothing is said while the user is still typing.
  await expect(error).toHaveCount(0)
  await distance.blur()

  await expect(distance).toHaveValue('12,4,5')
  await expect(error).toBeVisible()
  await expect(page.getByText('Saved value: 12.4 km.')).toBeVisible()
  await expect(distance).toHaveAttribute('aria-invalid', 'true')
  await expect(distance).toHaveAccessibleDescription(
    'Enter the distance as a number, like 12.4 or 12,4. Saved value: 12.4 km.',
  )
  await expect(saveStatus(page)).toHaveText('Not saved')

  await page.reload()
  await expect(distance).toHaveValue('12.4')
  await expect(distance).not.toHaveAttribute('aria-invalid', 'true')

  // Leaving the screen with the wrong text still in the field, without
  // leaving the field first: what was saved before stays saved.
  await distance.fill('12,4,5')
  await page.goBack()
  await expectTotals(page, 0, '18 left', '12.4 km')
  await page.reload()
  await expectTotals(page, 0, '18 left', '12.4 km')
})

test('5: going back returns to the same place in the list, by all three ways back', async ({ page }) => {
  await page.goto('./')
  await expect(cards(page)).toHaveCount(18)
  const last = card(page, 'Żoliborz Not done')

  // A long note makes the district's own screen taller than the phone. On a
  // screen that cannot scroll, "starts at its top" would hold whatever the app did.
  await last.click()
  await expect(heading(page)).toHaveText('Żoliborz')
  await notesField(page).fill(linesOfNote(60))
  await expect(saveStatus(page)).toHaveText('Saved')
  await page.goBack()
  await expect(heading(page)).toHaveText('Districts')

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const bottom = await scrollY(page)
  expect(bottom).toBeGreaterThan(200)

  // On the list itself, its tab is the way back to the top.
  await tab(page, 'Districts').click()
  await expectScrolledTo(page, 0)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expectScrolledTo(page, bottom)

  // A screen opened from a link starts at its top, with focus on its heading.
  await last.click()
  await expect(heading(page)).toHaveText('Żoliborz')
  // Guards the check itself: this screen could have been left scrolled far down.
  expect(await scrollRoom(page)).toBeGreaterThan(400)
  await expectScrolledTo(page, 0)
  await expect(heading(page)).toBeFocused()
  await page.evaluate(() => window.scrollTo(0, 333))
  await expectScrolledTo(page, 333)

  // The phone's back button.
  await page.goBack()
  await expect(heading(page)).toHaveText('Districts')
  await expectScrolledTo(page, bottom)
  await expect(last).toBeFocused()

  // Forward again: the district is where it was left, not back at its top.
  await page.goForward()
  await expect(heading(page)).toHaveText('Żoliborz')
  await expectScrolledTo(page, 333)
  await page.goBack()
  await expect(heading(page)).toHaveText('Districts')
  await expectScrolledTo(page, bottom)

  // The back button in the top bar.
  await last.click()
  await expect(heading(page)).toHaveText('Żoliborz')
  await backButton(page).click()
  await expect(heading(page)).toHaveText('Districts')
  await expectScrolledTo(page, bottom)
  await expect(last).toBeFocused()
  // Forward leads to the district again, so the button went back in history
  // and did not open a second copy of the list.
  await page.goForward()
  await expect(heading(page)).toHaveText('Żoliborz')
  await expect(page).toHaveURL(/#\/warsaw-districts\/zoliborz$/)

  // The Districts tab, which is the way back within thumb reach.
  await tab(page, 'Districts').click()
  await expect(heading(page)).toHaveText('Districts')
  await expectScrolledTo(page, bottom)
  await expect(last).toBeFocused()
  await page.goForward()
  await expect(heading(page)).toHaveText('Żoliborz')
})

test('6: the filter lives in the address, survives a visit to a district, and is not a step for Back', async ({
  page,
}) => {
  await page.goto('./#/settings')
  await tab(page, 'Districts').click()
  await expect(cards(page)).toHaveCount(18)

  // Nothing is done yet: the filter says so and offers the way out.
  await filter(page, 'Done').click()
  await expect(page).toHaveURL(/#\/warsaw-districts\?show=done$/)
  await expect(page.getByRole('heading', { name: 'Nothing done yet' })).toBeVisible()
  await expect(page.getByText('Open a place from the full list and tick Done.')).toBeVisible()
  await expect(cards(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Show all' }).click()
  await expect(cards(page)).toHaveCount(18)
  await expect(page).toHaveURL(/#\/warsaw-districts$/)
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'true')
  // The button that was tapped is gone; focus moves to the choice it made.
  await expect(filter(page, 'All')).toBeFocused()

  await openDistrict(page, 'Ochota Not done', 'Ochota')
  await doneTick(page).check()
  await expect(saveStatus(page)).toHaveText('Saved')
  await page.goBack()
  await expectTotals(page, 1, '17 left', '0 km')

  await filter(page, 'Done').click()
  await expect(page).toHaveURL(/#\/warsaw-districts\?show=done$/)
  await expect(cards(page)).toHaveCount(1)
  await expect(card(page, 'Ochota Done')).toBeVisible()

  await openDistrict(page, 'Ochota Done', 'Ochota')
  // Saved on the earlier visit; nothing was edited on this one.
  await expect(saveStatus(page)).toHaveText('')
  await page.goBack()
  await expect(page).toHaveURL(/#\/warsaw-districts\?show=done$/)
  await expect(filter(page, 'Done')).toHaveAttribute('aria-pressed', 'true')
  await expect(filter(page, 'All')).toHaveAttribute('aria-pressed', 'false')
  await expect(cards(page)).toHaveCount(1)

  await filter(page, 'Left').click()
  await expect(page).toHaveURL(/#\/warsaw-districts\?show=left$/)
  await expect(cards(page)).toHaveCount(17)
  await expect(card(page, 'Ochota Done')).toHaveCount(0)

  // Three filter changes later, one step back still leaves the list.
  await page.goBack()
  await expect(heading(page)).toHaveText('Settings')
})

test('7: a district opened straight from a link has a way back, and an unknown address says so', async ({ page }) => {
  await page.goto('./#/warsaw-districts/wola')
  await expect(heading(page)).toHaveText('Wola')
  await expect(doneTick(page)).toBeVisible()

  // Nothing is behind this screen in history; Back turns it into the list.
  await backButton(page).click()
  await expect(heading(page)).toHaveText('Districts')
  await expect(page).toHaveURL(/#\/warsaw-districts$/)
  await expect(cards(page)).toHaveCount(18)

  // After a reload on a district, Back still knows the list is behind it.
  await openDistrict(page, 'Wola Not done', 'Wola')
  await page.reload()
  await expect(heading(page)).toHaveText('Wola')
  await backButton(page).click()
  await expect(heading(page)).toHaveText('Districts')
  await expect(page).toHaveURL(/#\/warsaw-districts$/)
  await page.goForward()
  await expect(heading(page)).toHaveText('Wola')

  // A district's address entered while another screen is showing, as from the
  // address bar: that screen is behind it, not the list. "Back to Districts"
  // must still show Districts, and one step back from there is that screen.
  await tab(page, 'Settings').click()
  await expect(heading(page)).toHaveText('Settings')
  await page.evaluate(() => {
    window.location.hash = '#/warsaw-districts/wola'
  })
  await expect(heading(page)).toHaveText('Wola')
  await backButton(page).click()
  await expect(heading(page)).toHaveText('Districts')
  await expect(page).toHaveURL(/#\/warsaw-districts$/)
  await page.goBack()
  await expect(heading(page)).toHaveText('Settings')

  await page.goto('./#/nope')
  await expect(heading(page)).toHaveText('Page not found')
  await expect(page).toHaveTitle('Page not found – Pinezka')
  await expect(page.getByText('This link does not match anything in Pinezka.')).toBeVisible()
  await page.getByRole('link', { name: 'Go to Districts' }).click()
  await expect(heading(page)).toHaveText('Districts')
  await expect(page).toHaveURL(/#\/warsaw-districts$/)
  await expect(cards(page)).toHaveCount(18)
})

test('8: a save that fails is shown, counted nowhere, and can be tried again or given up', async ({ page }) => {
  await allowFailingSaves(page)
  await page.goto('./')
  await expect(saveAlert(page)).toHaveText('')
  await openDistrict(page, 'Mokotów Not done', 'Mokotów')

  await failSaves(page, true)
  await doneTick(page).check()

  // The tick stays as the user left it, marked as not stored.
  await expect(saveStatus(page)).toHaveText('Not saved')
  await expect(doneTick(page)).toBeChecked()
  await expect(doneTick(page)).toHaveAccessibleDescription('Not saved')
  await expect(saveAlert(page)).toContainText('Not saved')
  await expect(saveAlert(page)).toContainText('Your change to Mokotów is not saved.')
  await expect(banner(page)).toContainText('Your change to Mokotów is not saved.')
  await expect(banner(page)).toContainText('out of storage space')

  // The list shows only what is stored, and explains the failure there too.
  await page.goBack()
  await expectTotals(page, 0, '18 left', '0 km')
  await expect(card(page, 'Mokotów Not done')).toBeVisible()
  await expect(saveAlert(page)).toContainText('Your change to Mokotów is not saved.')
  await expect(banner(page)).toContainText('out of storage space')

  await failSaves(page, false)
  await banner(page).getByRole('button', { name: 'Try again' }).click()
  await expect(saveAlert(page)).toHaveText('')
  await expect(banner(page)).toHaveCount(0)
  await expectTotals(page, 1, '17 left', '0 km')
  await expect(card(page, 'Mokotów Done')).toBeVisible()
  // The button is gone with the banner; focus stays on this screen.
  await expect(heading(page)).toBeFocused()

  await page.reload()
  await expectTotals(page, 1, '17 left', '0 km')

  // Back to nothing done, then the same failure again, given up this time.
  await openDistrict(page, 'Mokotów Done', 'Mokotów')
  await doneTick(page).uncheck()
  await expect(saveStatus(page)).toHaveText('Saved')
  await failSaves(page, true)
  await doneTick(page).check()
  await expect(saveStatus(page)).toHaveText('Not saved')
  await expect(saveAlert(page)).toContainText('Your change to Mokotów is not saved.')

  await banner(page).getByRole('button', { name: 'Discard' }).click()
  await expect(saveAlert(page)).toHaveText('')
  await expect(banner(page)).toHaveCount(0)
  await expect(doneTick(page)).not.toBeChecked()
  await expect(heading(page)).toBeFocused()

  await page.goBack()
  await expectTotals(page, 0, '18 left', '0 km')
  await expect(card(page, 'Mokotów Not done')).toBeVisible()

  // Given up for good: a restart does not bring the edit back.
  await failSaves(page, false)
  await page.reload()
  await expectTotals(page, 0, '18 left', '0 km')
})

test('9: when a newer version has taken over the data, this copy stops saving and says so', async ({ page }) => {
  await page.goto('./')
  // The app's own connection must be open before the newer version arrives.
  await expect(cards(page)).toHaveCount(18)

  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('pinezka', 2)
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(new Error(request.error?.message ?? 'The database did not open'))
        request.onblocked = () => reject(new Error('The app did not let go of its database'))
      }),
  )

  await openDistrict(page, 'Wawer Not done', 'Wawer')
  await doneTick(page).check()

  await expect(saveStatus(page)).toHaveText('Not saved')
  await expect(banner(page)).toContainText('A newer version of Pinezka has updated your data')
  await expect(banner(page)).toContainText('Your unsaved change is kept and will be saved after the update.')
  await expect(banner(page).getByRole('button', { name: 'Reload' })).toBeVisible()
  await expect(saveAlert(page)).toContainText('A newer version of Pinezka has updated your data')

  await expect(doneTick(page)).toBeDisabled()
  await expect(dateField(page)).toBeDisabled()
  await expect(distanceField(page)).toBeDisabled()
  await expect(linkField(page)).toBeDisabled()
  await expect(notesField(page)).toBeDisabled()

  await page.goBack()
  await expectTotals(page, 0, '18 left', '0 km')
  await expect(card(page, 'Wawer Not done')).toBeVisible()
  await expect(banner(page).getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('10: a pasted Strava share sentence is reduced to its link', async ({ page }) => {
  await page.goto('./')
  await openDistrict(page, 'Wilanów Not done', 'Wilanów')
  const openLink = page.getByRole('link', { name: /^Open link/ })
  await expect(openLink).toHaveCount(0)

  await linkField(page).fill('Check out my run: https://www.strava.com/activities/123')
  await linkField(page).blur()

  await expect(linkField(page)).toHaveValue('https://www.strava.com/activities/123')
  await expect(openLink).toHaveAttribute('href', 'https://www.strava.com/activities/123')
  await expect(openLink).toHaveAttribute('target', '_blank')
  await expect(saveStatus(page)).toHaveText('Saved')

  await page.reload()
  await expect(linkField(page)).toHaveValue('https://www.strava.com/activities/123')
})

test('a date after today is refused with a reason, and the date saved before stays', async ({ page }) => {
  await page.goto('./')
  await openDistrict(page, 'Targówek Not done', 'Targówek')
  const error = page.getByText('Pick a real date, today or earlier.')

  await dateField(page).fill('2026-10-12')
  await expect(saveStatus(page)).toHaveText('Saved')
  await dateField(page).blur()
  await expect(error).toHaveCount(0)

  // The phone's picker greys such days out; a keyboard can still type one.
  await dateField(page).fill('2099-09-09')
  await dateField(page).blur()
  await expect(error).toBeVisible()
  await expect(dateField(page)).toHaveValue('2026-10-12')
  await expect(dateField(page)).toHaveAccessibleDescription('Pick a real date, today or earlier.')

  await page.goBack()
  await expect(card(page, 'Targówek Not done 12 Oct 2026')).toBeVisible()
  await page.reload()
  await expect(card(page, 'Targówek Not done 12 Oct 2026')).toBeVisible()
})

/**
 * Whether the last line of the note can be seen: the page has scrolled it
 * into the window, and neither the Done bar nor the tab bar lies over it.
 */
const lastNoteLineShows = (page: Page) =>
  notesField(page).evaluate((note) => {
    const box = note.getBoundingClientRect()
    const style = getComputedStyle(note)
    const bottom = box.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth)
    const top = bottom - parseFloat(style.lineHeight)
    const x = box.left + box.width / 2
    // Just inside the line's upper and lower edge: both must be the note itself.
    return [top + 1, bottom - 1].every((y) => document.elementFromPoint(x, y) === note)
  })

/** The line that appears above the tick once a distance is entered: the Done bar at its tallest. */
const notTickedHint = (page: Page) => page.getByText('Not ticked yet. Tick Done to count it.')

test('the line being typed in a long note stays above the Done bar', async ({ page }) => {
  await page.goto('./')
  await openDistrict(page, 'Bemowo Not done', 'Bemowo')
  await distanceField(page).fill('5')
  await distanceField(page).blur()
  await expect(notTickedHint(page)).toBeVisible()

  // Typed key by key, as on the phone: the page follows the line being typed.
  await notesField(page).click()
  await notesField(page).pressSequentially(linesOfNote(30))
  await expect(notesField(page)).toHaveValue(linesOfNote(30))
  // Guards the check itself: the note is longer than the room it had, so the page had to move.
  expect(await scrollY(page)).toBeGreaterThan(100)
  await expect.poll(() => lastNoteLineShows(page)).toBe(true)
})

test('a long note reached with the Tab key is not left behind the Done bar', async ({ page }) => {
  await page.goto('./')
  await openDistrict(page, 'Bemowo Not done', 'Bemowo')
  // Shorter than the screen, but reaching below the Done bar while the page is at its top.
  await notesField(page).fill(linesOfNote(17))
  await distanceField(page).fill('5')
  await page.keyboard.press('Tab')
  await expect(linkField(page)).toBeFocused()
  await expect(notTickedHint(page)).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await expectScrolledTo(page, 0)
  // Guards the check itself: before the key is pressed, the end of the note is covered.
  expect(await lastNoteLineShows(page)).toBe(false)

  await page.keyboard.press('Tab')
  await expect(notesField(page)).toBeFocused()
  await expect.poll(() => lastNoteLineShows(page)).toBe(true)
})

test('a field reached with Shift+Tab is not left underneath the "Not saved" banner', async ({ page }) => {
  await allowFailingSaves(page)
  await page.goto('./')
  await openDistrict(page, 'Bemowo Not done', 'Bemowo')
  // Long enough for the page to scroll the fields above it under the top bar.
  await notesField(page).fill(linesOfNote(16))
  await expect(saveStatus(page)).toHaveText('Saved')
  await failSaves(page, true)
  await doneTick(page).check()
  await expect(banner(page).getByRole('button', { name: 'Discard' })).toBeVisible()

  /** How far the field with the focus begins below the bottom edge of the top bar and its banner. */
  const clearOfBanner = (field: Locator) =>
    field.evaluate((element) => {
      const bar = document.querySelector('header')
      if (!bar) throw new Error('This screen has no top bar')
      return element.getBoundingClientRect().top - bar.getBoundingClientRect().bottom
    })

  await notesField(page).focus()
  for (const field of [linkField(page), distanceField(page), dateField(page)]) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    // Guards the check itself: with the page at its end, the field is not in the clear already.
    expect(await clearOfBanner(field)).toBeLessThan(0)

    await page.keyboard.press('Shift+Tab')
    await expect(field).toBeFocused()
    await expect.poll(() => clearOfBanner(field)).toBeGreaterThanOrEqual(0)
  }
})

test('when the saved data opens only at a later try, focus is on the heading and not lost', async ({ page }) => {
  // The database refuses to open until the test lets it.
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open
    IDBFactory.prototype.open = function (this: IDBFactory, ...args: Parameters<IDBFactory['open']>) {
      if (!(window as { __letOpen?: boolean }).__letOpen) throw new Error('Closed for this test')
      return open.apply(this, args)
    }
  })
  const letOpen = () =>
    page.evaluate(() => {
      ;(window as { __letOpen?: boolean }).__letOpen = true
    })
  const problem = page.getByRole('heading', { name: "Pinezka can't open its saved data" })
  const tryAgain = page.getByRole('button', { name: 'Try again' })

  await page.goto('./')
  await expect(problem).toBeVisible()
  // A try that fails again: the button was replaced by a new one, and focus stays on the screen.
  await tryAgain.focus()
  await page.keyboard.press('Enter')
  await expect(heading(page)).toBeFocused()
  await expect(problem).toBeVisible()

  await letOpen()
  await tryAgain.focus()
  await page.keyboard.press('Enter')
  await expect(cards(page)).toHaveCount(18)
  await expect(problem).toHaveCount(0)
  await expect(heading(page)).toBeFocused()

  // The same on a district's own screen. The reload closes the database again.
  await page.goto('./#/warsaw-districts/wola')
  await page.reload()
  await expect(heading(page)).toHaveText('Wola')
  await expect(problem).toBeVisible()
  await letOpen()
  await tryAgain.focus()
  await page.keyboard.press('Enter')
  await expect(doneTick(page)).toBeVisible()
  await expect(heading(page)).toBeFocused()
})

test.describe('on a narrow phone', () => {
  test.use({ viewport: { width: 360, height: 740 } })

  /** Nothing is wider than the screen, and everything that can be tapped is at least 44 by 44 px. */
  async function expectFitsAndTappable(page: Page, atLeast: number) {
    const measured = await page.evaluate(() => {
      const targets = document.querySelectorAll(
        'a, button, input:not([type=checkbox]), textarea, label:has(input[type=checkbox])',
      )
      return {
        pageWidth: document.documentElement.scrollWidth,
        screenWidth: document.documentElement.clientWidth,
        targets: targets.length,
        tooSmall: [...targets]
          .map((target) => {
            const { width, height } = target.getBoundingClientRect()
            return { target, width, height }
          })
          .filter(({ width, height }) => width < 44 || height < 44)
          .map(({ target, width, height }) => {
            // A button that is only an icon has no text to be known by.
            const name = target.getAttribute('aria-label') ?? target.textContent.trim()
            return `${target.tagName} "${name}" is ${width} x ${height} px`
          }),
      }
    })
    expect(measured.pageWidth).toBeLessThanOrEqual(measured.screenWidth)
    expect(measured.tooSmall).toEqual([])
    // Guards the check itself: it must have looked at the screen it was meant for.
    expect(measured.targets).toBeGreaterThanOrEqual(atLeast)
  }

  test('11: every screen fits 360 px and every tap target is at least 44 by 44 px', async ({ page }) => {
    await allowFailingSaves(page)

    // The list: 3 filter buttons, 18 cards, 2 tabs.
    await page.goto('./')
    await expect(cards(page)).toHaveCount(18)
    await expectFitsAndTappable(page, 23)

    // The Done filter with nothing done: 3 filter buttons, "Show all", 2 tabs.
    await filter(page, 'Done').click()
    await expect(page.getByRole('button', { name: 'Show all' })).toBeVisible()
    await expectFitsAndTappable(page, 6)
    await filter(page, 'All').click()

    // A district with a link, so "Open link" is there to measure: back button,
    // 4 fields, the link, the Done bar, 2 tabs.
    await openDistrict(page, 'Praga-Południe Not done', 'Praga-Południe')
    await linkField(page).fill('https://www.strava.com/activities/123')
    await linkField(page).blur()
    await expect(page.getByRole('link', { name: /^Open link/ })).toBeVisible()
    await expect(saveStatus(page)).toHaveText('Saved')
    await expectFitsAndTappable(page, 9)
    const notes = await notesField(page).boundingBox()
    // Three lines high while empty, not one.
    expect(notes?.height).toBeGreaterThanOrEqual(80)

    // A long link is stored, then the field is left holding text that is not
    // a link. The note under it quotes the stored link, which has nowhere to
    // break; it must wrap all the same and not make the page wider.
    const longLink =
      'https://www.strava.com/activities/12345678901?share_sig=ABCDEF1234&utm_medium=social&utm_source=android_share'
    await linkField(page).fill(longLink)
    await linkField(page).blur()
    await expect(page.getByRole('link', { name: /^Open link/ })).toHaveAttribute('href', longLink)
    await linkField(page).fill('strava')
    await linkField(page).blur()
    await expect(page.getByText(`Saved value: ${longLink}.`)).toBeVisible()
    await expectFitsAndTappable(page, 9)
    // Back to a real link, so the next step starts from a field with nothing wrong.
    await linkField(page).fill(longLink)
    await linkField(page).blur()
    await expect(page.getByText(/^Saved value:/)).toHaveCount(0)
    await expect(saveStatus(page)).toHaveText('Saved')

    // The same screen with a failed save: the banner and its two buttons.
    await failSaves(page, true)
    await doneTick(page).check()
    await expect(banner(page).getByRole('button', { name: 'Discard' })).toBeVisible()
    await expectFitsAndTappable(page, 11)
    await failSaves(page, false)
    await banner(page).getByRole('button', { name: 'Try again' }).click()
    await expect(banner(page)).toHaveCount(0)

    await tab(page, 'Settings').click()
    await expect(heading(page)).toHaveText('Settings')
    await expectFitsAndTappable(page, 2)

    await page.goto('./#/nope')
    await expect(page.getByRole('link', { name: 'Go to Districts' })).toBeVisible()
    await expectFitsAndTappable(page, 3)
  })
})

// Zooming in with Chrome on the phone makes the screen narrower, counted in
// the page's own px: 277 px is a 360 px phone zoomed to 130%.
test.describe('on a zoomed-in page', () => {
  test.use({ viewport: { width: 277, height: 740 } })

  test('the heading of every district shows the whole name', async ({ page }) => {
    await page.goto('./')
    await expect(cards(page)).toHaveCount(18)

    const seen = new Set<string>()
    for (let index = 0; index < 18; index += 1) {
      await cards(page).nth(index).click()
      await expect(backButton(page)).toBeVisible()
      const title = await heading(page).evaluate((h1) => ({
        name: h1.textContent,
        // What does not fit: px to the side when the name is kept on one line,
        // whole lines below when lines are cut away. Counted in lines, because
        // the letters of some fonts reach a px past the line they stand on.
        hiddenWidth: h1.scrollWidth - h1.clientWidth,
        hiddenLines: Math.round((h1.scrollHeight - h1.clientHeight) / parseFloat(getComputedStyle(h1).lineHeight)),
      }))
      expect(title.hiddenWidth, title.name).toBeLessThanOrEqual(1)
      expect(title.hiddenLines, title.name).toBe(0)
      seen.add(title.name)

      // Room is kept free beside the name for the word that says how saving
      // went, so the name does not move when the word comes. Nothing was
      // edited, so the room is empty; on a screen this narrow it may take no
      // more than a quarter of the width away from the name.
      const keptFree = await saveStatus(page).evaluate((word) => word.parentElement?.getBoundingClientRect().width ?? 0)
      expect(keptFree).toBeGreaterThan(0)
      expect(keptFree).toBeLessThanOrEqual(277 / 4 + 0.5)

      await page.goBack()
      await expect(heading(page)).toHaveText('Districts')
    }
    // Guards the check itself: it looked at 18 different districts.
    expect(seen.size).toBe(18)
  })

  test('the "Not saved" tag on the Done bar does not cover the word "Done"', async ({ page }) => {
    await allowFailingSaves(page)
    await page.goto('./')
    await openDistrict(page, 'Wola Not done', 'Wola')
    await failSaves(page, true)
    await doneTick(page).check()
    await expect(doneTick(page)).toHaveAccessibleDescription('Not saved')

    const boxes = await doneTick(page).evaluate((tick) => {
      const tag = document.getElementById(tick.getAttribute('aria-describedby') ?? '')
      // The word is plain text inside the bar, so it is measured as a range of text.
      const word = [...(tick.closest('label')?.childNodes ?? [])].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === 'Done',
      )
      if (!tag || !word) throw new Error('The Done bar is not built as this test expects')
      const range = document.createRange()
      range.selectNodeContents(word)
      const { left, right, top, bottom, width } = range.getBoundingClientRect()
      const tagBox = tag.getBoundingClientRect()
      return {
        word: { left, right, top, bottom, width },
        tag: { left: tagBox.left, right: tagBox.right, top: tagBox.top, bottom: tagBox.bottom, width: tagBox.width },
      }
    })
    // Guards the check itself: both were drawn and measured.
    expect(boxes.word.width).toBeGreaterThan(20)
    expect(boxes.tag.width).toBeGreaterThan(40)
    const apart =
      boxes.word.right <= boxes.tag.left ||
      boxes.tag.right <= boxes.word.left ||
      boxes.word.bottom <= boxes.tag.top ||
      boxes.tag.bottom <= boxes.word.top
    expect(apart, JSON.stringify(boxes)).toBe(true)
  })
})

test('12: the colours follow the dark setting of the phone', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('./')
  await expect(cards(page)).toHaveCount(18)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(20, 20, 18)')

  await page.emulateMedia({ colorScheme: 'light' })
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(246, 245, 241)')
})
