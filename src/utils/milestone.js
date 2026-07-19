const ONE_HOUR_MS = 60 * 60 * 1000

const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null
const isHit = (milestone, currentViewCount) => Boolean(milestone?.hitAt) || (numeric(currentViewCount) !== null && numeric(milestone?.targetCount) !== null && numeric(currentViewCount) >= numeric(milestone.targetCount))
const deadline = milestone => numeric(milestone?.deadlineTimestamp)

export function getActiveMilestone(milestones = [], currentViewCount = 0) {
  const rows = [...(milestones || [])]
  if (!rows.length) return null

  const now = Date.now()
  const futureDeadlines = rows
    .filter(item => !isHit(item, currentViewCount) && deadline(item) !== null && deadline(item) > now)
    .sort((left, right) => deadline(left) - deadline(right))
  if (futureDeadlines.length) return futureDeadlines[0]

  const nextNoDeadline = rows
    .filter(item => !isHit(item, currentViewCount) && deadline(item) === null && numeric(item.targetCount) !== null && numeric(item.targetCount) > numeric(currentViewCount))
    .sort((left, right) => numeric(left.targetCount) - numeric(right.targetCount))
  if (nextNoDeadline.length) return nextNoDeadline[0]

  const achieved = rows
    .filter(item => isHit(item, currentViewCount))
    .sort((left, right) => (numeric(right.hitAt) ?? 0) - (numeric(left.hitAt) ?? 0) || numeric(right.targetCount) - numeric(left.targetCount))
  if (achieved.length === rows.length) return achieved[0]

  return null
}

export function markMilestoneHit(milestone, hitTimestamp, currentViewCount) {
  return { ...milestone, hitAt: hitTimestamp, actualCount: currentViewCount }
}

export function getMilestoneDisplayState(milestone) {
  if (!milestone) return 'upcoming'
  if (milestone.hitAt) return 'hit'
  const deadlineMs = deadline(milestone)
  if (deadlineMs !== null && deadlineMs <= Date.now()) return 'missed'
  if (deadlineMs !== null && deadlineMs - Date.now() < ONE_HOUR_MS) return 'imminent'
  return 'upcoming'
}
