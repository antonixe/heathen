import { fetchYouTubeVideo } from '../utils/youtube.js'

const jobs = new Map()
export const backoffs = [5000, 15000, 45000, 120000, 120000]
export const DEFAULT_THRESHOLDS = { surge: 80, active: 20, slow: 5 }
export const TIER_INTERVALS = { SURGE: 30000, ACTIVE: 90000, SLOW: 300000, IDLE: 900000 }
let apiKey = ''
let stagger = 0
let thresholds = { ...DEFAULT_THRESHOLDS }
let adaptivePollingEnabled = true

const finite = value => Number.isFinite(Number(value))
const post = message => postMessage(message)

function clearJob(videoId) {
  const job = jobs.get(videoId)
  if (job?.timer) clearTimeout(job.timer)
  jobs.delete(videoId)
}

const validThresholdOrder = value =>
  Number.isFinite(value.surge) &&
  Number.isFinite(value.active) &&
  Number.isFinite(value.slow) &&
  value.surge > value.active &&
  value.active > value.slow &&
  value.slow >= 1

export function normalizeThresholdValues(next = {}, previous = DEFAULT_THRESHOLDS) {
  const candidate = {
    surge: Number(next.surge ?? next.threshold_surge ?? previous.surge),
    active: Number(next.active ?? next.threshold_active ?? previous.active),
    slow: Number(next.slow ?? next.threshold_slow ?? previous.slow),
  }
  if (validThresholdOrder(candidate)) return candidate
  const fallback = {
    surge: Number(previous.surge),
    active: Number(previous.active),
    slow: Number(previous.slow),
  }
  return validThresholdOrder(fallback) ? fallback : { ...DEFAULT_THRESHOLDS }
}

function normalizeThresholds(next = {}) {
  thresholds = normalizeThresholdValues(next, thresholds)
}

function fixedInterval(job) {
  const requested = Number(job.fixedIntervalMs) || (Number(job.pollInterval) || 60) * 1000
  return Math.max(30000, Math.min(24 * 60 * 60 * 1000, requested))
}

export function intervalForJob(job, options = {}) {
  const enabled = options.adaptivePollingEnabled ?? adaptivePollingEnabled
  const activeThresholds = options.thresholds ?? thresholds
  if (!job) return { currentTier: 'IDLE', currentIntervalMs: TIER_INTERVALS.IDLE }
  if (!enabled || job.pollMode === 'fixed') return { currentTier: 'FIXED', currentIntervalMs: fixedInterval(job) }
  const velocity = Number(job.lastVelocity)
  if (!Number.isFinite(velocity)) return { currentTier: 'ACTIVE', currentIntervalMs: TIER_INTERVALS.ACTIVE }
  if (velocity >= activeThresholds.surge) return { currentTier: 'SURGE', currentIntervalMs: TIER_INTERVALS.SURGE }
  if (velocity >= activeThresholds.active) return { currentTier: 'ACTIVE', currentIntervalMs: TIER_INTERVALS.ACTIVE }
  if (velocity >= activeThresholds.slow) return { currentTier: 'SLOW', currentIntervalMs: TIER_INTERVALS.SLOW }
  return { currentTier: 'IDLE', currentIntervalMs: TIER_INTERVALS.IDLE }
}

function determineInterval(videoId) {
  return intervalForJob(jobs.get(videoId))
}

export function initialDelayForJob(job, index = 0, now = Date.now()) {
  if (!job) return index * 2000
  const { currentIntervalMs } = intervalForJob(job)
  const persistedNext = finite(job.nextPollAt) ? Number(job.nextPollAt) : null
  const derivedNext = finite(job.lastTimestamp) ? Number(job.lastTimestamp) + currentIntervalMs : null
  const dueAt = persistedNext ?? derivedNext
  if (!finite(dueAt)) return (stagger++ + index) * 2000
  if (dueAt <= now) return index * 1500
  return Math.max(0, Math.min(dueAt - now, currentIntervalMs))
}

function schedule(videoId, delayOverride = null) {
  const job = jobs.get(videoId)
  if (!job || job.paused) return
  if (job.timer) clearTimeout(job.timer)
  const { currentTier, currentIntervalMs } = determineInterval(videoId)
  const delay = delayOverride ?? currentIntervalMs
  job.currentTier = currentTier
  job.currentIntervalMs = currentIntervalMs
  job.nextPollAt = Date.now() + delay
  job.timer = setTimeout(() => poll(videoId), delay)
  post({ type: 'SCHEDULED', videoId, nextAt: job.nextPollAt, currentTier, currentIntervalMs, nextPollInMs: delay })
}

function updateVelocity(job, viewCount, timestamp) {
  const previousVelocity = Number.isFinite(Number(job.lastVelocity)) ? Number(job.lastVelocity) : null
  const previousViewCount = Number(job.lastViewCount)
  const previousTimestamp = Number(job.lastTimestamp)
  let nextVelocity = null
  if (Number.isFinite(previousViewCount) && Number.isFinite(previousTimestamp) && timestamp > previousTimestamp) {
    const minutes = (timestamp - previousTimestamp) / 60000
    nextVelocity = minutes > 0 ? (viewCount - previousViewCount) / minutes : null
  }
  job.lastViewCount = viewCount
  job.lastTimestamp = timestamp
  job.lastVelocity = Number.isFinite(Number(nextVelocity)) ? nextVelocity : job.lastVelocity ?? null
  return previousVelocity !== null && Number.isFinite(Number(nextVelocity)) && nextVelocity > previousVelocity * 3
}

async function fetchVideoSnapshot(videoId, requestApiKey = apiKey) {
  const key = requestApiKey || apiKey
  if (!key) throw Object.assign(new Error('YouTube API key is missing.'), { code: 'NO_API_KEY', quotaUnits: 0 })
  const data = await fetchYouTubeVideo(videoId, key)
  return { ...data, timestamp: Date.now() }
}

function postPollError(videoId, error) {
  const code = error.code ?? 'NETWORK'
  post({ type: 'ERROR', videoId, code, message: error.message || 'Polling failed.', quotaUnits: Number(error.quotaUnits || 0) })
  return code
}

export function isQuotaError(code) {
  return code === 'QUOTA'
}

async function poll(videoId) {
  const job = jobs.get(videoId)
  if (!job || job.paused) return
  post({ type: 'POLLING', videoId })
  try {
    const snapshot = await fetchVideoSnapshot(videoId)
    const spiked = updateVelocity(job, snapshot.viewCount, snapshot.timestamp)
    const { currentTier, currentIntervalMs } = determineInterval(videoId)
    job.attempt = 0
    post({
      type: 'DATA', ...snapshot,
      currentTier, currentIntervalMs, nextPollInMs: currentIntervalMs, lastVelocity: job.lastVelocity,
    })
    schedule(videoId, spiked ? currentIntervalMs : null)
  } catch (error) {
    const code = postPollError(videoId, error)
    if (isQuotaError(code)) {
      clearJob(videoId)
      post({ type: 'QUOTA_WARNING', videoId })
    } else if (code === 404) clearJob(videoId)
    else if (job.attempt < backoffs.length) schedule(videoId, backoffs[job.attempt++])
    else {
      job.paused = true
      post({ type: 'GAVE_UP', videoId, message: 'Polling paused after repeated failed attempts.' })
    }
  }
}

export function prepareJobForManualPoll(job) {
  if (!job) return null
  if (job.timer) clearTimeout(job.timer)
  job.timer = null
  job.paused = false
  job.attempt = 0
  return job
}

async function pollNow(videoId, requestApiKey) {
  if (requestApiKey) apiKey = requestApiKey
  const job = prepareJobForManualPoll(jobs.get(videoId))
  if (job) {
    await poll(videoId)
    return
  }
  post({ type: 'POLLING', videoId })
  try {
    const snapshot = await fetchVideoSnapshot(videoId, requestApiKey)
    post({
      type: 'DATA', ...snapshot,
      currentTier: 'MANUAL', currentIntervalMs: null, nextPollInMs: null, lastVelocity: null,
    })
  } catch (error) {
    const code = postPollError(videoId, error)
    if (isQuotaError(code)) post({ type: 'QUOTA_WARNING', videoId })
  }
}

function applyVideo(job, video) {
  const fixedMs = Number(video.fixed_interval_ms ?? video.fixedIntervalMs)
  job.pollInterval = Number(video.pollInterval) || 60
  job.pollMode = video.poll_mode || video.pollMode || 'adaptive'
  job.fixedIntervalMs = Number.isFinite(fixedMs) && fixedMs > 0 ? fixedMs : null
  job.lastVelocity = Number.isFinite(Number(video.lastVelocity)) ? Number(video.lastVelocity) : job.lastVelocity ?? null
  job.lastViewCount = Number.isFinite(Number(video.lastViewCount)) ? Number(video.lastViewCount) : job.lastViewCount ?? null
  job.lastTimestamp = Number.isFinite(Number(video.lastPolledAt)) ? Number(video.lastPolledAt) : job.lastTimestamp ?? null
  job.nextPollAt = Number.isFinite(Number(video.nextPollAt)) ? Number(video.nextPollAt) : job.nextPollAt ?? null
}

function upsertVideos(videos, initial = false) {
  const wanted = new Set(videos.map(video => video.videoId))
  for (const id of jobs.keys()) if (!wanted.has(id)) clearJob(id)
  videos.forEach((video, index) => {
    const existing = jobs.get(video.videoId)
    if (existing) {
      const oldMode = existing.pollMode
      const oldFixed = existing.fixedIntervalMs
      applyVideo(existing, video)
      if (oldMode !== existing.pollMode || oldFixed !== existing.fixedIntervalMs) schedule(video.videoId, 0)
      return
    }
    const job = { videoId: video.videoId, timer: null, attempt: 0, paused: false, currentIntervalMs: null, nextPollAt: null, currentTier: 'ACTIVE' }
    applyVideo(job, video)
    jobs.set(video.videoId, job)
    schedule(video.videoId, initial ? initialDelayForJob(job, index) : index * 2000)
  })
}

export function handleWorkerMessage(message) {
  if (message.type === 'START') {
    apiKey = message.apiKey
    stagger = 0
    adaptivePollingEnabled = message.adaptivePollingEnabled !== false
    normalizeThresholds(message.thresholds)
    upsertVideos(message.videos, true)
  }
  if (message.type === 'UPDATE_CONFIG') upsertVideos(message.videos)
  if (message.type === 'UPDATE_THRESHOLDS') {
    const previousEnabled = adaptivePollingEnabled
    const previousThresholds = { ...thresholds }
    adaptivePollingEnabled = message.adaptivePollingEnabled !== false
    normalizeThresholds(message.thresholds)
    const changed = previousEnabled !== adaptivePollingEnabled || previousThresholds.surge !== thresholds.surge || previousThresholds.active !== thresholds.active || previousThresholds.slow !== thresholds.slow
    if (changed) for (const [id, job] of jobs) if (!job.paused && job.pollMode !== 'fixed') schedule(id, 0)
  }
  if (message.type === 'POLL_NOW') pollNow(message.videoId, message.apiKey)
  if (message.type === 'STOP_ALL') { for (const id of [...jobs.keys()]) clearJob(id) }
  if (message.type === 'PAUSE') { const job = jobs.get(message.videoId); if (job) { job.paused = true; if (job.timer) clearTimeout(job.timer); job.timer = null } }
  if (message.type === 'RESUME') { const job = jobs.get(message.videoId); if (job) { job.paused = false; job.attempt = 0; schedule(message.videoId, 0) } }
}

if (typeof self !== 'undefined') self.onmessage = event => handleWorkerMessage(event.data)
