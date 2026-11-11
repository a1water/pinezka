import { useEffect, useState } from 'react'
import styles from './app.module.css'
import { placeId, warsawDistricts } from './collections/index.ts'
import { appDb, getMeta, listPlaces, updatePlace } from './data/db.ts'
import type { Meta, Place } from './data/types.ts'

// A plain screen for checking the data layer on the phone. The real district
// list and detail screens replace it in the next milestone.

type Loaded = { places: Map<string, Place>; meta: Meta }

async function load(): Promise<Loaded> {
  const db = await appDb()
  const [places, meta] = await Promise.all([listPlaces(db, warsawDistricts.id), getMeta(db)])
  return { places: new Map(places.map((place) => [place.id, place])), meta }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function when(timestamp: string | null): string {
  return timestamp ? new Date(timestamp).toLocaleString() : 'nothing yet'
}

export function App() {
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)

  useEffect(() => {
    let current = true
    load().then(
      (loaded) => current && setData(loaded),
      (failure: unknown) => current && setError(describe(failure)),
    )
    return () => {
      current = false
    }
  }, [])

  async function setDone(id: string, done: boolean) {
    // Show the tick at once. If saving fails, the screen goes back to what it showed before.
    const before = data
    setData((shown) => {
      const place = shown?.places.get(id)
      if (!shown || !place) return shown
      return { ...shown, places: new Map(shown.places).set(id, { ...place, done }) }
    })
    setSaving((count) => count + 1)
    try {
      await updatePlace(await appDb(), id, { done })
      setData(await load())
      setError(null)
    } catch (failure) {
      setError(describe(failure))
      setData(await load().catch(() => before))
    } finally {
      setSaving((count) => count - 1)
    }
  }

  const doneCount = data ? [...data.places.values()].filter((place) => place.done).length : 0

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <svg className={styles.pin} viewBox="0 0 64 64" aria-hidden="true">
          <path d="M32 4c-11 0-20 8.7-20 19.5C12 38 32 60 32 60s20-22 20-36.5C52 12.7 43 4 32 4z" />
          <circle cx="32" cy="23.5" r="7.5" />
        </svg>
        <h1 className={styles.title}>Pinezka</h1>
      </header>

      {error && (
        <p className={styles.error} role="alert">
          Something went wrong with the saved data: {error}
        </p>
      )}

      {data && (
        <>
          <p className={styles.lead}>
            Tick a few districts, close this tab and open it again. The ticks should still be there.
          </p>
          <dl className={styles.facts}>
            <dt>Districts done</dt>
            <dd>
              {doneCount} of {warsawDistricts.places.length}
            </dd>
            <dt>Data created</dt>
            <dd>{when(data.meta.createdAt)}</dd>
            <dt>Last change</dt>
            <dd>{when(data.meta.lastChangeAt)}</dd>
            <dt>Status</dt>
            <dd role="status">{saving > 0 ? 'Saving…' : error ? 'Not saved' : 'Everything is saved'}</dd>
          </dl>
          <ul className={styles.list}>
            {warsawDistricts.places.map(({ key, name }) => {
              const id = placeId(warsawDistricts.id, key)
              return (
                <li key={key}>
                  <label className={styles.row}>
                    <input
                      type="checkbox"
                      checked={data.places.get(id)?.done ?? false}
                      onChange={(event) => void setDone(id, event.target.checked)}
                    />
                    {name}
                  </label>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className={styles.build}>Build {__BUILD_ID__}</p>
    </main>
  )
}
