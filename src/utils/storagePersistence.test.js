import { describe, expect, it } from 'vitest'
import { getStoragePersistenceStatus, requestStoragePersistence } from './storagePersistence.js'

describe('storage persistence', () => {
  it('reports unsupported storage APIs', async () => {
    await expect(getStoragePersistenceStatus({})).resolves.toBe('unsupported')
    await expect(requestStoragePersistence({})).resolves.toBe('unsupported')
  })

  it('reports and requests persistence', async () => {
    await expect(getStoragePersistenceStatus({ persisted: async () => false, persist: async () => true })).resolves.toBe('available')
    await expect(requestStoragePersistence({ persist: async () => true })).resolves.toBe('persistent')
    await expect(requestStoragePersistence({ persist: async () => false })).resolves.toBe('denied')
  })
})
