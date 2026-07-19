import { describe, expect, it } from 'vitest'
import { mergeSnapshots } from './collect.js'

const DAY = 24 * 60 * 60 * 1000

describe('mergeSnapshots', () => {
  it('appends fresh rows and prunes beyond seven days', () => {
    const now = 100 * DAY
    const existing = [
      { videoId: 'aaaaaaaaaaa', timestamp: now - 8 * DAY, viewCount: 1 },
      { videoId: 'aaaaaaaaaaa', timestamp: now - 6 * DAY, viewCount: 2 },
    ]
    const fresh = [{ videoId: 'aaaaaaaaaaa', timestamp: now, viewCount: 3 }]
    expect(mergeSnapshots(existing, fresh, now).map(row => row.viewCount)).toEqual([2, 3])
    expect(mergeSnapshots(null, fresh, now)).toEqual(fresh)
  })

  it('caps total rows, keeping the newest', () => {
    const now = 100 * DAY
    const existing = Array.from({ length: 8100 }, (_, i) => ({ videoId: 'aaaaaaaaaaa', timestamp: now - i, viewCount: i }))
    const rows = mergeSnapshots(existing, [], now)
    expect(rows).toHaveLength(8000)
    expect(rows[0].viewCount).toBe(7999)
    expect(rows.at(-1).viewCount).toBe(0)
  })
})
