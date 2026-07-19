export async function getStoragePersistenceStatus(storage = globalThis.navigator?.storage) {
  if (!storage?.persisted || !storage?.persist) return 'unsupported'
  try {
    return await storage.persisted() ? 'persistent' : 'available'
  } catch {
    return 'unsupported'
  }
}

export async function requestStoragePersistence(storage = globalThis.navigator?.storage) {
  if (!storage?.persist) return 'unsupported'
  try {
    return await storage.persist() ? 'persistent' : 'denied'
  } catch {
    return 'denied'
  }
}
