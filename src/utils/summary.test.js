import { describe, expect, it } from 'vitest'
import { buildDeadlineSignal, buildVideoSummary } from './summary.js'

const minute = 60000

describe('video summary helpers', () => {
  it('builds stored dashboard fields from raw datapoints', () => {
    const points = Array.from({ length: 13 }, (_, index) => ({
      timestamp: index * 5 * minute,
      viewCount: 1000 + index * 50,
      velocityPerMin: index === 0 ? null : 10,
    }))
    const summary = buildVideoSummary(points)
    expect(summary.firstViewCount).toBe(1000)
    expect(summary.lastViewCount).toBe(1600)
    expect(summary.sampleCount).toBe(13)
    expect(summary.sessionGain).toBe(600)
    expect(summary.sessionAvg).toBe(10)
    expect(summary.velocity30m).toBe(10)
    expect(summary.peakVelocity).toBe(10)
  })

  it('derives a compact deadline signal from stored summary fields', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const signal = buildDeadlineSignal({ lastViewCount: 900, lastPolledAt: now, velocity30m: 10, sampleCount: 12 }, { targetCount: 1200, deadlineTimestamp: now + 60 * minute }, now)
    expect(signal.requiredVelocity).toBe(5)
    expect(signal.currentVelocity).toBe(10)
    expect(signal.probability).toBeGreaterThan(0.5)
    expect(signal.confidence).toBe('low')
  })

  it('rates a comfortable velocity cushion as a likely hit in the row signal', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const summary = { lastViewCount: 100000, lastPolledAt: now, publishedAt: now - 48 * 60 * minute, velocity30m: 100, sampleCount: 30 }
    const signal = buildDeadlineSignal(summary, { targetCount: 100000 + Math.round(100 / 3) * 24 * 60, deadlineTimestamp: now + 24 * 60 * minute }, now)
    expect(signal.probability).toBeGreaterThanOrEqual(0.85)
  })

  it('keeps an exactly-on-pace release uncertain in the row signal', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const summary = { lastViewCount: 100000, lastPolledAt: now, publishedAt: now - 48 * 60 * minute, velocity30m: 100, sampleCount: 30 }
    const signal = buildDeadlineSignal(summary, { targetCount: 100000 + 100 * 24 * 60, deadlineTimestamp: now + 24 * 60 * minute }, now)
    expect(signal.probability).toBeGreaterThan(0.3)
    expect(signal.probability).toBeLessThan(0.7)
  })
})
