import { placeStore, usePlaceStore } from '../data/place-store.ts'
import styles from './ui.module.css'

/**
 * What a screen shows in place of its content until the saved data is there:
 * a quiet "Loading…", or why the data could not be opened and what to do.
 * Nothing once the data is loaded.
 */
export function LoadState() {
  const status = usePlaceStore((state) => state.status)
  const error = usePlaceStore((state) => state.loadError)

  if (status === 'ready') return null
  if (status === 'loading' || !error) {
    // Not a live region: the screen is marked busy, and a normal start is over before this shows.
    return <p className={styles.loading}>Loading…</p>
  }

  function tryAgain() {
    // The button is gone as soon as loading starts, and focus would be left
    // on nothing. The heading keeps the user on this screen, and it is still
    // there if opening fails again.
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true })
    void placeStore.load()
  }

  // A newer copy of the app has to take over, and only a reload brings it in.
  const reload = error.kind === 'newer-version'
  return (
    <div className={`${styles.banner} ${styles.loadError}`} role="alert">
      <h2 className={styles.bannerTitle}>{"Pinezka can't open its saved data"}</h2>
      {error.kind === 'newer-version' && <p>{error.message}</p>}
      {error.kind === 'storage-full' && <p>The phone is out of storage space. Free some space, then try again.</p>}
      {error.kind === 'other' && (
        <>
          <p>Something went wrong.</p>
          {error.message !== '' && <p className={styles.small}>{error.message}</p>}
        </>
      )}
      <div className={styles.actions}>
        {reload ? (
          <button type="button" className={`${styles.button} ${styles.buttonMain}`} onClick={() => window.location.reload()}>
            Reload
          </button>
        ) : (
          <button type="button" className={`${styles.button} ${styles.buttonMain}`} onClick={tryAgain}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
