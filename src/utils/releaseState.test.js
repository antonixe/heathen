import { describe, expect, it } from 'vitest'
import { deriveReleaseState, hasReleaseError, isReleaseFresh, isReleaseStale, isReleaseSurging } from './releaseState.js'

const NOW = 2_000_000_000_000

describe('release state model', () => {
  it('gives explicit poll exceptions precedence over freshness and velocity', () => {
    const base = { lastPolledAt: NOW - 1000, velocity5m: 200, velocity30m: 20 }
    expect(deriveReleaseState({ ...base, pollState: 'error' }, NOW)).toBe('error')
    expect(deriveReleaseState({ ...base, pollState: 'quota' }, NOW)).toBe('quota')
    expect(deriveReleaseState({ ...base, pollState: 'not-found' }, NOW)).toBe('unavailable')
    expect(deriveReleaseState({ ...base, pollState: 'paused' }, NOW)).toBe('paused')
    expect(deriveReleaseState({ ...base, pollState: 'polling' }, NOW)).toBe('polling')
  })

  it('distinguishes sampling, stale, surging, and normal tracking', () => {
    expect(deriveReleaseState({}, NOW)).toBe('sampling')
    expect(deriveReleaseState({ lastPolledAt: NOW - 31 * 60 * 1000 }, NOW)).toBe('stale')
    expect(deriveReleaseState({ lastPolledAt: NOW - 1000, velocity5m: 80, velocity30m: 20 }, NOW)).toBe('surging')
    expect(deriveReleaseState({ lastPolledAt: NOW - 1000, velocity5m: 10, velocity30m: 9 }, NOW)).toBe('tracking')
  })

  it('uses separate fresh and stale windows so the middle period remains current', () => {
    const recent = { lastPolledAt: NOW - 5 * 60 * 1000 }
    const current = { lastPolledAt: NOW - 20 * 60 * 1000 }
    const old = { lastPolledAt: NOW - 31 * 60 * 1000 }
    expect(isReleaseFresh(recent, NOW)).toBe(true)
    expect(isReleaseFresh(current, NOW)).toBe(false)
    expect(isReleaseStale(current, NOW)).toBe(false)
    expect(isReleaseStale(old, NOW)).toBe(true)
  })

  it('recognizes both configured and relative surge signals', () => {
    expect(isReleaseSurging({ currentTier: 'SURGE' })).toBe(true)
    expect(isReleaseSurging({ velocity5m: 50, velocity30m: 20 })).toBe(true)
    expect(isReleaseSurging({ velocity5m: 19, velocity30m: 1 })).toBe(false)
  })

  it('groups recoverable poll exceptions for the attention filter', () => {
    expect(hasReleaseError({ pollState: 'error' })).toBe(true)
    expect(hasReleaseError({ pollState: 'quota' })).toBe(true)
    expect(hasReleaseError({ pollState: 'not-found' })).toBe(true)
    expect(hasReleaseError({ pollState: 'paused' })).toBe(false)
  })
})