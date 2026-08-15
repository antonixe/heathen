import { describe, expect, it } from 'vitest'
import { fetchYouTubeVideos, fetchYouTubeVideo, MAX_IDS_PER_CALL } from './youtube.js'

const ok = items => ({ ok: true, json: async () => ({ items }) })
const item = (id, views) => ({ id, snippet: { title: `T ${id}`, channelTitle: 'Chan' }, statistics: { viewCount: String(views) } })

describe('youtube batching', () => {
  it('asks for the whole roster in one call, which is what keeps the quota flat', async () => {
    const calls = []
    const ids = Array.from({ length: 12 }, (_, i) => `id${i}`)
    const found = await fetchYouTubeVideos(ids, 'KEY', {
      fetch: async url => { calls.push(url); return ok(ids.map((id, i) => item(id, 100 + i))) },
    })
    expect(calls).toHaveLength(1)
    expect(new URL(calls[0]).searchParams.get('id')).toBe(ids.join(','))
    expect(found.get('id7').viewCount).toBe(107)
  })

  it('splits at the 50-id ceiling the API imposes', async () => {
    const calls = []
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`)
    await fetchYouTubeVideos(ids, 'KEY', {
      fetch: async url => {
        const batch = new URL(url).searchParams.get('id').split(',')
        calls.push(batch.length)
        return ok(batch.map(id => item(id, 1)))
      },
    })
    expect(calls).toEqual([MAX_IDS_PER_CALL, MAX_IDS_PER_CALL, 20])
  })

  it('omits ids YouTube did not return rather than failing the batch', async () => {
    const found = await fetchYouTubeVideos(['alive', 'deleted'], 'KEY', {
      fetch: async () => ok([item('alive', 5)]),
    })
    expect([...found.keys()]).toEqual(['alive'])
  })

  it('keeps the single-video error contract the app relies on', async () => {
    await expect(fetchYouTubeVideos(['x'], '', {})).rejects.toMatchObject({ code: 'NO_KEY' })
    await expect(fetchYouTubeVideos(['x'], 'KEY', {
      fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: { errors: [{ reason: 'quotaExceeded' }], message: 'over' } }) }),
    })).rejects.toMatchObject({ code: 'QUOTA' })

    // fetchYouTubeVideo takes no fetch override, so stub the global rather than hit the network
    const real = globalThis.fetch
    globalThis.fetch = async () => ok([])
    try {
      await expect(fetchYouTubeVideo('gone', 'KEY')).rejects.toMatchObject({ code: 404 })
    } finally { globalThis.fetch = real }
  })
})
