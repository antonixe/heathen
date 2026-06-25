import { describe, expect, it } from 'vitest'
import { detectBatchFlush, fitDecayCurve, getRollingVelocity, getTimeToMilestone, projectViewsAtTime } from './velocity.js'

const minute = 60000
const linear = Array.from({ length: 121 }, (_, i) => ({ timestamp: i * minute, viewCount: 1000 + i * 10 }))
describe('velocity engine', () => {
  it('calculates windows and rejects short histories', () => {
    expect(getRollingVelocity(linear, 30)).toBe(10)
    expect(getRollingVelocity(linear.slice(-10), 30)).toBeNull()
  })
  it('flags flushes against preceding baseline', () => {
    const points = [...linear.slice(0, 62), { timestamp: 62 * minute, viewCount: 1710 }]
    expect(detectBatchFlush(points)).toContain(62)
  })
  it('fits exponential decay and produces ordered bounds', () => {
    let views = 10000; const points = [{ timestamp: 0, viewCount: views }]
    for (let i = 1; i <= 30; i += 1) { views += 100 * Math.exp(-0.02 * i); points.push({ timestamp: i * minute, viewCount: views }) }
    expect(fitDecayCurve(points).k).toBeCloseTo(0.02, 3)
    const result = projectViewsAtTime(points, 60 * minute)
    expect(result.low).toBeLessThanOrEqual(result.projected); expect(result.projected).toBeLessThanOrEqual(result.high)
  })
  it('estimates sustainable linear milestones', () => expect(getTimeToMilestone(linear, 2500, 2200).estimatedAt).toBe(150 * minute))
})
