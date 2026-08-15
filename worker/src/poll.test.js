import { describe, expect, it, vi } from 'vitest'
import { poll } from './index.js'

// Minimal D1 stand-in: records every statement so the test can assert what the poller wrote
// without needing wrangler or a deployed database.
function fakeDB(tracks) {
  const log = []
  const prepare = sql => {
    const stmt = {
      sql, args: [],
      bind(...args) { stmt.args = args; return stmt },
      async all() {
        log.push({ sql, args: stmt.args })
        return sql.includes('from tracks') ? { results: tracks } : { results: [] }
      },
      async first() { log.push({ sql, args: stmt.args }); return null },
      async run() { log.push({ sql, args: stmt.args }); return {} },
    }
    return stmt
  }
  return { log, DB: { prepare, batch: async writes => { for (const w of writes) log.push({ sql: w.sql, args: w.args }); } } }
}

const okResponse = items => ({ ok: true, json: async () => ({ items }) })
const ytItem = (id, views) => ({ id, snippet: { title: `T ${id}`, channelTitle: 'C' }, statistics: { viewCount: String(views) } })

describe('worker poll', () => {
  it('writes one sample per track from a single batched call', async () => {
    const { log, DB } = fakeDB([{ video_id: 'aaa' }, { video_id: 'bbb' }])
    const calls = []
    vi.stubGlobal('fetch', async url => { calls.push(url); return okResponse([ytItem('aaa', 10), ytItem('bbb', 20)]) })

    const result = await poll({ DB, YOUTUBE_API_KEY: 'KEY' }, 1000)

    expect(calls).toHaveLength(1)          // the whole roster, one quota unit
    expect(result).toEqual({ polled: 2, stored: 2 })
    const samples = log.filter(l => l.sql.startsWith('insert or ignore into samples'))
    expect(samples.map(s => s.args)).toEqual([['aaa', 1000, 10], ['bbb', 1000, 20]])
    vi.unstubAllGlobals()
  })

  it('flags a track YouTube did not return instead of failing the run', async () => {
    const { log, DB } = fakeDB([{ video_id: 'alive' }, { video_id: 'gone' }])
    vi.stubGlobal('fetch', async () => okResponse([ytItem('alive', 7)]))

    const result = await poll({ DB, YOUTUBE_API_KEY: 'KEY' }, 2000)

    expect(result).toEqual({ polled: 2, stored: 1 })
    expect(log.filter(l => l.sql.startsWith('insert or ignore into samples')).map(s => s.args))
      .toEqual([['alive', 2000, 7]])
    expect(log.some(l => l.args?.includes('not-found'))).toBe(true)
    vi.unstubAllGlobals()
  })

  it('does not call YouTube at all when nothing is active', async () => {
    const { DB } = fakeDB([])
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    expect(await poll({ DB, YOUTUBE_API_KEY: 'KEY' }, 3000)).toEqual({ polled: 0, stored: 0 })
    expect(spy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
