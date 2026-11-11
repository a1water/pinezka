import { forceCloseDatabase } from 'fake-indexeddb'
import { unwrap } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import { appDb, getPlace, openAppDb, updatePlace } from './db.ts'
import type { AppDb } from './db.ts'
import { migrations } from './migrations.ts'

// appDb() keeps one connection for the whole page, so these tests share the
// real database name and clean it up after each test.

const BEMOWO = 'warsaw-districts/bemowo'
const opened: AppDb[] = []

function request(pending: IDBOpenDBRequest): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result)
    pending.onerror = () => reject(pending.error)
  })
}

afterEach(async () => {
  for (const db of opened) db.close()
  opened.length = 0
  // Deleting closes any connection appDb() still holds, which makes it forget that connection.
  await request(indexedDB.deleteDatabase('pinezka'))
})

describe('the shared connection', () => {
  it('opens the database under the app’s own name, once', async () => {
    const db = await appDb()
    expect(db.name).toBe('pinezka')
    expect(await appDb()).toBe(db)
    // The meta record's key is part of what is stored on the phone.
    expect(await db.get('meta', 'app')).toMatchObject({ schemaVersion: 1 })
  })

  it('tries again after an open that failed', async () => {
    const newer = await request(indexedDB.open('pinezka', 99))
    newer.close()
    await expect(appDb()).rejects.toThrow('newer version of Pinezka')

    await request(indexedDB.deleteDatabase('pinezka'))
    const db = await appDb()
    expect(await getPlace(db, BEMOWO)).toMatchObject({ done: false })
  })

  it('opens again by itself after the browser closed the connection', async () => {
    const first = await appDb()
    await updatePlace(first, BEMOWO, { done: true })
    // The cast works around the function's published type, which asks for the class.
    forceCloseDatabase(unwrap(first) as never)

    const second = await appDb()
    expect(second).not.toBe(first)
    expect(await getPlace(second, BEMOWO)).toMatchObject({ done: true })
    expect(await appDb()).toBe(second)
  })

  it('reports a newer version of the app once that version has upgraded the data', async () => {
    const old = await appDb()
    await updatePlace(old, BEMOWO, { km: 6 })

    const newer = await openAppDb({ version: 2, migrations: { ...migrations, 2: () => {} } })
    opened.push(newer)
    expect(await getPlace(newer, BEMOWO)).toMatchObject({ km: 6 })

    await expect(appDb()).rejects.toThrow('newer version of Pinezka')
    await expect(appDb()).rejects.toThrow('newer version of Pinezka')
  })

  it('starts fresh after the database was deleted under it', async () => {
    const first = await appDb()
    await updatePlace(first, BEMOWO, { done: true })
    await request(indexedDB.deleteDatabase('pinezka'))

    const second = await appDb()
    expect(second).not.toBe(first)
    expect(await getPlace(second, BEMOWO)).toMatchObject({ done: false })
  })
})
