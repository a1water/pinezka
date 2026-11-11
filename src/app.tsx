import { useEffect, useLayoutEffect } from 'react'
import styles from './app.module.css'
import { collections } from './collections/index.ts'
import { SaveAlert, ScreenHeader } from './components/screen-header.tsx'
import { TabBar } from './components/tab-bar.tsx'
import ui from './components/ui.module.css'
import { usePlaceStore } from './data/place-store.ts'
import { DetailScreen } from './features/detail/detail-screen.tsx'
import { ListScreen } from './features/list/list-screen.tsx'
import { SettingsScreen } from './features/settings/settings-screen.tsx'
import { lastNavigation, listHash, parseRoute, placeHash, savedScroll, useRoute } from './router.ts'
import type { Route } from './router.ts'

function screenTitle(route: Route): string {
  switch (route.name) {
    case 'list':
      return route.collection.title
    case 'place':
      return route.place.name
    case 'settings':
      return 'Settings'
    case 'not-found':
      return 'Page not found'
  }
}

/** The frame around every screen: the screen the address stands for, and the tab bar. */
export function App() {
  const { hash, route } = useRoute()
  const status = usePlaceStore((state) => state.status)
  const needsData = route.name === 'list' || route.name === 'place'

  // After a change of screen: put the page where the user expects it and move
  // focus into the new screen. A layout effect, so it happens before the
  // screen is first painted. The saved data is already in memory by then, so
  // a list is at its full height and can be scrolled back to where it was.
  useLayoutEffect(() => {
    const { direction, from } = lastNavigation()
    // The first screen keeps the browser's own focus, and changing the filter
    // is not a change of screen.
    if (direction === 'start' || direction === 'replace') return

    // A screen opened by a link starts at the top; one the user returns to is where they left it.
    window.scrollTo(0, direction === 'push' ? 0 : (savedScroll() ?? 0))

    // Back from a place to its list: focus the card that was opened, so the
    // user is exactly where they were. In every other case, and when a filter
    // hides that card, focus the screen's heading so a screen reader says
    // which screen this is.
    const left = parseRoute(from)
    const card =
      direction === 'back' && route.name === 'list' && left.name === 'place'
        ? document.querySelector<HTMLElement>(`main a[href="${placeHash(left.placeId)}"]`)
        : null
    const target = card ?? document.querySelector<HTMLElement>('main h1')
    // The scroll position was just set on purpose; focusing must not move it.
    target?.focus({ preventScroll: true })
  }, [hash, route])

  useEffect(() => {
    document.title = `${screenTitle(route)} – Pinezka`
  }, [route])

  return (
    <div className={styles.shell}>
      <main className={styles.main} aria-busy={needsData && status === 'loading'}>
        <Screen route={route} />
      </main>
      <TabBar route={route} />
      <SaveAlert />
    </div>
  )
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    // The keys give every collection and every place a fresh screen, so text
    // being typed for one place can never show up on another.
    case 'list':
      return <ListScreen key={route.collection.id} collection={route.collection} show={route.show} />
    case 'place':
      return (
        <DetailScreen key={route.placeId} collection={route.collection} place={route.place} placeId={route.placeId} />
      )
    case 'settings':
      return <SettingsScreen />
    case 'not-found':
      return <NotFound />
  }
}

/** An address that matches nothing. It says so and offers the way out; it never redirects by itself. */
function NotFound() {
  const home = collections[0]

  return (
    <>
      <ScreenHeader title="Page not found" />
      <p className={styles.notFound}>This link does not match anything in Pinezka.</p>
      {home && (
        <a className={`${ui.button} ${styles.notFoundLink}`} href={listHash(home.id)}>
          Go to {home.title}
        </a>
      )}
    </>
  )
}
