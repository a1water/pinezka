import type { MouseEvent } from 'react'
import { collections } from '../collections/index.ts'
import type { Collection } from '../collections/index.ts'
import { goBack, listHash, SETTINGS_HASH } from '../router.ts'
import type { Route } from '../router.ts'
import { GearIcon, GridIcon } from './icons.tsx'
import styles from './ui.module.css'

/**
 * The bar at the bottom of every screen: one tab per collection, then
 * Settings. A collection added to the app gets its tab from here.
 */
export function TabBar({ route }: { route: Route }) {
  return (
    <nav className={styles.tabBar} aria-label="Main">
      <div className={styles.tabs}>
        {collections.map((collection) => (
          <CollectionTab key={collection.id} collection={collection} route={route} />
        ))}
        <a className={styles.tab} href={SETTINGS_HASH} aria-current={route.name === 'settings' ? 'page' : undefined}>
          <GearIcon />
          Settings
        </a>
      </div>
    </nav>
  )
}

function CollectionTab({ collection, route }: { collection: Collection; route: Route }) {
  const onList = route.name === 'list' && route.collection.id === collection.id
  const onPlace = route.name === 'place' && route.collection.id === collection.id
  const href = listHash(collection.id)

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // A click meant for a new tab or window is the browser's to handle.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (onList) {
      // Already there: the tab is the way back to the top of a long list.
      event.preventDefault()
      window.scrollTo({ top: 0 })
    } else if (onPlace) {
      // Back within thumb reach. Going back, not forward to a new copy of the
      // list, returns the list as it was left: same filter, same scroll position.
      event.preventDefault()
      goBack(href)
    }
  }

  return (
    <a
      className={styles.tab}
      href={href}
      // "page" on the list itself; "true" while one of its places is open.
      aria-current={onList ? 'page' : onPlace ? 'true' : undefined}
      onClick={handleClick}
    >
      <GridIcon />
      {collection.title}
    </a>
  )
}
