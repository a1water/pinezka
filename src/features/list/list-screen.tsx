import { useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import { placeId } from '../../collections/index.ts'
import type { Collection } from '../../collections/index.ts'
import { LoadState } from '../../components/load-state.tsx'
import { ScreenHeader } from '../../components/screen-header.tsx'
import ui from '../../components/ui.module.css'
import { usePlaceStore } from '../../data/place-store.ts'
import { placeHash, replaceFilter } from '../../router.ts'
import type { ListFilter } from '../../router.ts'
import { formatKm } from '../detail/fields.ts'
import styles from './list.module.css'
import { PlaceCard } from './place-card.tsx'
import { progress } from './progress.ts'
import type { Progress } from './progress.ts'

type ListScreenProps = { collection: Collection; show: ListFilter }

/**
 * A collection as a grid of cards under its totals. Everything on it comes
 * from the collection's own words and fields, so another collection needs no
 * second screen.
 */
export function ListScreen({ collection, show }: ListScreenProps) {
  const status = usePlaceStore((state) => state.status)
  const places = usePlaceStore((state) => state.places)
  const totals = useMemo(() => progress(collection, places.values()), [collection, places])
  const allButton = useRef<HTMLButtonElement>(null)

  if (status !== 'ready') {
    // No numbers and no cards until the data is there: an unloaded card would
    // look exactly like a place that is not done.
    return (
      <>
        <ScreenHeader title={collection.title} />
        <LoadState />
      </>
    )
  }

  const doneWord = collection.doneWord.toLowerCase()
  // Always in the collection's own order, so a card never jumps when it is ticked.
  const cards = collection.places
    .map((place) => ({ place, record: places.get(placeId(collection.id, place.key)) }))
    .filter(({ record }) => show === 'all' || (record?.done ?? false) === (show === 'done'))

  function showAll() {
    replaceFilter(collection.id, 'all')
    // The button that was tapped is gone with the empty state it belonged to.
    allButton.current?.focus()
  }

  return (
    <>
      <ScreenHeader title={collection.title} />
      {/* The backup reminder goes here, above the totals. */}
      <ProgressHeader collection={collection} totals={totals} />
      {totals.done === 0 && !collection.usesTrips && (
        <p className={styles.firstStep}>
          {`No ${collection.title.toLowerCase()} ${doneWord} yet. Tap one to open it, then tick ${collection.doneWord}.`}
        </p>
      )}
      {/* The switch between list and map goes here. */}
      <FilterBar collection={collection} show={show} allButton={allButton} />
      {cards.length > 0 ? (
        <ul className={styles.grid}>
          {cards.map(({ place, record }) => {
            const id = placeId(collection.id, place.key)
            return (
              <PlaceCard
                key={place.key}
                href={placeHash(id)}
                name={place.name}
                done={record?.done ?? false}
                date={record?.date ?? null}
                doneWord={collection.doneWord}
              />
            )
          })}
        </ul>
      ) : (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>{show === 'left' ? 'Nothing left' : `Nothing ${doneWord} yet`}</h2>
          <p className={styles.emptyText}>
            {show === 'left'
              ? `All ${totals.total} ${collection.title.toLowerCase()} are ${doneWord}.`
              : `Open a place from the full list and tick ${collection.doneWord}.`}
          </p>
          <button type="button" className={ui.button} onClick={showAll}>
            Show all
          </button>
        </div>
      )}
    </>
  )
}

/** The totals: how many are done, how many are left, and the distance where the collection has one. */
function ProgressHeader({ collection, totals }: { collection: Collection; totals: Progress }) {
  const { total, done, left, km } = totals
  const doneWord = collection.doneWord.toLowerCase()

  return (
    <section className={styles.progress} aria-label="Progress">
      <div className={styles.progressTop}>
        <p className={styles.doneLine}>
          <span className={styles.count}>{done}</span> of {total} {doneWord}
        </p>
        {collection.fields.includes('km') && (
          <p className={styles.km}>
            <span>{formatKm(km)}</span>
            <span className={ui.visuallyHidden}> in total</span>
          </p>
        )}
      </div>
      {/* The numbers around it say the same, so the bar is not read out a second time. */}
      <div className={styles.bar} aria-hidden="true">
        <div className={styles.barFill} style={{ width: `${total > 0 ? (done / total) * 100 : 0}%` }} />
      </div>
      <p className={styles.leftLine}>{left > 0 ? `${left} left` : `All ${total} ${doneWord}.`}</p>
    </section>
  )
}

type FilterBarProps = {
  collection: Collection
  show: ListFilter
  allButton: RefObject<HTMLButtonElement | null>
}

/**
 * Which places the grid shows. The choice is kept in the address, so it is
 * still set after opening a place and coming back.
 */
function FilterBar({ collection, show, allButton }: FilterBarProps) {
  const options: readonly { value: ListFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'left', label: 'Left' },
    { value: 'done', label: collection.doneWord },
  ]

  return (
    <div className={styles.filter} role="group" aria-label="Show">
      {options.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          className={styles.filterButton}
          ref={value === 'all' ? allButton : undefined}
          aria-pressed={show === value}
          onClick={() => replaceFilter(collection.id, value)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
