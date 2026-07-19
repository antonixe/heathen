import { describe, expect, it } from 'vitest'
import { buildComparisonSeries, canCompareSeries } from './comparison.js'

const rows = [
  { timestamp: 1_000_000, viewCount: 100 },
  { timestamp: 1_300_000, viewCount: 160 },
]

describe('comparison alignment', () => {
  it('aligns tracking mode to each release baseline', () => {
    const data = buildComparisonSeries(rows, rows.map(point => ({ ...point, timestamp: point.timestamp + 600000, viewCount: point.viewCount + 50 })), 'tracking')
    expect(data).toEqual([{ x: 0, a: 0, b: 0 }, { x: 5, a: 60, b: 60 }])
  })

  it('aligns publish mode by release age using total views', () => {
    const data = buildComparisonSeries(rows, rows, 'publish', { publishedAt: 700000 }, { publishedAt: 700000 })
    expect(data).toEqual([{ x: 5, a: 100, b: 100 }, { x: 10, a: 160, b: 160 }])
  })

  it('requires published timestamps only for publish alignment', () => {
    expect(canCompareSeries(rows, rows, 'tracking').ready).toBe(true)
    expect(canCompareSeries(rows, rows, 'publish', {}, {}).reason).toMatch(/Published time/)
  })
})
