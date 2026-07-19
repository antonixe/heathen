import { describe, expect, it } from 'vitest'
import { initialDelayForJob, intervalForJob, isQuotaError, normalizeThresholdValues, prepareJobForManualPoll, TIER_INTERVALS } from './poller.worker.js'

describe('poller worker scheduling helpers', () => {
  it('selects adaptive intervals from velocity tiers', () => {
    expect(intervalForJob({ lastVelocity: 100, pollInterval: 60 }, { thresholds: { surge: 80, active: 20, slow: 5 } }).currentTier).toBe('SURGE')
    expect(intervalForJob({ lastVelocity: 8, pollInterval: 60 }, { thresholds: { surge: 80, active: 20, slow: 5 } }).currentTier).toBe('SLOW')
    expect(intervalForJob({ pollMode: 'fixed', fixedIntervalMs: 45000, pollInterval: 60 }).currentIntervalMs).toBe(45000)
  })

  it('polls overdue jobs promptly after browser restart', () => {
    const now = 100000
    const delay = initialDelayForJob({ lastTimestamp: now - TIER_INTERVALS.ACTIVE - 1, lastVelocity: 40, pollInterval: 60 }, 2, now)
    expect(delay).toBe(3000)
  })

  it('does not treat non-quota forbidden responses as quota exhaustion', () => {
    expect(isQuotaError('QUOTA')).toBe(true)
    expect(isQuotaError('FORBIDDEN')).toBe(false)
    expect(normalizeThresholdValues({ surge: '120' }).surge).toBe(120)
  })

  it('restores a gave-up job before a manual recovery poll', () => {
    const job = { paused: true, attempt: 5, timer: null }
    expect(prepareJobForManualPoll(job)).toBe(job)
    expect(job.paused).toBe(false)
    expect(job.attempt).toBe(0)
  })

  it('rejects inverted adaptive thresholds', () => {
    expect(normalizeThresholdValues({ surge: 5, active: 100, slow: 80 })).toEqual({ surge: 80, active: 20, slow: 5 })
  })})
