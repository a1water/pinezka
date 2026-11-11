import type { IDBPDatabase } from 'idb'
import { describe, expect, it } from 'vitest'
import { migrations, runMigrations, SCHEMA_VERSION } from './migrations.ts'
import type { Migration, UpgradeTransaction } from './migrations.ts'
import type { PinezkaSchema } from './types.ts'

const db = {} as IDBPDatabase<PinezkaSchema>
const tx = {} as UpgradeTransaction

function recording(versions: number[]): { steps: Record<number, Migration>; ran: number[] } {
  const ran: number[] = []
  const steps: Record<number, Migration> = {}
  for (const version of versions) {
    steps[version] = () => {
      ran.push(version)
    }
  }
  return { steps, ran }
}

describe('migrations', () => {
  it('has one migration for every schema version and none beyond', () => {
    const versions = Object.keys(migrations).map(Number)
    const expected = Array.from({ length: SCHEMA_VERSION }, (_, index) => index + 1)
    expect(versions).toEqual(expected)
  })

  it('runs every step after the old version, in order', async () => {
    const { steps, ran } = recording([1, 2, 3, 4])
    await runMigrations(db, tx, 1, 4, steps)
    expect(ran).toEqual([2, 3, 4])
  })

  it('runs every step for a new database', async () => {
    const { steps, ran } = recording([1, 2])
    await runMigrations(db, tx, 0, 2, steps)
    expect(ran).toEqual([1, 2])
  })

  it('runs nothing when the database is already current', async () => {
    const { steps, ran } = recording([1, 2])
    await runMigrations(db, tx, 2, 2, steps)
    expect(ran).toEqual([])
  })

  it('refuses to skip a version that has no migration', async () => {
    const { steps, ran } = recording([1, 3])
    await expect(runMigrations(db, tx, 0, 3, steps)).rejects.toThrow('no migration to schema version 2')
    expect(ran).toEqual([1])
  })

  it('finishes an async step before starting the next', async () => {
    const order: string[] = []
    const steps: Record<number, Migration> = {
      1: async () => {
        order.push('1 starts')
        await Promise.resolve()
        order.push('1 ends')
      },
      2: () => {
        order.push('2 runs')
      },
    }
    await runMigrations(db, tx, 0, 2, steps)
    expect(order).toEqual(['1 starts', '1 ends', '2 runs'])
  })

  it('stops at an async step that fails', async () => {
    const ran: number[] = []
    const steps: Record<number, Migration> = {
      1: async () => {
        await Promise.resolve()
        throw new Error('step 1 failed')
      },
      2: () => {
        ran.push(2)
      },
    }
    await expect(runMigrations(db, tx, 0, 2, steps)).rejects.toThrow('step 1 failed')
    expect(ran).toEqual([])
  })
})
