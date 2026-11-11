import { openDB } from 'idb'
import type { IDBPDatabase, IDBPObjectStore, IDBPTransaction, StoreNames } from 'idb'
import { collections, findPlace, placeId } from '../collections/index.ts'
import { migrations, runMigrations, SCHEMA_VERSION } from './migrations.ts'
import type { Migration } from './migrations.ts'
import type { Meta, Photo, PinezkaSchema, Place } from './types.ts'

// GitHub Pages serves every project of one account from the same origin, and
// IndexedDB is shared per origin, so the name must be the app's own.
export const DB_NAME = 'pinezka'
const META_KEY = 'app'

export type AppDb = IDBPDatabase<PinezkaSchema>
type Stores = StoreNames<PinezkaSchema>

export type OpenOptions = {
  name?: string
  /** For tests: open at another schema version with other migrations. */
  version?: number
  migrations?: Readonly<Record<number, Migration>>
  /** Called when the connection stops working: another copy took over, or the browser closed it. */
  onClosed?: () => void
}

/** Opens the database, upgrades it if needed, and creates the first-run records. */
export async function openAppDb(options: OpenOptions = {}): Promise<AppDb> {
  const version = options.version ?? SCHEMA_VERSION
  let db: AppDb
  let failedMigration: unknown
  try {
    db = await openDB<PinezkaSchema>(options.name ?? DB_NAME, version, {
      upgrade(database, oldVersion, newVersion, tx) {
        const steps = options.migrations ?? migrations
        runMigrations(database, tx, oldVersion, newVersion ?? version, steps).catch((error: unknown) => {
          // Roll the upgrade back, so the data stays as the old version left it.
          failedMigration = error
          tx.done.catch(() => {})
          try {
            tx.abort()
          } catch {
            // Already finished: see the rule on what a migration may await.
          }
        })
      },
      // A newer copy of the app wants to upgrade the data. Let it: holding
      // the connection open would block that copy for good.
      blocking(_currentVersion, _blockedVersion, event) {
        ;(event.target as IDBDatabase).close()
        options.onClosed?.()
      },
      // The browser closed the connection itself, for example when site data was cleared.
      terminated() {
        options.onClosed?.()
      },
    })
  } catch (error) {
    if (failedMigration !== undefined) throw failedMigration
    if (error instanceof DOMException && error.name === 'VersionError') {
      throw new Error(
        'This data was saved by a newer version of Pinezka. Close every Pinezka tab and open the app again to update.',
        { cause: error },
      )
    }
    throw error
  }
  await initialise(db, version)
  return db
}

let shared: Promise<AppDb> | undefined

/**
 * The app's one database connection, opened on first use. Ask for it before
 * every operation and do not keep the result: when a connection closes or
 * fails to open it is forgotten, and the next call opens a new one.
 */
export function appDb(): Promise<AppDb> {
  if (shared) return shared
  // Forgets only this connection, never a newer one that replaced it.
  const forget = () => {
    if (shared === mine) shared = undefined
  }
  const mine: Promise<AppDb> = openAppDb({ onClosed: forget }).catch((error: unknown) => {
    forget()
    throw error
  })
  shared = mine
  return mine
}

/**
 * Creates what a fresh database needs: the meta record and a record for every
 * place of a seeded collection. Safe to run on every start; it only adds what is missing.
 */
async function initialise(db: AppDb, version: number): Promise<void> {
  const tx = db.transaction(['places', 'meta'], 'readwrite')
  await settle(tx, async () => {
    const now = new Date().toISOString()
    const metaStore = tx.objectStore('meta')
    const meta = await metaStore.get(META_KEY)
    if (!meta) {
      await metaStore.put(
        { schemaVersion: version, createdAt: now, lastBackupAt: null, lastChangeAt: null },
        META_KEY,
      )
    } else if (meta.schemaVersion !== version) {
      await metaStore.put({ ...meta, schemaVersion: version }, META_KEY)
    }

    const placeStore = tx.objectStore('places')
    for (const collection of collections) {
      if (!collection.seeded) continue
      const stored = new Set(await placeStore.index('collectionId').getAllKeys(collection.id))
      for (const { key } of collection.places) {
        const id = placeId(collection.id, key)
        if (!stored.has(id)) await placeStore.add(newPlace(id, collection.id, now))
      }
    }
  })
}

function newPlace(id: string, collectionId: string, now: string): Place {
  return {
    id,
    collectionId,
    done: false,
    date: null,
    km: null,
    stravaUrl: '',
    notes: '',
    photoIds: [],
    updatedAt: now,
  }
}

/**
 * Finishes a transaction: waits for it to commit, or rolls back everything it
 * wrote when `work` fails. The work must only wait for IndexedDB requests.
 */
async function settle<T, S extends Stores[], M extends IDBTransactionMode>(
  tx: IDBPTransaction<PinezkaSchema, S, M>,
  work: () => Promise<T>,
): Promise<T> {
  try {
    const result = await work()
    await tx.done
    return result
  } catch (error) {
    tx.done.catch(() => {})
    try {
      tx.abort()
    } catch {
      // Already aborted or finished.
    }
    // A failed commit (a full disk, for example) reports its reason on the transaction.
    throw tx.error ?? error
  }
}

/** Records that the user changed something, for the backup reminder. */
async function touch<S extends Stores[]>(
  store: IDBPObjectStore<PinezkaSchema, S, 'meta', 'readwrite'>,
  now: string,
): Promise<void> {
  const meta = await store.get(META_KEY)
  if (!meta) throw new Error('The database has no meta record')
  await store.put({ ...meta, lastChangeAt: now }, META_KEY)
}

// ----- Meta -----

export async function getMeta(db: AppDb): Promise<Meta> {
  const meta = await db.get('meta', META_KEY)
  if (!meta) throw new Error('The database has no meta record')
  return meta
}

// ----- Places -----

/** The stored places of one collection. A place with no record yet is not in the list. */
export function listPlaces(db: AppDb, collectionId: string): Promise<Place[]> {
  return db.getAllFromIndex('places', 'collectionId', collectionId)
}

export function getPlace(db: AppDb, id: string): Promise<Place | undefined> {
  return db.get('places', id)
}

/** The fields of a place the user edits. Photos have their own functions. */
export type PlacePatch = Partial<Pick<Place, 'done' | 'date' | 'km' | 'stravaUrl' | 'notes'>>

/**
 * Saves changed fields of a place and returns the record. A place of a
 * collection that is not seeded gets its record on the first edit that changes
 * something; until then an untouched record is returned and nothing is stored.
 */
export async function updatePlace(db: AppDb, id: string, patch: PlacePatch): Promise<Place> {
  const ref = findPlace(id)
  if (!ref) throw new Error(`Unknown place: ${id}`)
  const changes = checkPlacePatch(patch)

  const tx = db.transaction(['places', 'meta'], 'readwrite')
  return settle(tx, async () => {
    const now = new Date().toISOString()
    const store = tx.objectStore('places')
    const stored = await store.get(id)
    const current = stored ?? newPlace(id, ref.collection.id, now)
    // Autosave calls this often. Saving the same values again is not a change.
    if (isSame(current, changes)) return current
    const next: Place = { ...current, ...changes, updatedAt: now }
    await store.put(next)
    await touch(tx.objectStore('meta'), now)
    return next
  })
}

function checkPlacePatch(patch: PlacePatch): PlacePatch {
  const clean: PlacePatch = {}
  if (patch.done !== undefined) {
    if (typeof patch.done !== 'boolean') throw new TypeError('done must be true or false')
    clean.done = patch.done
  }
  if (patch.date !== undefined) {
    if (patch.date !== null && !isCalendarDate(patch.date)) {
      throw new RangeError('date must be a real date written as YYYY-MM-DD, or null')
    }
    clean.date = patch.date
  }
  if (patch.km !== undefined) {
    if (patch.km !== null && !(typeof patch.km === 'number' && Number.isFinite(patch.km) && patch.km >= 0)) {
      throw new RangeError('km must be zero or more, or null')
    }
    clean.km = patch.km
  }
  if (patch.stravaUrl !== undefined) {
    if (typeof patch.stravaUrl !== 'string') throw new TypeError('stravaUrl must be text')
    clean.stravaUrl = patch.stravaUrl
  }
  if (patch.notes !== undefined) {
    if (typeof patch.notes !== 'string') throw new TypeError('notes must be text')
    clean.notes = patch.notes
  }
  return clean
}

/** True for a date that exists, written as `YYYY-MM-DD`. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isSame<T extends object>(current: T, changes: Partial<T>): boolean {
  return (Object.keys(changes) as (keyof T)[]).every((key) => Object.is(current[key], changes[key]))
}

// ----- Photos -----

export type NewPhoto = {
  placeId: string
  image: Blob
  thumb: Blob
  label?: string
  caption?: string
  favourite?: boolean
  takenAt?: string | null
}

/** Stores a photo and adds it to the end of its place's photo list. */
export async function addPhoto(db: AppDb, input: NewPhoto): Promise<Photo> {
  const ref = findPlace(input.placeId)
  if (!ref) throw new Error(`Unknown place: ${input.placeId}`)
  if (ref.collection.usesTrips) throw new Error('Photos of this collection are added to a trip')
  if (!isFilledBlob(input.image) || !isFilledBlob(input.thumb)) {
    throw new TypeError('A photo needs an image and a thumbnail, neither of them empty')
  }

  const now = new Date().toISOString()
  const photo: Photo = {
    id: crypto.randomUUID(),
    placeId: input.placeId,
    tripId: null,
    image: input.image,
    thumb: input.thumb,
    label: input.label ?? '',
    caption: input.caption ?? '',
    favourite: input.favourite ?? false,
    takenAt: input.takenAt ?? null,
    createdAt: now,
  }

  const tx = db.transaction(['places', 'photos', 'meta'], 'readwrite')
  return settle(tx, async () => {
    const places = tx.objectStore('places')
    const place = (await places.get(photo.placeId)) ?? newPlace(photo.placeId, ref.collection.id, now)
    await tx.objectStore('photos').add(photo)
    await places.put({ ...place, photoIds: [...place.photoIds, photo.id], updatedAt: now })
    await touch(tx.objectStore('meta'), now)
    return photo
  })
}

function isFilledBlob(value: unknown): value is Blob {
  return value instanceof Blob && value.size > 0
}

export function getPhoto(db: AppDb, id: string): Promise<Photo | undefined> {
  return db.get('photos', id)
}

/** A place's photos, in the order the place keeps them. */
export async function listPhotos(db: AppDb, placeId: string): Promise<Photo[]> {
  const tx = db.transaction(['places', 'photos'], 'readonly')
  return settle(tx, async () => {
    const place = await tx.objectStore('places').get(placeId)
    if (!place) return []
    const store = tx.objectStore('photos')
    const photos = await Promise.all(place.photoIds.map((id) => store.get(id)))
    return photos.filter((photo) => photo !== undefined)
  })
}

/** The fields of a photo the user edits. */
export type PhotoPatch = Partial<Pick<Photo, 'label' | 'caption' | 'favourite'>>

export async function updatePhoto(db: AppDb, id: string, patch: PhotoPatch): Promise<Photo> {
  const changes = checkPhotoPatch(patch)
  const tx = db.transaction(['photos', 'meta'], 'readwrite')
  return settle(tx, async () => {
    const store = tx.objectStore('photos')
    const current = await store.get(id)
    if (!current) throw new Error(`Unknown photo: ${id}`)
    if (isSame(current, changes)) return current
    const next: Photo = { ...current, ...changes }
    await store.put(next)
    await touch(tx.objectStore('meta'), new Date().toISOString())
    return next
  })
}

function checkPhotoPatch(patch: PhotoPatch): PhotoPatch {
  const clean: PhotoPatch = {}
  if (patch.label !== undefined) {
    if (typeof patch.label !== 'string') throw new TypeError('label must be text')
    clean.label = patch.label
  }
  if (patch.caption !== undefined) {
    if (typeof patch.caption !== 'string') throw new TypeError('caption must be text')
    clean.caption = patch.caption
  }
  if (patch.favourite !== undefined) {
    if (typeof patch.favourite !== 'boolean') throw new TypeError('favourite must be true or false')
    clean.favourite = patch.favourite
  }
  return clean
}

/** Deletes a photo and takes it off its place's list. Deleting a missing photo does nothing. */
export async function deletePhoto(db: AppDb, id: string): Promise<void> {
  const tx = db.transaction(['places', 'photos', 'meta'], 'readwrite')
  await settle(tx, async () => {
    const photos = tx.objectStore('photos')
    const photo = await photos.get(id)
    if (!photo) return
    const now = new Date().toISOString()
    await photos.delete(id)
    const places = tx.objectStore('places')
    const place = await places.get(photo.placeId)
    if (place) {
      const photoIds = place.photoIds.filter((photoId) => photoId !== id)
      await places.put({ ...place, photoIds, updatedAt: now })
    }
    await touch(tx.objectStore('meta'), now)
  })
}

/** Saves a new order for a place's photos. The list must hold exactly the place's photos. */
export async function reorderPhotos(db: AppDb, placeId: string, photoIds: readonly string[]): Promise<Place> {
  const tx = db.transaction(['places', 'meta'], 'readwrite')
  return settle(tx, async () => {
    const store = tx.objectStore('places')
    const place = await store.get(placeId)
    if (!place) throw new Error(`Unknown place: ${placeId}`)
    const wanted = new Set(photoIds)
    const sameMembers =
      wanted.size === photoIds.length &&
      photoIds.length === place.photoIds.length &&
      place.photoIds.every((id) => wanted.has(id))
    if (!sameMembers) throw new Error('The new order must list every photo of the place exactly once')
    if (place.photoIds.every((id, index) => id === photoIds[index])) return place

    const now = new Date().toISOString()
    const next: Place = { ...place, photoIds: [...photoIds], updatedAt: now }
    await store.put(next)
    await touch(tx.objectStore('meta'), now)
    return next
  })
}
