import type { Collection, PlaceDefinition } from './types.ts'
import { warsawDistricts } from './warsaw-districts.ts'

export type { Collection, PlaceDefinition, PlaceField } from './types.ts'
export { warsawDistricts }

/** Every collection the app knows. Version 2 adds the countries here. */
export const collections: readonly Collection[] = [warsawDistricts]

export function getCollection(collectionId: string): Collection | undefined {
  return collections.find((collection) => collection.id === collectionId)
}

/** The stored id of a place, for example `warsaw-districts/praga-poludnie`. */
export function placeId(collectionId: string, key: string): string {
  return `${collectionId}/${key}`
}

export type PlaceRef = { collection: Collection; place: PlaceDefinition }

/** Finds the collection and bundled place a stored place id points at. */
export function findPlace(id: string): PlaceRef | undefined {
  const slash = id.indexOf('/')
  if (slash < 0) return undefined
  const collection = getCollection(id.slice(0, slash))
  const key = id.slice(slash + 1)
  const place = collection?.places.find((candidate) => candidate.key === key)
  return collection && place ? { collection, place } : undefined
}
