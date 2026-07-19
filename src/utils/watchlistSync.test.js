import { describe, expect, it } from 'vitest'
import { normalizeWatchlist } from './watchlistSync.js'

describe('normalizeWatchlist', () => {
  it('dedupes, drops invalid ids, and sorts for stable comparison', () => {
    expect(normalizeWatchlist(['bbbbbbbbbbb', 'aaaaaaaaaaa', 'bbbbbbbbbbb', 'nope', '', null, 'toolongtobevalid'])).toEqual(['aaaaaaaaaaa', 'bbbbbbbbbbb'])
    expect(normalizeWatchlist(null)).toEqual([])
    expect(normalizeWatchlist('nope')).toEqual([])
  })
})
