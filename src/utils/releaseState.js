const ERROR_POLL_STATES = new Set(['error', 'quota', 'not-found'])

export const FRESH_OBSERVATION_MS = 10 * 60 * 1000
export const STALE_OBSERVATION_MS = 30 * 60 * 1000

export function isReleaseFresh(video, now = Date.now()) {
  return Boolean(video.lastPolledAt) && now - Number(video.lastPolledAt) < FRESH_OBSERVATION_MS
}

export function isReleaseStale(video, now = Date.now()) {
  return !video.lastPolledAt || now - Number(video.lastPolledAt) > STALE_OBSERVATION_MS
}

export function isReleaseSurging(video) {
  return video.currentTier === 'SURGE' || Number(video.velocity5m || 0) >= Math.max(20, Number(video.velocity30m || 0) * 1.8)
}

export function hasReleaseError(video) {
  return ERROR_POLL_STATES.has(video.pollState)
}

export function deriveReleaseState(video, now = Date.now()) {
  if (video.pollState === 'not-found') return 'unavailable'
  if (video.pollState === 'quota') return 'quota'
  if (video.pollState === 'error') return 'error'
  if (video.pollState === 'paused') return 'paused'
  if (video.pollState === 'polling') return 'polling'
  if (!video.lastPolledAt) return 'sampling'
  if (isReleaseStale(video, now)) return 'stale'
  if (isReleaseSurging(video)) return 'surging'
  return 'tracking'
}