import { describe, expect, it } from 'vitest'
import { detectBatchFlush, fitDecayCurve, getRollingVelocity, getTimeToMilestone, hourlyProfile, projectViewsAtTime, seasonalFactor } from './velocity.js'
import { getMilestoneProbability } from './probability.js'

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
    for (let i = 1; i <= 90; i += 1) { views += 100 * Math.exp(-0.02 * i); points.push({ timestamp: i * minute, viewCount: views }) }
    expect(fitDecayCurve(points).k).toBeCloseTo(0.02, 3)
    const result = projectViewsAtTime(points, 120 * minute)
    expect(result.low).toBeLessThanOrEqual(result.projected); expect(result.projected).toBeLessThanOrEqual(result.high)
  })
  it('survives a batched counter that only flushes every 15 minutes', () => {
    // truth: 100 views/min decaying at k=0.005, polled every 5min, counter revealed in 15min lumps
    const cumulative = t => 1e6 + 100 * (1 - Math.exp(-0.005 * t)) / 0.005
    const build = reveal => Array.from({ length: 49 }, (_, i) => i * 5)
      .map(t => ({ timestamp: t * minute, viewCount: Math.round(cumulative(reveal(t))) }))
    const batched = build(t => Math.floor(t / 15) * 15)
    expect(fitDecayCurve(batched).k).toBeCloseTo(0.005, 3)
    // fitting raw per-sample deltas kept only the flush spikes and put v0 near 289 against a truth of 100
    expect(fitDecayCurve(batched).v0).toBeLessThan(130)
    const gained = projectViewsAtTime(batched, 420 * minute).projected - 1e6
    const truth = cumulative(420) - 1e6
    expect(Math.abs(gained - truth) / truth).toBeLessThan(0.1) // was +43% before the window change
  })
  it('widens the band when the fit is poor', () => {
    const noise = [0, 0.5, -0.4, 0.3, -0.6, 0.2, 0.45, -0.35, 0.15, -0.5, 0.4, -0.2]
    const build = scale => {
      let views = 10000
      return Array.from({ length: 91 }, (_, i) => {
        if (i) views += 100 * Math.exp(-0.02 * i) * (1 + scale * noise[i % noise.length])
        return { timestamp: i * minute, viewCount: views }
      })
    }
    const tight = fitDecayCurve(build(0)), loose = fitDecayCurve(build(1))
    expect(loose.r2).toBeLessThan(tight.r2)
    expect(loose.logSE).toBeGreaterThan(tight.logSE) // band tracks fit quality, not a hardcoded 8%
  })
  it('estimates sustainable linear milestones', () => expect(getTimeToMilestone(linear, 2500, 2200).estimatedAt).toBe(150 * minute))
  it('projects views at the deadline inside an ordered range', () => {
    const { projectedAtDeadline, projectedRange } = getMilestoneProbability(linear, 1e6, 180 * minute, { now: 120 * minute })
    expect(projectedAtDeadline).toBe(2800) // 2200 now + 10/min over the 60min horizon
    expect(projectedRange.low).toBeLessThanOrEqual(projectedAtDeadline)
    expect(projectedAtDeadline).toBeLessThanOrEqual(projectedRange.high)
  })
  describe('hour-of-day correction', () => {
    // decaying video with a strong evening peak; tracking starts at local midnight
    const K = 0.0002, swing = hour => 1 + 0.6 * Math.sin(2 * Math.PI * (hour - 15) / 24)
    const midnight = new Date(2026, 0, 5).getTime()
    const rate = m => 100 * Math.exp(-K * m) * swing((m / 60) % 24)
    const cumulative = [1e6]
    for (let m = 1; m <= 5 * 1440; m += 1) cumulative[m] = cumulative[m - 1] + rate(m)
    const sampleTo = end => Array.from({ length: Math.floor(end / 5) + 1 }, (_, i) => i * 5)
      .map(m => ({ timestamp: midnight + m * minute, viewCount: Math.round(cumulative[m]) }))

    it('recovers the shape and peaks in the evening', () => {
      const profile = hourlyProfile(sampleTo(4 * 1440))
      expect(profile).toHaveLength(24)
      const peak = profile.indexOf(Math.max(...profile))
      expect(peak).toBeGreaterThanOrEqual(19); expect(peak).toBeLessThanOrEqual(23)
      expect(Math.max(...profile) / Math.min(...profile)).toBeGreaterThan(1.5)
    })
    it('cuts the error projecting across an evening peak', () => {
      const now = 3 * 1440 + 15 * 60, deadline = 4 * 1440 // 15:00 to midnight
      const points = sampleTo(now)
      const truth = cumulative[deadline] - cumulative[now]
      const gained = projectViewsAtTime(points, midnight + deadline * minute).projected - cumulative[now]
      expect(Math.abs(gained - truth) / truth).toBeLessThan(0.1) // was -28.9% with no correction
    })
    it('keeps the decay fit alive through a strong cycle', () => {
      // undeseasonalised this fit scored r2 0.21 and was rejected, falling back to a 30m window
      const fit = fitDecayCurve(sampleTo(4 * 1440))
      expect(fit).not.toBeNull()
      expect(fit.r2).toBeGreaterThan(0.9)
      expect(fit.k).toBeCloseTo(K, 4)
    })
    it('stays neutral until a full cycle has been seen', () => {
      expect(hourlyProfile(sampleTo(600))).toBeNull() // 10h of history
      expect(seasonalFactor(null, midnight, 300, 0)).toBe(1)
    })
  })
  it('does not let a 5m spike steer the decision velocity', () => {
    const spiked = [...linear, { timestamp: 121 * minute, viewCount: linear.at(-1).viewCount + 5000 }]
    const { currentVelocity } = getMilestoneProbability(spiked, 1e6, 200 * minute, { now: 121 * minute })
    expect(currentVelocity).toBeLessThan(200) // 30m window, not the ~5000/min burst
  })
})
