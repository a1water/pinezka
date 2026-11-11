import { describe, expect, it } from 'vitest'
import { warsawDistricts } from '../../collections/index.ts'
import type { Place } from '../../data/types.ts'
import { progress } from './progress.ts'

function place(key: string, changes: Partial<Place> = {}): Place {
  return {
    id: `warsaw-districts/${key}`,
    collectionId: 'warsaw-districts',
    done: false,
    date: null,
    km: null,
    stravaUrl: '',
    notes: '',
    photoIds: [],
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...changes,
  }
}

describe('progress totals', () => {
  it('starts at nothing done, with every district left', () => {
    const untouched = warsawDistricts.places.map(({ key }) => place(key))
    expect(progress(warsawDistricts, untouched)).toEqual({ total: 18, done: 0, left: 18, km: 0 })
  })

  it('counts ticked districts and adds up the distances', () => {
    const places = [
      place('bemowo', { done: true, km: 12.4 }),
      place('wola', { done: true, km: 8 }),
      place('ursus', { done: false, km: null }),
    ]
    expect(progress(warsawDistricts, places)).toEqual({ total: 18, done: 2, left: 16, km: 20.4 })
  })

  it('adds a distance even when its district is not ticked yet', () => {
    const places = [place('bemowo', { done: false, km: 5 }), place('wola', { done: true })]
    expect(progress(warsawDistricts, places)).toEqual({ total: 18, done: 1, left: 17, km: 5 })
  })

  it('adds decimals without rounding errors', () => {
    const places = [place('bemowo', { km: 0.1 }), place('wola', { km: 0.2 }), place('ursus', { km: 10.55 })]
    expect(progress(warsawDistricts, places).km).toBe(10.85)
  })

  it('reaches everything done', () => {
    const all = warsawDistricts.places.map(({ key }) => place(key, { done: true, km: 10 }))
    expect(progress(warsawDistricts, all)).toEqual({ total: 18, done: 18, left: 0, km: 180 })
  })

  it('ignores places of other collections and works with no records at all', () => {
    const other = { ...place('es', { done: true, km: 99 }), id: 'countries/ES', collectionId: 'countries' }
    expect(progress(warsawDistricts, [other])).toEqual({ total: 18, done: 0, left: 18, km: 0 })
    expect(progress(warsawDistricts, [])).toEqual({ total: 18, done: 0, left: 18, km: 0 })
  })
})
