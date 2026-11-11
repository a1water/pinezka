import type { Collection } from '../../collections/index.ts'
import type { Place } from '../../data/types.ts'

export type Progress = {
  /** Places in the collection. */
  total: number
  done: number
  left: number
  /** Sum of every distance entered, in km. */
  km: number
}

/** The header totals. They are worked out from the places each time and never stored. */
export function progress(collection: Collection, places: Iterable<Place>): Progress {
  const total = collection.places.length
  let done = 0
  // Summed in whole metres, so 0.1 + 0.2 comes out as 0.3.
  let metres = 0
  for (const place of places) {
    if (place.collectionId !== collection.id) continue
    if (place.done) done += 1
    if (place.km !== null) metres += Math.round(place.km * 1000)
  }
  return { total, done, left: total - done, km: metres / 1000 }
}
