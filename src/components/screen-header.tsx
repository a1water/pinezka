import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { findPlace } from '../collections/index.ts'
import type { PlacePatch } from '../data/db.ts'
import { placeStore, usePlaceStore } from '../data/place-store.ts'
import { ChevronLeftIcon, WarningIcon } from './icons.tsx'
import styles from './ui.module.css'

type ScreenHeaderProps = {
  title: string
  /** The language of the title when it is not English, so a screen reader says it right. */
  titleLang?: string
  back?: { label: string; onBack: () => void }
  /** Shown at the right of the title. */
  status?: ReactNode
}

/**
 * The bar at the top of every screen, with the screen's one heading. It stays
 * in place while the page scrolls. A save that failed is explained right under
 * it, on whichever screen the user is on by then.
 */
export function ScreenHeader({ title, titleLang, back, status }: ScreenHeaderProps) {
  const phase = usePlaceStore((state) => state.save.phase)
  const showBanner = phase === 'failed' || phase === 'blocked'
  const bar = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const usedBanner = useRef(false)

  // The bar stays over the page while it scrolls, and with the banner it is
  // several times its usual height. The page is told how tall it really is,
  // so a field that takes focus is scrolled to below it and not underneath.
  // It goes into a variable of its own: the bar's own minimum height is
  // --header-h, and writing the measurement there would make the bar grow
  // with every measurement.
  useEffect(() => {
    const element = bar.current
    if (!element) return
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.setProperty('--header-now', `${Math.ceil(element.getBoundingClientRect().height)}px`)
    })
    observer.observe(element, { box: 'border-box' })
    return () => {
      observer.disconnect()
      root.style.removeProperty('--header-now')
    }
  }, [])

  // A banner button removes the banner, and itself with it. Focus would fall
  // back to the top of the document; the heading keeps the user on this screen.
  useEffect(() => {
    if (showBanner || !usedBanner.current) return
    usedBanner.current = false
    heading.current?.focus({ preventScroll: true })
  }, [showBanner])

  return (
    <header className={styles.header} ref={bar}>
      <div className={styles.headerRow}>
        {back && (
          <button type="button" className={styles.back} aria-label={back.label} onClick={back.onBack}>
            <ChevronLeftIcon />
          </button>
        )}
        <h1 className={styles.title} ref={heading} tabIndex={-1}>
          {titleLang ? <span lang={titleLang}>{title}</span> : title}
        </h1>
        {status !== undefined && <div className={styles.status}>{status}</div>}
      </div>
      {showBanner && (
        <SaveBanner
          onUse={() => {
            usedBanner.current = true
          }}
        />
      )}
    </header>
  )
}

const BLOCKED_TEXT = 'A newer version of Pinezka has updated your data, so this copy can no longer save.'

/** Which edits are not saved: the place by name, or how many places. */
function UnsavedLine({ unsaved }: { unsaved: ReadonlyMap<string, PlacePatch> }) {
  if (unsaved.size !== 1) return <>Your changes to {unsaved.size} places are not saved.</>
  const [id] = unsaved.keys()
  const name = id === undefined ? undefined : findPlace(id)?.place.name
  if (name === undefined) return <>Your change is not saved.</>
  return (
    <>
      Your change to <span lang="pl">{name}</span> is not saved.
    </>
  )
}

/**
 * Tells the user what is not saved and what they can do about it. It is not a
 * live region: SaveAlert announces the failure once, and this one would be
 * read out again on every change of screen.
 */
function SaveBanner({ onUse }: { onUse: () => void }) {
  const save = usePlaceStore((state) => state.save)
  const unsaved = usePlaceStore((state) => state.unsaved)

  if (save.phase === 'blocked') {
    return (
      <section className={styles.banner} aria-label="Not saved">
        <p className={styles.bannerLead}>{BLOCKED_TEXT}</p>
        {unsaved.size > 0 && (
          <p>
            {save.journaled
              ? 'Your unsaved change is kept and will be saved after the update.'
              : 'Your last change was not saved.'}
          </p>
        )}
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.buttonMain}`} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </section>
    )
  }

  function tryAgain() {
    onUse()
    placeStore.retry()
  }

  function discard() {
    onUse()
    // A field still being edited holds its own text. Leaving it first lets it
    // fall back to the stored value together with everything else.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    placeStore.discard()
  }

  return (
    <section className={styles.banner} aria-label="Not saved">
      <p className={styles.bannerTitle}>
        <WarningIcon className={styles.bannerIcon} size={20} />
        Not saved
      </p>
      <p>
        <UnsavedLine unsaved={unsaved} />
      </p>
      {save.error?.kind === 'storage-full' ? (
        <p>The phone is out of storage space. Free some space, then try again.</p>
      ) : (
        <>
          <p>Something went wrong while saving.</p>
          {save.error && save.error.message !== '' && <p className={styles.small}>{save.error.message}</p>}
        </>
      )}
      {!save.journaled && <p>Keep Pinezka open until this is saved.</p>}
      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.buttonMain}`} onClick={tryAgain}>
          Try again
        </button>
        <button type="button" className={styles.button} onClick={discard}>
          Discard
        </button>
      </div>
    </section>
  )
}

/**
 * Announces a failed save to screen readers, once. It is drawn nowhere and is
 * mounted for the whole life of the app, outside the screens, so moving to
 * another screen does not make it speak again.
 */
export function SaveAlert() {
  const phase = usePlaceStore((state) => state.save.phase)
  const unsaved = usePlaceStore((state) => state.unsaved)

  return (
    <div className={styles.visuallyHidden} role="alert">
      {phase === 'failed' && (
        <>
          <p>Not saved</p>
          <p>
            <UnsavedLine unsaved={unsaved} />
          </p>
        </>
      )}
      {phase === 'blocked' && <p>{BLOCKED_TEXT}</p>}
    </div>
  )
}
