import type { DBSchema } from 'idb'

/** The stored state of one place. Its name lives in the bundled collection, not here. */
export type Place = {
  /** Collection and key, for example `warsaw-districts/praga-poludnie`. */
  id: string
  collectionId: string
  /** Districts only. A country is visited once it has a trip. */
  done: boolean
  /** Districts only. The run date, `YYYY-MM-DD`. */
  date: string | null
  /** Districts only. */
  km: number | null
  /** Districts only. */
  stravaUrl: string
  notes: string
  /** Districts only. Ordered, no limit. */
  photoIds: string[]
  /** ISO timestamp. */
  updatedAt: string
}

export type Photo = {
  /** UUID. */
  id: string
  placeId: string
  /** Set for country photos, which belong to a trip. */
  tripId: string | null
  /** JPEG, long edge at most 2048 px. */
  image: Blob
  /** JPEG, long edge 400 px. */
  thumb: Blob
  label: string
  caption: string
  /** The star. */
  favourite: boolean
  /** From the file's last-modified time. ISO timestamp. */
  takenAt: string | null
  /** ISO timestamp. */
  createdAt: string
}

/** One record describing the database as a whole. */
export type Meta = {
  schemaVersion: number
  createdAt: string
  lastBackupAt: string | null
  /** The last time the user changed anything. Seeding does not count. */
  lastChangeAt: string | null
}

export interface PinezkaSchema extends DBSchema {
  places: {
    key: string
    value: Place
    indexes: { collectionId: string }
  }
  photos: {
    key: string
    value: Photo
    indexes: { placeId: string; tripId: string }
  }
  meta: {
    key: string
    value: Meta
  }
}
