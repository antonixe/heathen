import { describe, expect, it } from 'vitest'
import { applyProbabilityCalibration, buildProbabilityCalibration, getMilestoneProbability } from './probability.js'
import { getPredictionContext } from './velocity.js'

const minute = 60000

describe('prediction model context', () => {
  it('lowers confidence when the latest sample is stale', () => {
    const now = 24 * 60 * minute
    const points = Array.from({ length: 12 }, (_, index) => ({ timestamp: index * 5 * minute, viewCount: 1000 + index * 50 }))
    const probability = getMilestoneProbability(points, 3000, now + 2 * 60 * minute, { now })
    expect(probability.confidence).toMatch(/low|very low/)
    expect(probability.reasons).toContain('latest sample stale')
  })

  it('tracks acceleration and engagement as prediction context', () => {
    const points = [
      { timestamp: 0, viewCount: 1000, likeCount: 10, commentCount: 1 },
      { timestamp: 30 * minute, viewCount: 1120, likeCount: 15, commentCount: 2 },
      { timestamp: 55 * minute, viewCount: 1250, likeCount: 24, commentCount: 4 },
      { timestamp: 60 * minute, viewCount: 1350, likeCount: 45, commentCount: 10 },
    ]
    const context = getPredictionContext(points, { now: 60 * minute })
    expect(context.acceleration.label).toBe('accelerating')
    expect(context.engagement.hasEngagement).toBe(true)
    expect(context.engagement.lift).toBeGreaterThan(0)
  })

  it('reports batch-flush adjustment in confidence reasons', () => {
    const points = Array.from({ length: 40 }, (_, index) => ({ timestamp: index * minute, viewCount: 1000 + index * 10 }))
    points.push({ timestamp: 40 * minute, viewCount: 1900 })
    points.push({ timestamp: 41 * minute, viewCount: 1910 })
    const probability = getMilestoneProbability(points, 2300, 80 * minute, { now: 41 * minute })
    expect(probability.reasons).toContain('batch flush adjusted')
    expect(probability.context.quality.batchCount).toBeGreaterThan(0)
  })

  it('caps uncalibrated rolling-velocity confidence and labels it as heuristic', () => {
    const points = Array.from({ length: 30 }, (_, index) => ({ timestamp: index * minute, viewCount: 1000 + index * 10 }))
    const result = getMilestoneProbability(points, 1600, 60 * minute, { now: 29 * minute })
    expect(result.confidence).not.toBe('high')
    expect(result.reasons).toContain('heuristic, not yet calibrated')
  })

  it('rates a steady release with a comfortable cushion as a likely hit', () => {
    const now = 6 * 60 * minute
    // 100 views/min held steady for 6 hours, target needs only 50/min for 24h.
    const points = Array.from({ length: 25 }, (_, index) => ({ timestamp: index * 15 * minute, viewCount: 500000 + index * 1500 }))
    const current = points.at(-1).viewCount
    const result = getMilestoneProbability(points, current + 50 * 24 * 60, now + 24 * 60 * minute, { now, video: { publishedAt: -42 * 60 * minute } })
    expect(result.probability).toBeGreaterThanOrEqual(0.85)
    expect(result.reasons).toContain('steady velocity, no decay fit')
  })

  it('keeps a release tracking exactly at the required pace genuinely uncertain', () => {
    const now = 6 * 60 * minute
    const points = Array.from({ length: 25 }, (_, index) => ({ timestamp: index * 15 * minute, viewCount: 500000 + index * 1500 }))
    const current = points.at(-1).viewCount
    const result = getMilestoneProbability(points, current + 100 * 24 * 60, now + 24 * 60 * minute, { now, video: { publishedAt: -42 * 60 * minute } })
    expect(result.probability).toBeGreaterThan(0.3)
    expect(result.probability).toBeLessThan(0.7)
  })

  it('builds empirical calibration from resolved prediction outcomes', () => {
    const snapshots = Array.from({ length: 40 }, (_, index) => ({
      probability: 0.8,
      outcome: index < 8 ? 'hit' : 'missed',
    }))
    const calibration = buildProbabilityCalibration(snapshots)
    expect(calibration.ready).toBe(true)
    expect(calibration.brierScore).toBeGreaterThan(0)
    expect(applyProbabilityCalibration(0.8, calibration)).toBeLessThan(0.8)
  })})
