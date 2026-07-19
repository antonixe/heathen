import { afterEach, describe, expect, it, vi } from 'vitest'
import { getActiveMilestone, getMilestoneDisplayState, markMilestoneHit } from './milestone.js'

const now = Date.UTC(2026, 0, 1, 12, 0, 0)

describe('milestone helpers', () => {
  afterEach(() => vi.useRealTimers())

  it('selects the unhit milestone with the nearest future deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const milestones = [
      { id: 'later', targetCount: 2000, deadlineTimestamp: now + 2 * 60 * 60 * 1000 },
      { id: 'soon', targetCount: 1500, deadlineTimestamp: now + 30 * 60 * 1000 },
      { id: 'hit', targetCount: 1200, hitAt: now - 1000 },
    ]
    expect(getActiveMilestone(milestones, 1000).id).toBe('soon')
  })

  it('falls back to the next unhit target when no deadline is active', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const milestones = [
      { id: 'far', targetCount: 5000 },
      { id: 'next', targetCount: 2200 },
      { id: 'behind', targetCount: 1200 },
    ]
    expect(getActiveMilestone(milestones, 1500).id).toBe('next')
  })

  it('keeps hit metadata together', () => {
    expect(markMilestoneHit({ id: 1, targetCount: 3000 }, now, 3125)).toMatchObject({ hitAt: now, actualCount: 3125 })
  })

  it('classifies hit, missed, imminent, and upcoming states', () => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    expect(getMilestoneDisplayState({ hitAt: now - 1 })).toBe('hit')
    expect(getMilestoneDisplayState({ deadlineTimestamp: now - 1 })).toBe('missed')
    expect(getMilestoneDisplayState({ deadlineTimestamp: now + 30 * 60 * 1000 })).toBe('imminent')
    expect(getMilestoneDisplayState({ deadlineTimestamp: now + 2 * 60 * 60 * 1000 })).toBe('upcoming')
  })
})