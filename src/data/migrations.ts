import type { IDBPDatabase, IDBPTransaction, StoreNames } from 'idb'
import type { PinezkaSchema } from './types.ts'

/**
 * The version of the stored data's shape. It is the IndexedDB version, the
 * `schemaVersion` in the meta record, and the `schemaVersion` of a backup file.
 * To change the shape: add 1 here and add a migration with that number below.
 */
export const SCHEMA_VERSION = 1

export type UpgradeTransaction = IDBPTransaction<
  PinezkaSchema,
  StoreNames<PinezkaSchema>[],
  'versionchange'
>

/**
 * Takes the database from the version before to this one, inside the upgrade
 * transaction. It may be async, but may only await requests of that
 * transaction. Awaiting anything else lets the upgrade commit before the
 * migration has finished, and a later failure can then no longer be undone.
 */
export type Migration = (db: IDBPDatabase<PinezkaSchema>, tx: UpgradeTransaction) => void | Promise<void>

export const migrations: Readonly<Record<number, Migration>> = {
  // Version 1: the collection model. Districts use places and photos now;
  // countries later add a trips store without touching these records.
  1: (db) => {
    const places = db.createObjectStore('places', { keyPath: 'id' })
    places.createIndex('collectionId', 'collectionId')

    const photos = db.createObjectStore('photos', { keyPath: 'id' })
    photos.createIndex('placeId', 'placeId')
    // Photos with no trip have `tripId: null`, which IndexedDB leaves out of the index.
    photos.createIndex('tripId', 'tripId')

    db.createObjectStore('meta')
  },
}

/**
 * Runs every migration after `oldVersion` up to `newVersion`, in order, each
 * one finishing before the next starts. It rejects when a migration fails or
 * is missing; the caller must then abort the upgrade.
 */
export async function runMigrations(
  db: IDBPDatabase<PinezkaSchema>,
  tx: UpgradeTransaction,
  oldVersion: number,
  newVersion: number,
  steps: Readonly<Record<number, Migration>> = migrations,
): Promise<void> {
  for (let version = oldVersion + 1; version <= newVersion; version += 1) {
    const migrate = steps[version]
    if (!migrate) throw new Error(`There is no migration to schema version ${version}`)
    await migrate(db, tx)
  }
}
