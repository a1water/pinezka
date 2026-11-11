/** Extra fields a collection's detail screen shows beyond the common ones. */
export type PlaceField = 'km' | 'stravaUrl'

/** One place in a collection's bundled list. Names are never stored in the database. */
export type PlaceDefinition = {
  /** Stable part of the stored place id. Never change one after release. */
  key: string
  /** Polish name. */
  name: string
}

/** A collection is defined in code. Only its places' state is stored. */
export type Collection = {
  id: string
  title: string
  /** What a finished place is called: "Done" or "Visited". */
  doneWord: string
  places: readonly PlaceDefinition[]
  fields: readonly PlaceField[]
  /** `false`: a place is done by its tick. `true`: a place is done once it has a trip. */
  usesTrips: boolean
  /** Bundled GeoJSON for the map, relative to the app's base URL. */
  shapesFile: string
  /** What a photo's label is called: "Spot" or "City". */
  photoLabel: string
  /** `true`: every place gets a record on first run. `false`: on first edit. */
  seeded: boolean
}
