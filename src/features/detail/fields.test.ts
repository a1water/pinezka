import { afterEach, describe, expect, it } from 'vitest'
import { getPlace, openAppDb, updatePlace } from '../../data/db.ts'
import type { AppDb } from '../../data/db.ts'
import { formatDay, formatKm, kmText, parseKm, parseLink, today, webLink } from './fields.ts'

const KM_ACCEPTED: [string, number | null][] = [
  ['12.4', 12.4],
  ['12,4', 12.4],
  ['10', 10],
  ['0', 0],
  ['0,5', 0.5],
  ['.5', 0.5],
  [',5', 0.5],
  ['7.', 7],
  ['  21,1  ', 21.1],
  ['42.195', 42.195],
  ['', null],
  ['   ', null],
]

describe('km as typed', () => {
  it.each(KM_ACCEPTED)('reads %j as %j', (text, value) => {
    expect(parseKm(text)).toEqual({ ok: true, value })
  })

  it.each(['12,4,5', '1.2.3', 'ten', '12 km', '-3', '+3', '1e3', '.', ',', '1 000', '12,4.5', 'NaN', 'Infinity'])(
    'does not accept %j',
    (text) => {
      expect(parseKm(text)).toEqual({ ok: false })
    },
  )

  it('writes a stored distance back as text that reads as the same number', () => {
    for (const km of [0, 0.5, 7, 12.4, 42.195]) {
      expect(parseKm(kmText(km))).toEqual({ ok: true, value: km })
    }
    expect(kmText(null)).toBe('')
  })

  it('shows a distance to one decimal at most', () => {
    expect(formatKm(12.4)).toBe('12.4 km')
    expect(formatKm(10)).toBe('10 km')
    expect(formatKm(42.195)).toBe('42.2 km')
    expect(formatKm(1234.5)).toBe('1,234.5 km')
    expect(formatKm(0)).toBe('0 km')
  })
})

describe('km and the data layer', () => {
  const opened: AppDb[] = []

  afterEach(() => {
    for (const db of opened) db.close()
    opened.length = 0
  })

  // The field and the database each have their own idea of a valid distance.
  // This keeps them from drifting apart: whatever the field accepts must save.
  it('saves every distance the field accepts', async () => {
    const db = await openAppDb({ name: 'pinezka-test-fields' })
    opened.push(db)
    const id = 'warsaw-districts/bemowo'
    for (const [text] of KM_ACCEPTED) {
      const parsed = parseKm(text)
      if (!parsed.ok) throw new Error(`${JSON.stringify(text)} should be accepted`)
      const saved = await updatePlace(db, id, { km: parsed.value })
      expect(saved.km).toBe(parsed.value)
      expect((await getPlace(db, id))?.km).toBe(parsed.value)
    }
  })
})

describe('dates', () => {
  it('shows a stored date in words, whatever the phone’s time zone', () => {
    expect(formatDay('2026-11-08')).toBe('8 Nov 2026')
    expect(formatDay('2024-02-29')).toBe('29 Feb 2024')
    expect(formatDay('2026-01-01')).toBe('1 Jan 2026')
    expect(formatDay('2026-12-31')).toBe('31 Dec 2026')
  })

  it('names every month the same way on every phone', () => {
    // The browser's own short names vary: some versions print "Sept".
    expect(formatDay('2026-09-30')).toBe('30 Sep 2026')
    const months = Array.from({ length: 12 }, (_, index) => {
      return formatDay(`2026-${String(index + 1).padStart(2, '0')}-05`)
    })
    expect(months).toEqual([
      '5 Jan 2026',
      '5 Feb 2026',
      '5 Mar 2026',
      '5 Apr 2026',
      '5 May 2026',
      '5 Jun 2026',
      '5 Jul 2026',
      '5 Aug 2026',
      '5 Sep 2026',
      '5 Oct 2026',
      '5 Nov 2026',
      '5 Dec 2026',
    ])
  })

  it('shows text that is not a stored date as it is', () => {
    expect(formatDay('2026-13-01')).toBe('2026-13-01')
    expect(formatDay('yesterday')).toBe('yesterday')
    expect(formatDay('')).toBe('')
  })

  it('takes today from the phone’s own calendar, not from UTC', () => {
    // Local constructor: 5 March 2026, half past midnight on the phone.
    // The two calendars must disagree at that moment, or this proves nothing:
    // it fails here when the tests are run in a time zone at or behind UTC.
    expect(new Date(2026, 2, 5, 0, 30).getUTCDate()).toBe(4)
    expect(today(new Date(2026, 2, 5, 0, 30))).toBe('2026-03-05')
    expect(today(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('links', () => {
  it.each<[string, string]>([
    ['https://www.strava.com/activities/123', 'https://www.strava.com/activities/123'],
    ['  https://strava.app.link/abc  ', 'https://strava.app.link/abc'],
    ['http://strava.com/activities/1', 'http://strava.com/activities/1'],
    ['www.strava.com/activities/123', 'https://www.strava.com/activities/123'],
    ['strava.com/activities/123', 'https://strava.com/activities/123'],
  ])('turns %j into a link', (text, href) => {
    expect(webLink(text)).toBe(href)
  })

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'intent://scan/#Intent;scheme=zxing;end',
    'strava://activities/1',
    'my run',
    'activity 123',
    'https://',
    'localhost',
  ])('makes no link from %j', (text) => {
    expect(webLink(text)).toBeNull()
  })
})

describe('the link field as typed', () => {
  it.each<[string, string]>([
    ['https://www.strava.com/activities/123', 'https://www.strava.com/activities/123'],
    ['strava.com/activities/123', 'https://strava.com/activities/123'],
    ['  www.strava.com/activities/123  ', 'https://www.strava.com/activities/123'],
    ['http://strava.com/activities/1', 'http://strava.com/activities/1'],
    ['HTTPS://www.strava.com/activities/123', 'https://www.strava.com/activities/123'],
    ['', ''],
    ['   ', ''],
  ])('reads %j as %j', (text, value) => {
    expect(parseLink(text)).toEqual({ ok: true, value })
  })

  it.each<[string, string]>([
    ['Check out my run on Strava: https://strava.app.link/AbC123', 'https://strava.app.link/AbC123'],
    ['Check out my run: https://www.strava.com/activities/123', 'https://www.strava.com/activities/123'],
    ['Morning run\nhttps://strava.app.link/AbC123\nSee you there', 'https://strava.app.link/AbC123'],
    ['My run: HTTPS://strava.app.link/AbC123', 'https://strava.app.link/AbC123'],
    ['First https://strava.app.link/first then https://strava.app.link/second', 'https://strava.app.link/first'],
  ])('takes the link out of the pasted text %j', (text, value) => {
    expect(parseLink(text)).toEqual({ ok: true, value })
  })

  it.each<[string, string]>([
    ['My run: https://www.strava.com/activities/123.', 'https://www.strava.com/activities/123'],
    ['(see https://www.strava.com/activities/123)', 'https://www.strava.com/activities/123'],
    ['Was it https://www.strava.com/activities/123?!', 'https://www.strava.com/activities/123'],
    ['https://www.strava.com/activities/123, then home', 'https://www.strava.com/activities/123'],
    ['Here: https://strava.app.link/AbC123;', 'https://strava.app.link/AbC123'],
    ['Link https://strava.app.link/AbC123:', 'https://strava.app.link/AbC123'],
  ])('leaves the sentence’s punctuation out of the link in %j', (text, value) => {
    expect(parseLink(text)).toEqual({ ok: true, value })
  })

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'strava://activities/1',
    'data:text/html,<script>alert(1)</script>',
    'my run',
    'localhost',
    'see http://localhost for it',
    'https://',
  ])('does not accept %j', (text) => {
    expect(parseLink(text)).toEqual({ ok: false })
  })

  it('does not accept a link too long to be a real one', () => {
    const start = 'https://www.strava.com/activities/'
    expect(parseLink(start + '1'.repeat(2000 - start.length))).toMatchObject({ ok: true })
    expect(parseLink(start + '1'.repeat(2001 - start.length))).toEqual({ ok: false })
  })

  it('gives a value that reads back as itself and opens as a link', () => {
    for (const text of ['strava.com/activities/123', 'Run: https://strava.app.link/AbC123.', 'https://www.strava.com']) {
      const parsed = parseLink(text)
      if (!parsed.ok) throw new Error(`${JSON.stringify(text)} should be accepted`)
      expect(parseLink(parsed.value)).toEqual(parsed)
      expect(webLink(parsed.value)).toBe(parsed.value)
    }
  })
})
