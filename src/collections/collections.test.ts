import { describe, expect, it } from 'vitest'
import { collections, findPlace, getCollection, placeId, warsawDistricts } from './index.ts'

// The list from PLAN.md, Polish letters included.
const DISTRICTS = [
  'Bemowo',
  'Białołęka',
  'Bielany',
  'Mokotów',
  'Ochota',
  'Praga-Południe',
  'Praga-Północ',
  'Rembertów',
  'Śródmieście',
  'Targówek',
  'Ursus',
  'Ursynów',
  'Wawer',
  'Wesoła',
  'Wilanów',
  'Włochy',
  'Wola',
  'Żoliborz',
]

describe('Warsaw districts', () => {
  it('lists exactly the 18 districts by their Polish names', () => {
    expect(warsawDistricts.places.map((place) => place.name)).toEqual(DISTRICTS)
  })

  it('writes every name in composed Unicode, so it matches typed and map names', () => {
    for (const { name } of warsawDistricts.places) expect(name).toBe(name.normalize('NFC'))
  })

  it('gives every district its own plain-letter key', () => {
    const keys = warsawDistricts.places.map((place) => place.key)
    expect(new Set(keys).size).toBe(18)
    for (const key of keys) expect(key).toMatch(/^[a-z]+(-[a-z]+)*$/)
  })

  it('derives each key from the name with Polish letters replaced', () => {
    const plain: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
    for (const { key, name } of warsawDistricts.places) {
      const expected = [...name.toLowerCase()].map((letter) => plain[letter] ?? letter).join('')
      expect(key).toBe(expected)
    }
  })

  it('is set up as the plan describes', () => {
    expect(warsawDistricts).toMatchObject({
      id: 'warsaw-districts',
      title: 'Districts',
      doneWord: 'Done',
      fields: ['km', 'stravaUrl'],
      usesTrips: false,
      shapesFile: 'districts.geojson',
      photoLabel: 'Spot',
      seeded: true,
    })
  })
})

describe('collection lookup', () => {
  it('gives every collection its own id', () => {
    const ids = collections.map((collection) => collection.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).not.toContain('/')
  })

  it('finds a collection by id', () => {
    expect(getCollection('warsaw-districts')).toBe(warsawDistricts)
    expect(getCollection('nowhere')).toBeUndefined()
  })

  it('builds place ids from collection and key', () => {
    expect(placeId('warsaw-districts', 'praga-poludnie')).toBe('warsaw-districts/praga-poludnie')
  })

  it('finds the bundled place behind a stored id', () => {
    const ref = findPlace('warsaw-districts/zoliborz')
    expect(ref?.collection).toBe(warsawDistricts)
    expect(ref?.place.name).toBe('Żoliborz')
  })

  it('finds nothing for ids it does not know', () => {
    expect(findPlace('warsaw-districts/atlantis')).toBeUndefined()
    expect(findPlace('countries/ES')).toBeUndefined()
    expect(findPlace('zoliborz')).toBeUndefined()
    expect(findPlace('')).toBeUndefined()
  })
})
