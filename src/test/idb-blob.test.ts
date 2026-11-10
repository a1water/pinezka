import { describe, expect, it } from 'vitest'

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Photos are stored as Blobs, and the backup test compares them byte for byte.
// If the test environment ever stops keeping Blob bytes, this fails first.
describe('test environment', () => {
  it('keeps the bytes and type of a Blob stored in IndexedDB', async () => {
    const open = indexedDB.open('blob-canary', 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('blobs')
    }
    const db = await done(open)

    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    const original = new Blob([bytes], { type: 'image/jpeg' })
    await done(db.transaction('blobs', 'readwrite').objectStore('blobs').put(original, 'photo'))

    const stored: unknown = await done(db.transaction('blobs').objectStore('blobs').get('photo'))
    db.close()

    expect(stored).toBeInstanceOf(Blob)
    const blob = stored as Blob
    expect(blob.type).toBe('image/jpeg')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })
})
