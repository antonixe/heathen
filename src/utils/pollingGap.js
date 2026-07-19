const MIN_GAP_THRESHOLD_MS = 15 * 60 * 1000

const finite = value => Number.isFinite(Number(value))

export function expectedPollIntervalMs(video = {}) {
  if (finite(video.currentIntervalMs) && Number(video.currentIntervalMs) > 0) return Number(video.currentIntervalMs)
  if (finite(video.fixed_interval_ms) && Number(video.fixed_interval_ms) > 0) return Number(video.fixed_interval_ms)
  if (finite(video.pollInterval) && Number(video.pollInterval) > 0) return Number(video.pollInterval) * 1000
  return 60 * 1000
}

export function getPollingGap(video = {}, now = Date.now()) {
  if (video.status && video.status !== 'active') return null
  if (['paused', 'quota', 'not-found', 'error'].includes(video.pollState)) return null
  const reference = finite(video.lastPolledAt) ? Number(video.lastPolledAt) : finite(video.addedAt) ? Number(video.addedAt) : null
  if (!reference || !finite(now) || Number(now) <= reference) return null
  const expectedMs = expectedPollIntervalMs(video)
  const elapsedMs = Number(now) - reference
  const thresholdMs = Math.max(MIN_GAP_THRESHOLD_MS, expectedMs * 2.5)
  if (elapsedMs <= thresholdMs) return null
  return { elapsedMs, expectedMs, overdueMs: Math.max(0, elapsedMs - expectedMs), missedIntervals: Math.max(1, Math.floor(elapsedMs / expectedMs)), since: reference }
}

export function formatGapDuration(milliseconds) {
  const minutes = Math.max(1, Math.floor(Number(milliseconds || 0) / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}
