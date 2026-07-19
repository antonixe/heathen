import { describe, expect, it, vi } from 'vitest'
import { testYouTubeApiKey } from './youtube.js'

describe('YouTube API key validation', () => {
  it('rejects empty keys without making a request', async () => {
    const fetchImpl = vi.fn()
    await expect(testYouTubeApiKey('', fetchImpl)).rejects.toMatchObject({ code: 'NO_KEY', quotaUnits: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a successful API response', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }))
    await expect(testYouTubeApiKey('key', fetchImpl)).resolves.toEqual({ valid: true, quotaUnits: 1 })
    expect(fetchImpl.mock.calls[0][0]).toContain('chart=mostPopular')
  })

  it('preserves actionable API errors', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Invalid key', errors: [{ reason: 'keyInvalid' }] } }) }))
    await expect(testYouTubeApiKey('bad', fetchImpl)).rejects.toMatchObject({ code: 'FORBIDDEN', quotaUnits: 1, message: 'Invalid key' })
  })
})
