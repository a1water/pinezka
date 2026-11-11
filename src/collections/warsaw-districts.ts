import type { Collection } from './types.ts'

export const warsawDistricts: Collection = {
  id: 'warsaw-districts',
  title: 'Districts',
  doneWord: 'Done',
  // In Polish alphabetical order, which is the order the list shows them in.
  places: [
    { key: 'bemowo', name: 'Bemowo' },
    { key: 'bialoleka', name: 'Białołęka' },
    { key: 'bielany', name: 'Bielany' },
    { key: 'mokotow', name: 'Mokotów' },
    { key: 'ochota', name: 'Ochota' },
    { key: 'praga-poludnie', name: 'Praga-Południe' },
    { key: 'praga-polnoc', name: 'Praga-Północ' },
    { key: 'rembertow', name: 'Rembertów' },
    { key: 'srodmiescie', name: 'Śródmieście' },
    { key: 'targowek', name: 'Targówek' },
    { key: 'ursus', name: 'Ursus' },
    { key: 'ursynow', name: 'Ursynów' },
    { key: 'wawer', name: 'Wawer' },
    { key: 'wesola', name: 'Wesoła' },
    { key: 'wilanow', name: 'Wilanów' },
    { key: 'wlochy', name: 'Włochy' },
    { key: 'wola', name: 'Wola' },
    { key: 'zoliborz', name: 'Żoliborz' },
  ],
  fields: ['km', 'stravaUrl'],
  usesTrips: false,
  shapesFile: 'districts.geojson',
  photoLabel: 'Spot',
  seeded: true,
}
