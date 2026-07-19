import { describe, expect, it } from 'vitest'
import { expectedPollIntervalMs, formatGapDuration, getPollingGap } from './pollingGap.js'

describe('polling gap detection', () => {
  it('uses the most specific available interval', () => {
    expect(expectedPollIntervalMs({ currentIntervalMs: 30000, fixed_interval_ms: 90000, pollInterval: 120 })).toBe(30000)
    expect(expectedPollIntervalMs({ fixed_interval_ms: 90000, pollInterval: 120 })).toBe(90000)
    expect(expectedPollIntervalMs({ pollInterval: 120 })).toBe(120000)
  })

  it('surfaces prolonged active gaps but ignores intentional stops', () => {
    const now = 2_000_000
    expect(getPollingGap({ status: 'active', pollInterval: 60, lastPolledAt: now - 20 * 60000 }, now)?.missedIntervals).toBe(20)
    expect(getPollingGap({ status: 'active', pollState: 'paused', pollInterval: 60, lastPolledAt: now - 20 * 60000 }, now)).toBeNull()
    expect(getPollingGap({ status: 'active', pollState: 'error', pollInterval: 60, lastPolledAt: now - 20 * 60000 }, now)).toBeNull()
    expect(getPollingGap({ status: 'archived', pollInterval: 60, lastPolledAt: now - 20 * 60000 }, now)).toBeNull()
  })

  it('formats practical gap durations', () => {
    expect(formatGapDuration(20 * 60000)).toBe('20m')
    expect(formatGapDuration(150 * 60000)).toBe('2h 30m')
  })
})
