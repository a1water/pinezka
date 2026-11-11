import { afterEach, describe, expect, it, vi } from 'vitest'
import { collections, placeId, warsawDistricts } from './collections/index.ts'
import { listHash, parseRoute, placeHash, SETTINGS_HASH } from './router.ts'
import type { ListFilter } from './router.ts'

const LIST = '#/warsaw-districts'
const MOKOTOW = '#/warsaw-districts/mokotow'
const WOLA = '#/warsaw-districts/wola'

describe('reading an address', () => {
  it.each(['', '#', '#/'])('opens the first collection’s list for the bare address %j', (hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'list', collection: collections[0], show: 'all' })
  })

  it('opens Settings', () => {
    expect(parseRoute('#/settings')).toEqual({ name: 'settings' })
    expect(parseRoute(SETTINGS_HASH)).toEqual({ name: 'settings' })
  })

  it.each<[string, ListFilter]>([
    ['#/warsaw-districts', 'all'],
    ['#/warsaw-districts/', 'all'],
    ['#/warsaw-districts?show=done', 'done'],
    ['#/warsaw-districts?show=left', 'left'],
    ['#/warsaw-districts/?show=left', 'left'],
    ['#/warsaw-districts?show=all', 'all'],
  ])('opens the list for %j, showing %j', (hash, show) => {
    expect(parseRoute(hash)).toEqual({ name: 'list', collection: warsawDistricts, show })
  })

  it.each([
    '#/warsaw-districts?show=bogus',
    '#/warsaw-districts?show=DONE',
    '#/warsaw-districts?view=map',
    '#/warsaw-districts?x=1',
    '#/warsaw-districts?',
  ])('shows everything for the parameters it does not know in %j', (hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'list', collection: warsawDistricts, show: 'all' })
  })

  it('keeps a known filter next to parameters it does not know', () => {
    expect(parseRoute('#/warsaw-districts?view=map&show=done')).toMatchObject({ name: 'list', show: 'done' })
  })

  it('opens a place by its stored id', () => {
    const route = parseRoute('#/warsaw-districts/praga-poludnie')
    expect(route).toEqual({
      name: 'place',
      collection: warsawDistricts,
      place: { key: 'praga-poludnie', name: 'Praga-Południe' },
      placeId: 'warsaw-districts/praga-poludnie',
    })
    expect(parseRoute('#/warsaw-districts/praga-poludnie/')).toEqual(route)
  })

  it.each([
    '#/nope',
    '#/warsaw-districts/nope',
    '#/warsaw-districts/mokotow/extra',
    '#settings',
    '#/Settings',
    '#/settings/about',
    '#/warsaw-districts/Mokotow',
    '#/Warsaw-Districts',
    '#warsaw-districts',
    '#/warsaw-districts/mokot%C3%B3w',
    '#/countries/ES',
  ])('finds nothing at %j', (hash) => {
    expect(parseRoute(hash)).toEqual({ name: 'not-found' })
  })
})

describe('writing an address', () => {
  it('leaves the filter out when the list shows everything', () => {
    expect(listHash('warsaw-districts')).toBe('#/warsaw-districts')
    expect(listHash('warsaw-districts', 'all')).toBe('#/warsaw-districts')
    expect(listHash('warsaw-districts', 'left')).toBe('#/warsaw-districts?show=left')
    expect(listHash('warsaw-districts', 'done')).toBe('#/warsaw-districts?show=done')
  })

  it('never writes the bare address for a list', () => {
    for (const { id } of collections) {
      for (const show of ['all', 'left', 'done'] as const) {
        expect(['#', '#/']).not.toContain(listHash(id, show))
      }
    }
  })

  it('reads back every list address it writes', () => {
    for (const collection of collections) {
      for (const show of ['all', 'left', 'done'] as const) {
        expect(parseRoute(listHash(collection.id, show))).toEqual({ name: 'list', collection, show })
      }
    }
  })

  it('reads back the address of every district', () => {
    expect(warsawDistricts.places).toHaveLength(18)
    for (const place of warsawDistricts.places) {
      const id = placeId(warsawDistricts.id, place.key)
      expect(placeHash(id)).toBe(`#/${id}`)
      expect(parseRoute(placeHash(id))).toEqual({ name: 'place', collection: warsawDistricts, place, placeId: id })
    }
  })

  it('needs no encoding: every address is plain ASCII and survives the browser unchanged', () => {
    for (const collection of collections) {
      for (const { key } of collection.places) {
        const hash = placeHash(placeId(collection.id, key))
        expect(new URL(hash, 'https://example.test/app/').hash).toBe(hash)
      }
    }
  })
})

// The navigation half talks to the browser. Vitest runs without one, so these
// tests give it a small stand-in for one tab's history and load a fresh copy
// of the module for each test.

type HistoryEntry = { hash: string; state: unknown }

function fakeBrowser(firstHash: string, firstState: unknown = null) {
  const entries: HistoryEntry[] = [{ hash: firstHash, state: firstState }]
  let index = 0
  const handlers: (() => void)[] = []
  const current = (): HistoryEntry => {
    const entry = entries[index]
    if (!entry) throw new Error('The fake history lost its place')
    return entry
  }
  const fire = () => {
    for (const handler of handlers) handler()
  }

  const window = {
    scrollY: 0,
    location: {
      get hash() {
        return current().hash
      },
    },
    history: {
      scrollRestoration: 'auto',
      get state() {
        return current().state
      },
      replaceState(state: unknown, _unused: string, url?: string) {
        entries[index] = { hash: url ?? current().hash, state }
      },
      back() {
        if (index === 0) return
        index -= 1
        fire()
      },
      forward() {
        if (index === entries.length - 1) return
        index += 1
        fire()
      },
    },
    addEventListener(type: string, handler: () => void) {
      if (type === 'hashchange') handlers.push(handler)
    },
  }

  return {
    window,
    /** What following a link does: a new entry with no state, and everything ahead of it gone. */
    follow(hash: string) {
      entries.splice(index + 1)
      entries.push({ hash, state: null })
      index += 1
      fire()
    },
    hashes: () => entries.map((entry) => entry.hash),
    position: () => index,
    listenerCount: () => handlers.length,
  }
}

async function startAt(firstHash: string, firstState: unknown = null) {
  const browser = fakeBrowser(firstHash, firstState)
  vi.stubGlobal('window', browser.window)
  vi.resetModules()
  const router = await import('./router.ts')
  router.startRouter()
  return { browser, router }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('moving between screens', () => {
  it('starts on the address the app was opened with and takes scrolling into its own hands', async () => {
    const { browser, router } = await startAt(MOKOTOW)
    expect(router.lastNavigation()).toEqual({ direction: 'start', from: MOKOTOW })
    expect(browser.window.history.scrollRestoration).toBe('manual')
    expect(browser.window.history.state).toEqual({ idx: 0 })
    expect(browser.hashes()).toEqual([MOKOTOW])
    expect(router.savedScroll()).toBeUndefined()
  })

  it('listens once, however often it is started', async () => {
    const { browser, router } = await startAt(LIST)
    router.startRouter()
    expect(browser.listenerCount()).toBe(1)
  })

  it('numbers each new entry and tells a link from Back and Forward', async () => {
    const { browser, router } = await startAt(LIST)

    browser.follow(MOKOTOW)
    expect(router.lastNavigation()).toEqual({ direction: 'push', from: LIST })
    // Next to its number a new entry keeps the address it was opened from.
    expect(browser.window.history.state).toEqual({ idx: 1, from: LIST })

    browser.window.history.back()
    expect(router.lastNavigation()).toEqual({ direction: 'back', from: MOKOTOW })

    browser.window.history.forward()
    expect(router.lastNavigation()).toEqual({ direction: 'forward', from: LIST })

    browser.follow(SETTINGS_HASH)
    expect(router.lastNavigation()).toEqual({ direction: 'push', from: MOKOTOW })
    expect(browser.window.history.state).toEqual({ idx: 2, from: MOKOTOW })
  })

  it('remembers how far each entry was scrolled, and forgets it for a new entry', async () => {
    const { browser, router } = await startAt(LIST)

    browser.window.scrollY = 640
    browser.follow(MOKOTOW)
    // A screen opened by a link has no position yet: it starts at the top.
    expect(router.savedScroll()).toBeUndefined()

    browser.window.scrollY = 120
    browser.window.history.back()
    expect(router.savedScroll()).toBe(640)

    browser.window.scrollY = 600
    browser.window.history.forward()
    expect(router.savedScroll()).toBe(120)

    // Back to the list, then open another place: it takes the old entry's
    // number but must not inherit the other place's position.
    browser.window.history.back()
    browser.follow(WOLA)
    expect(router.savedScroll()).toBeUndefined()
  })

  it('gives a component the current address and the screen it stands for', async () => {
    const { browser, router } = await startAt(LIST)
    // Rendered to a string: there is no page here, and the hook's value is all that matters.
    const seen: string[] = []
    const { renderToString } = await import('react-dom/server')
    const { createElement } = await import('react')
    function Probe() {
      const { hash, route } = router.useRoute()
      seen.push(`${hash} ${route.name}`)
      return null
    }
    renderToString(createElement(Probe))
    browser.follow(MOKOTOW)
    renderToString(createElement(Probe))
    expect(seen).toEqual([`${LIST} list`, `${MOKOTOW} place`])
  })

  it('changes the filter in place: no new entry, and Back does not step through filters', async () => {
    const { browser, router } = await startAt(LIST)
    browser.follow(SETTINGS_HASH)
    browser.follow(LIST)

    router.replaceFilter('warsaw-districts', 'done')
    expect(router.lastNavigation()).toEqual({ direction: 'replace', from: LIST })
    router.replaceFilter('warsaw-districts', 'left')
    expect(router.lastNavigation()).toEqual({ direction: 'replace', from: `${LIST}?show=done` })
    expect(browser.hashes()).toEqual([LIST, SETTINGS_HASH, `${LIST}?show=left`])
    // The entry keeps its number, so the router still knows where it is.
    expect(browser.window.history.state).toEqual({ idx: 2 })

    browser.window.history.back()
    expect(router.lastNavigation()).toEqual({ direction: 'back', from: `${LIST}?show=left` })
    expect(browser.window.location.hash).toBe(SETTINGS_HASH)
  })

  it('keeps the filter while a place is open, and comes back to it', async () => {
    const { browser, router } = await startAt(LIST)
    router.replaceFilter('warsaw-districts', 'done')
    browser.window.scrollY = 300
    browser.follow(MOKOTOW)

    router.goBack(LIST)
    expect(browser.window.location.hash).toBe(`${LIST}?show=done`)
    expect(router.lastNavigation()).toEqual({ direction: 'back', from: MOKOTOW })
    expect(router.savedScroll()).toBe(300)
  })

  it('does nothing when the filter asked for is the one showing', async () => {
    const { router } = await startAt(`${LIST}?show=done`)
    router.replaceFilter('warsaw-districts', 'done')
    expect(router.lastNavigation().direction).toBe('start')
  })

  it('goes back through history when there is a screen behind this one', async () => {
    const { browser, router } = await startAt(LIST)
    browser.follow(MOKOTOW)

    router.goBack(LIST)
    expect(browser.position()).toBe(0)
    expect(browser.hashes()).toEqual([LIST, MOKOTOW])
    // History was popped, not rewritten, so Forward still leads to the place.
    browser.window.history.forward()
    expect(browser.window.location.hash).toBe(MOKOTOW)
    expect(router.lastNavigation().direction).toBe('forward')
  })

  it('goes back through history from a place opened from the bare app address', async () => {
    const { browser, router } = await startAt('')
    browser.follow(MOKOTOW)

    router.goBack(LIST)
    expect(browser.position()).toBe(0)
    expect(browser.hashes()).toEqual(['', MOKOTOW])
  })

  it('opens the list in place of a place whose address was entered while another screen was showing', async () => {
    const { browser, router } = await startAt(SETTINGS_HASH)
    browser.window.scrollY = 150
    // An address typed or pasted into the bar of the open app is a new entry, like a link.
    browser.follow(WOLA)
    browser.window.scrollY = 200

    router.goBack(LIST)
    // Settings is behind this place, not its list, so popping history would show Settings.
    expect(browser.window.location.hash).toBe(LIST)
    expect(browser.hashes()).toEqual([SETTINGS_HASH, LIST])
    expect(browser.position()).toBe(1)
    expect(browser.window.history.state).toEqual({ idx: 1 })
    expect(router.lastNavigation()).toEqual({ direction: 'back', from: WOLA })
    expect(router.savedScroll()).toBeUndefined()

    // The phone's own back button then leaves the list for the screen that really is behind it.
    browser.window.history.back()
    expect(browser.window.location.hash).toBe(SETTINGS_HASH)
    expect(router.lastNavigation()).toEqual({ direction: 'back', from: LIST })
    expect(router.savedScroll()).toBe(150)
  })

  it('opens the list in place of a place that was reached from another place', async () => {
    const { browser, router } = await startAt(LIST)
    browser.follow(MOKOTOW)
    browser.follow(WOLA)

    router.goBack(LIST)
    expect(browser.window.location.hash).toBe(LIST)
    expect(browser.hashes()).toEqual([LIST, MOKOTOW, LIST])
    expect(browser.position()).toBe(2)
  })

  it('opens the list in place of a place that was reached from the list of another collection', async () => {
    const browser = fakeBrowser('#/countries?show=done')
    vi.stubGlobal('window', browser.window)
    vi.resetModules()
    // The app has one collection so far; the router is given a second one to tell apart.
    vi.doMock('./collections/index.ts', async () => {
      const actual = await vi.importActual<typeof import('./collections/index.ts')>('./collections/index.ts')
      const all = [...actual.collections, { ...actual.warsawDistricts, id: 'countries' }]
      return { ...actual, collections: all, getCollection: (id: string) => all.find((one) => one.id === id) }
    })
    const router = await import('./router.ts')
    vi.doUnmock('./collections/index.ts')
    router.startRouter()
    expect(router.parseRoute('#/countries?show=done')).toMatchObject({ name: 'list', collection: { id: 'countries' } })

    browser.follow(WOLA)
    router.goBack(LIST)
    expect(browser.hashes()).toEqual(['#/countries?show=done', LIST])
    expect(browser.position()).toBe(1)
  })

  it('turns a place opened straight from a link into its list', async () => {
    const { browser, router } = await startAt(WOLA)
    browser.window.scrollY = 200

    router.goBack(LIST)
    expect(browser.hashes()).toEqual([LIST])
    expect(browser.window.history.state).toEqual({ idx: 0 })
    expect(router.lastNavigation()).toEqual({ direction: 'back', from: WOLA })
    expect(router.savedScroll()).toBeUndefined()
  })

  it('does not hand the place’s scroll position to the list that replaces it', async () => {
    const { browser, router } = await startAt(WOLA)
    browser.window.scrollY = 200
    browser.follow(SETTINGS_HASH)
    browser.window.history.back()
    // Back on the place, which was scrolled when it was left.
    expect(router.savedScroll()).toBe(200)

    router.goBack(LIST)
    expect(browser.window.location.hash).toBe(LIST)
    expect(router.savedScroll()).toBeUndefined()
  })

  it('tells its subscribers about every change of address, until they unsubscribe', async () => {
    const browser = fakeBrowser(WOLA)
    vi.stubGlobal('window', browser.window)
    vi.resetModules()
    // There is no page to render into, so React's hook is swapped for one
    // that hands the test the subscription a component would get.
    let subscribe: (listener: () => void) => () => void = () => () => {}
    vi.doMock('react', () => ({
      useMemo: (work: () => unknown) => work(),
      useSyncExternalStore(given: typeof subscribe, read: () => string) {
        subscribe = given
        return read()
      },
    }))
    const router = await import('./router.ts')
    vi.doUnmock('react')
    router.startRouter()
    expect(router.useRoute()).toMatchObject({ hash: WOLA, route: { name: 'place' } })

    const listener = vi.fn()
    const unsubscribe = subscribe(listener)
    router.goBack(LIST)
    expect(listener).toHaveBeenCalledTimes(1)
    router.replaceFilter('warsaw-districts', 'done')
    expect(listener).toHaveBeenCalledTimes(2)
    browser.follow(MOKOTOW)
    expect(listener).toHaveBeenCalledTimes(3)
    browser.window.history.back()
    expect(listener).toHaveBeenCalledTimes(4)
    expect(router.useRoute()).toMatchObject({ hash: `${LIST}?show=done`, route: { name: 'list', show: 'done' } })

    unsubscribe()
    browser.window.history.forward()
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it('still goes back through history after a reload on a place', async () => {
    // The tab's history is list, then place; the page was reloaded on the
    // place, so the module starts fresh while the entry keeps its number.
    const { browser, router } = await startAt(MOKOTOW, { idx: 1, from: LIST })
    expect(router.lastNavigation().direction).toBe('start')
    expect(browser.window.history.state).toEqual({ idx: 1, from: LIST })

    let wentBack = 0
    browser.window.history.back = () => {
      wentBack += 1
    }
    router.goBack(LIST)
    expect(wentBack).toBe(1)
    expect(browser.hashes()).toEqual([MOKOTOW])
  })

  it.each<[string, unknown]>([
    ['Settings', { idx: 1, from: SETTINGS_HASH }],
    ['nothing it knows of', { idx: 1 }],
    ['something that is not an address', { idx: 1, from: 7 }],
  ])('opens the list in place of a place after a reload, when what is behind it is %s', async (_what, state) => {
    const { browser, router } = await startAt(MOKOTOW, state)
    let wentBack = 0
    browser.window.history.back = () => {
      wentBack += 1
    }
    router.goBack(LIST)
    expect(wentBack).toBe(0)
    expect(browser.hashes()).toEqual([LIST])
    expect(browser.window.history.state).toEqual({ idx: 1 })
  })

  it('treats an entry stamped by something else as a new one', async () => {
    const { browser, router } = await startAt(LIST, { idx: 'three' })
    expect(browser.window.history.state).toEqual({ idx: 0 })
    browser.follow(MOKOTOW)
    expect(router.lastNavigation().direction).toBe('push')
  })
})
