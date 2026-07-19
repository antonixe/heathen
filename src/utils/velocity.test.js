import { describe, expect, it } from 'vitest'
import { detectBatchFlush, fitDecayCurve, getPredictionContext, getPredictionSeries, getRollingVelocity, getTimeToMilestone, projectViewsAtTime } from './velocity.js'

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

  it('returns the latest sample time for already-hit milestones', () => {
    const eta = getTimeToMilestone(linear, 2000, 2200)
    expect(eta.estimatedAt).toBe(linear.at(-1).timestamp)
    expect(eta.low).toBe(linear.at(-1).timestamp)
    expect(eta.high).toBe(linear.at(-1).timestamp)
  })

  it('returns null when decay cannot cover the remaining gap', () => {
    let views = 10000
    const points = [{ timestamp: 0, viewCount: views }]
    for (let i = 1; i <= 24; i += 1) {
      views += 200 * Math.exp(-0.25 * i)
      points.push({ timestamp: i * minute, viewCount: views })
    }
    expect(getTimeToMilestone(points, Math.round(views + 5000), views)).toBeNull()
  })

  it('removes batch excess from the prediction shape without losing subsequent growth', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({ timestamp: index * minute, viewCount: 1000 + index * 10 }))
    points.push({ timestamp: 40 * minute, viewCount: 1900 })
    points.push({ timestamp: 41 * minute, viewCount: 1910 })
    const adjusted = getPredictionSeries(points)
    expect(adjusted[40].batchAdjusted).toBe(true)
    expect(adjusted[40].viewCount - adjusted[39].viewCount).toBeCloseTo(10, 5)
    expect(adjusted[41].viewCount - adjusted[40].viewCount).toBeCloseTo(10, 5)
  })

  it('keeps long-history prediction context within an interactive budget', () => {
    const points = Array.from({ length: 5000 }, (_, index) => ({ timestamp: index * minute, viewCount: 1000 + index * 10 }))
    const startedAt = performance.now()
    const context = getPredictionContext(points, { now: points.at(-1).timestamp })
    expect(context.velocity).toBeGreaterThan(0)
    expect(performance.now() - startedAt).toBeLessThan(3000)
  })})
