import { describe, expect, it } from 'vitest'
import { selectBackfillPoints } from './backfill.js'

const videos = [
  { videoId: 'aaaaaaaaaaa', status: 'active', lastPolledAt: 1000 },
  { videoId: 'bbbbbbbbbbb', status: 'active', lastPolledAt: null },
  { videoId: 'ccccccccccc', status: 'archived', lastPolledAt: 0 },
]

describe('selectBackfillPoints', () => {
  it('keeps only newer snapshots for active tracked videos, oldest first', () => {
    const snapshots = [
      { videoId: 'aaaaaaaaaaa', timestamp: 3000, viewCount: 30 },
      { videoId: 'aaaaaaaaaaa', timestamp: 1000, viewCount: 10 },
      { videoId: 'aaaaaaaaaaa', timestamp: 2000, viewCount: 20 },
      { videoId: 'bbbbbbbbbbb', timestamp: 500, viewCount: 5 },
      { videoId: 'ccccccccccc', timestamp: 2000, viewCount: 20 },
      { videoId: 'not-tracked', timestamp: 2000, viewCount: 20 },
    ]
    const points = selectBackfillPoints(snapshots, videos)
    expect(points.map(point => [point.videoId, point.timestamp])).toEqual([
      ['bbbbbbbbbbb', 500],
      ['aaaaaaaaaaa', 2000],
      ['aaaaaaaaaaa', 3000],
    ])
  })

  it('tolerates malformed payloads', () => {
    expect(selectBackfillPoints(null, videos)).toEqual([])
    expect(selectBackfillPoints('nope', videos)).toEqual([])
    expect(selectBackfillPoints([null, { videoId: 'aaaaaaaaaaa' }, { videoId: 'aaaaaaaaaaa', timestamp: 2000, viewCount: 'x' }], videos)).toEqual([])
  })
})
