import { expect, test as base } from '@playwright/test'

// Every browser test takes `test` from here instead of from Playwright, so
// every one of them, whatever it does on the page, also checks the rule below.

/**
 * The app never talks to anything but the place it was loaded from: no
 * request and no socket to anywhere else, on any screen and after any action.
 * A test fails when the page it drove broke that rule.
 */
export const test = base.extend({
  // Playwright's examples call the second parameter `use`. The linter takes a
  // function of that name for a React hook, so it has another name here.
  page: async ({ page, baseURL }, runTest) => {
    // With no address to compare with, every request would count as the app's own.
    if (!baseURL) throw new Error('The tests need a baseURL to tell requests of the app from all others')
    const outside: string[] = []
    // Watched on the whole browser context, not only this page: a tab the app
    // opens and requests made by a service worker are seen too.
    page.context().on('request', (request) => {
      const isNetwork = /^https?:/.test(request.url())
      if (isNetwork && !request.url().startsWith(baseURL)) outside.push(request.url())
    })
    page.on('websocket', (socket) => outside.push(socket.url()))

    await runTest(page)

    expect(outside, 'requests to somewhere other than the app itself').toEqual([])
  },
})

export { expect }
