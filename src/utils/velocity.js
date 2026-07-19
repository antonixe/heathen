const finite = value => Number.isFinite(Number(value))
const numberOrNull = value => finite(value) ? Number(value) : null
const median = values => {
  const rows = values.filter(finite).map(Number).sort((a, b) => a - b)
  if (!rows.length) return null
  const middle = Math.floor(rows.length / 2)
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const CLEAN_POINTS = Symbol('cleanVelocityPoints')
const markClean = points => {
  Object.defineProperty(points, CLEAN_POINTS, { value: true, enumerable: false })
  return points
}

export function cleanDatapoints(datapoints) {
  if (Array.isArray(datapoints) && datapoints[CLEAN_POINTS]) return datapoints
  return markClean([...(datapoints || [])]
    .filter(point => finite(point.timestamp) && finite(point.viewCount))
    .map(point => ({
      ...point,
      timestamp: Number(point.timestamp),
      viewCount: Number(point.viewCount),
      likeCount: numberOrNull(point.likeCount),
      commentCount: numberOrNull(point.commentCount),
      velocityPerMin: numberOrNull(point.velocityPerMin),
      likeVelocityPerMin: numberOrNull(point.likeVelocityPerMin),
      commentVelocityPerMin: numberOrNull(point.commentVelocityPerMin),
    }))
    .sort((a, b) => a.timestamp - b.timestamp))
}

function valueAt(points, timestamp) {
  if (timestamp < points[0].timestamp || timestamp > points.at(-1).timestamp) return null
  for (let i = 1; i < points.length; i += 1) {
    const left = points[i - 1], right = points[i]
    if (right.timestamp < timestamp) continue
    if (right.timestamp === left.timestamp) return right.viewCount
    const ratio = (timestamp - left.timestamp) / (right.timestamp - left.timestamp)
    return left.viewCount + (right.viewCount - left.viewCount) * ratio
  }
  return points.at(-1).viewCount
}

export function getRollingVelocity(datapoints, windowMinutes) {
  const points = cleanDatapoints(datapoints)
  if (points.length < 2 || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null
  const cutoff = points.at(-1).timestamp - windowMinutes * 60000
  if (points[0].timestamp > cutoff) return null
  const start = valueAt(points, cutoff)
  return start === null ? null : (points.at(-1).viewCount - start) / windowMinutes
}

export function getIntervals(datapoints) {
  const points = cleanDatapoints(datapoints)
  return points.slice(1).map((point, i) => {
    const previous = points[i]
    const minutes = (point.timestamp - previous.timestamp) / 60000
    if (minutes <= 0) return null
    const likeDelta = point.likeCount !== null && previous.likeCount !== null ? point.likeCount - previous.likeCount : null
    const commentDelta = point.commentCount !== null && previous.commentCount !== null ? point.commentCount - previous.commentCount : null
    return {
      timestamp: point.timestamp,
      minutes,
      velocity: (point.viewCount - previous.viewCount) / minutes,
      likeVelocity: likeDelta === null ? null : likeDelta / minutes,
      commentVelocity: commentDelta === null ? null : commentDelta / minutes,
    }
  }).filter(Boolean)
}

export function getAllVelocityWindows(datapoints) {
  const points = cleanDatapoints(datapoints), rows = getIntervals(points)
  const minutes = points.length > 1 ? (points.at(-1).timestamp - points[0].timestamp) / 60000 : 0
  return {
    v5m: getRollingVelocity(points, 5), v30m: getRollingVelocity(points, 30),
    v1h: getRollingVelocity(points, 60), v3h: getRollingVelocity(points, 180), v6h: getRollingVelocity(points, 360),
    sessionAvg: minutes > 0 ? (points.at(-1).viewCount - points[0].viewCount) / minutes : null,
    peak: rows.length ? Math.max(...rows.map(row => row.velocity)) : null,
  }
}

function analyzeBatchFlushes(points, thresholdMultiplier = 5) {
  if (points.length < 3) return []
  const window = []
  const flagged = []
  let windowDelta = 0
  let windowMinutes = 0
  let windowStart = 0

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]
    const point = points[index]
    const cutoff = previous.timestamp - 30 * 60000
    while (windowStart < window.length && window[windowStart].timestamp < cutoff) {
      const removed = window[windowStart++]
      windowDelta -= removed.delta
      windowMinutes -= removed.minutes
    }

    const minutes = (point.timestamp - previous.timestamp) / 60000
    if (minutes <= 0) continue
    const delta = point.viewCount - previous.viewCount
    const velocity = delta / minutes
    const hasCoverage = previous.timestamp - points[0].timestamp >= 30 * 60000
    const baseline = hasCoverage && windowMinutes > 0 ? windowDelta / windowMinutes : null
    const isFlush = baseline !== null && baseline > 0 && velocity > baseline * thresholdMultiplier

    if (isFlush) {
      const expectedDelta = Math.max(0, baseline * minutes)
      flagged.push({ index, baseline, velocity, expectedDelta, excess: Math.max(0, delta - expectedDelta) })
      continue
    }

    if (delta >= 0) {
      const row = { timestamp: point.timestamp, delta, minutes }
      window.push(row)
      windowDelta += delta
      windowMinutes += minutes
    }
  }
  return flagged
}

export function detectBatchFlush(datapoints, thresholdMultiplier = 5) {
  const points = cleanDatapoints(datapoints)
  return analyzeBatchFlushes(points, thresholdMultiplier).map(row => row.index)
}

export function getPredictionSeries(datapoints, options = {}) {
  const points = cleanDatapoints(datapoints)
  if (options.excludeBatchFlushes === false || points.length < 4) return points
  const flushes = analyzeBatchFlushes(points, options.batchThresholdMultiplier ?? 5)
  if (!flushes.length) return points

  const byIndex = new Map(flushes.map(row => [row.index, row]))
  const adjusted = []
  let cumulativeExcess = 0
  points.forEach((point, index) => {
    const flush = byIndex.get(index)
    if (flush) cumulativeExcess += flush.excess
    const adjustedCount = point.viewCount - cumulativeExcess
    adjusted.push({
      ...point,
      viewCount: adjusted.length ? Math.max(adjusted.at(-1).viewCount, adjustedCount) : adjustedCount,
      batchAdjusted: Boolean(flush),
      batchExcess: flush?.excess ?? 0,
    })
  })
  return markClean(adjusted)
}

export function fitDecayCurve(datapoints, options = {}) {
  const rows = getIntervals(options.excludeBatchFlushes ? getPredictionSeries(datapoints, options) : datapoints)
  const positive = rows.map(row => row.velocity).filter(value => value > 0)
  if (rows.length < 6 || positive.length < 3) return null
  const velocityFloor = Math.max(0.001, (median(positive) ?? 0.05) * 0.02)
  const originTimestamp = rows[0].timestamp
  const xs = rows.map(row => (row.timestamp - originTimestamp) / 60000)
  const ys = rows.map(row => Math.log(Math.max(velocityFloor, row.velocity)))
  const meanX = xs.reduce((s, v) => s + v, 0) / xs.length, meanY = ys.reduce((s, v) => s + v, 0) / ys.length
  const denominator = xs.reduce((s, v) => s + (v - meanX) ** 2, 0)
  if (!denominator) return null
  const slope = xs.reduce((s, v, i) => s + (v - meanX) * (ys[i] - meanY), 0) / denominator
  const intercept = meanY - slope * meanX
  const residual = ys.reduce((s, v, i) => s + (v - intercept - slope * xs[i]) ** 2, 0)
  const total = ys.reduce((s, v) => s + (v - meanY) ** 2, 0)
  const r2 = total === 0 ? 1 : 1 - residual / total, k = -slope
  return k > 0 && r2 >= 0.4 ? { k, v0: Math.exp(intercept), r2, originTimestamp } : null
}

export function integratedViews(velocity, decay, minutes) {
  if (minutes <= 0 || velocity <= 0) return 0
  return Math.abs(decay) < 1e-9 ? velocity * minutes : velocity * (1 - Math.exp(-decay * minutes)) / decay
}

export function getVelocityAcceleration(datapoints) {
  const windows = getAllVelocityWindows(getPredictionSeries(datapoints))
  const recent = windows.v5m ?? windows.v30m ?? null
  const baseline = windows.v30m ?? windows.v1h ?? windows.sessionAvg ?? null
  if (recent === null || baseline === null || baseline <= 0) return { score: 0, label: 'flat', recent, baseline }
  const ratio = recent / baseline
  const score = clamp((ratio - 1) / 2, -0.5, 0.75)
  const label = ratio >= 1.5 ? 'accelerating' : ratio <= 0.65 ? 'cooling' : 'flat'
  return { score, label, recent, baseline, ratio }
}

export function getEngagementSignal(datapoints) {
  const rows = getIntervals(getPredictionSeries(datapoints)).slice(-12)
  const likeVelocity = median(rows.map(row => row.likeVelocity))
  const commentVelocity = median(rows.map(row => row.commentVelocity))
  const lift = clamp((Math.log1p(Math.max(0, likeVelocity ?? 0)) * 0.025) + (Math.log1p(Math.max(0, commentVelocity ?? 0)) * 0.08), 0, 0.18)
  return { likeVelocity, commentVelocity, lift, hasEngagement: likeVelocity !== null || commentVelocity !== null }
}

export function getSampleQuality(datapoints, now = Date.now()) {
  const points = cleanDatapoints(datapoints)
  const rows = getIntervals(points)
  const intervals = rows.map(row => row.minutes).filter(value => value > 0)
  const medianIntervalMinutes = median(intervals)
  const maxGapMinutes = intervals.length ? Math.max(...intervals) : null
  const stalenessMinutes = points.length ? Math.max(0, (now - points.at(-1).timestamp) / 60000) : Infinity
  const batchCount = detectBatchFlush(points).length
  const stalenessPenalty = !Number.isFinite(stalenessMinutes) ? 0.4 : clamp((stalenessMinutes - Math.max(10, medianIntervalMinutes ?? 10)) / 240, 0, 0.35)
  const gapPenalty = maxGapMinutes && medianIntervalMinutes ? clamp((maxGapMinutes / Math.max(1, medianIntervalMinutes) - 3) / 20, 0, 0.25) : 0
  const samplePenalty = points.length < 6 ? 0.35 : points.length < 12 ? 0.18 : points.length < 24 ? 0.08 : 0
  const batchPenalty = clamp(batchCount * 0.04, 0, 0.2)
  const score = clamp(1 - stalenessPenalty - gapPenalty - samplePenalty - batchPenalty, 0.1, 1)
  return { score, sampleCount: points.length, medianIntervalMinutes, maxGapMinutes, stalenessMinutes, batchCount, stalenessPenalty, gapPenalty, samplePenalty, batchPenalty }
}

export function getVideoPhase(publishedAt, now = Date.now()) {
  const timestamp = numberOrNull(publishedAt)
  if (timestamp === null) return { ageMinutes: null, phase: 'unknown', penalty: 0.08 }
  const ageMinutes = Math.max(0, (now - timestamp) / 60000)
  if (ageMinutes < 60) return { ageMinutes, phase: 'launch', penalty: 0.16 }
  if (ageMinutes < 6 * 60) return { ageMinutes, phase: 'early', penalty: 0.1 }
  if (ageMinutes < 24 * 60) return { ageMinutes, phase: 'day one', penalty: 0.04 }
  if (ageMinutes < 7 * 24 * 60) return { ageMinutes, phase: 'week one', penalty: 0.02 }
  return { ageMinutes, phase: 'mature', penalty: 0.03 }
}

export function getHistoricalBaseline(video = {}, peerVideos = []) {
  const currentId = video.videoId
  const currentTags = new Set(video.tags || [])
  const peers = (peerVideos || []).filter(peer => {
    if (!peer || peer.videoId === currentId || peer.status === 'archived') return false
    const sameChannel = video.channelName && peer.channelName === video.channelName
    const sameTag = (peer.tags || []).some(tag => currentTags.has(tag))
    return sameChannel || sameTag
  })
  const velocities = peers.map(peer => numberOrNull(peer.velocity30m) ?? numberOrNull(peer.velocity1h) ?? numberOrNull(peer.sessionAvg)).filter(value => value !== null && value >= 0)
  return { count: velocities.length, velocity: median(velocities), peers }
}

function model(datapoints) {
  const points = getPredictionSeries(datapoints, { excludeBatchFlushes: true })
  const fit = fitDecayCurve(points)
  const windows = getAllVelocityWindows(points)
  const fallback = [windows.v5m, windows.v30m, windows.v1h, windows.sessionAvg].find(v => v !== null) ?? 0
  if (!fit) return { points, fit: null, velocity: Math.max(0, fallback), windows }
  const age = (points.at(-1).timestamp - fit.originTimestamp) / 60000
  return { points, fit, velocity: fit.v0 * Math.exp(-fit.k * age), windows }
}

export function getPredictionContext(datapoints, options = {}) {
  const now = options.now ?? Date.now()
  const base = model(datapoints)
  const acceleration = getVelocityAcceleration(base.points)
  const engagement = getEngagementSignal(base.points)
  const quality = getSampleQuality(cleanDatapoints(datapoints), now)
  const phase = getVideoPhase(options.video?.publishedAt ?? base.points[0]?.publishedAt, now)
  const baseline = getHistoricalBaseline(options.video, options.peerVideos)
  const baselineWeight = baseline.velocity !== null ? clamp((baseline.count / Math.max(1, baseline.count + quality.sampleCount)) * 0.45, 0, 0.3) : 0
  const accelerationMultiplier = clamp(1 + acceleration.score * 0.35, 0.78, 1.28)
  const engagementMultiplier = 1 + engagement.lift
  const blendedVelocity = baselineWeight
    ? base.velocity * (1 - baselineWeight) + baseline.velocity * baselineWeight
    : base.velocity
  const adjustedVelocity = Math.max(0, blendedVelocity * accelerationMultiplier * engagementMultiplier)
  return { ...base, velocity: adjustedVelocity, rawVelocity: base.velocity, acceleration, engagement, quality, phase, baseline, baselineWeight, accelerationMultiplier, engagementMultiplier }
}

export function projectViewsAtTime(datapoints, targetTimestamp, options = {}) {
  const points = cleanDatapoints(datapoints)
  if (!points.length) return null
  const last = points.at(-1), minutes = Math.max(0, (targetTimestamp - last.timestamp) / 60000)
  const context = getPredictionContext(points, options), k = context.fit?.k ?? 0
  const uncertainty = 0.3 + (1 - context.quality.score) * 0.7 + context.phase.penalty
  const projected = last.viewCount + integratedViews(context.velocity, k, minutes)
  const lower = last.viewCount + integratedViews(context.velocity * Math.max(0.25, 1 - uncertainty), context.fit ? k * 1.35 : 0, minutes)
  const upper = last.viewCount + integratedViews(context.velocity * (1 + uncertainty), context.fit ? k * 0.65 : 0, minutes)
  return { projected: Math.round(projected), low: Math.round(Math.min(lower, upper)), high: Math.round(Math.max(lower, upper)), context }
}

function minutesForGap(gap, velocity, decay) {
  if (gap <= 0) return 0
  if (velocity <= 0) return null
  if (decay <= 1e-9) return gap / velocity
  const ratio = gap * decay / velocity
  return ratio >= 1 ? null : -Math.log(1 - ratio) / decay
}

export function getTimeToMilestone(datapoints, targetCount, currentCount, options = {}) {
  const points = cleanDatapoints(datapoints)
  if (!points.length) return null
  const gap = targetCount - (Number.isFinite(currentCount) ? currentCount : points.at(-1).viewCount)
  const context = getPredictionContext(points, options), k = context.fit?.k ?? 0
  const base = minutesForGap(gap, context.velocity, k)
  if (base === null) return null
  const uncertainty = 0.3 + (1 - context.quality.score) * 0.7 + context.phase.penalty
  const fast = minutesForGap(gap, context.velocity * (1 + uncertainty), context.fit ? k * 0.65 : 0)
  const slow = minutesForGap(gap, context.velocity * Math.max(0.25, 1 - uncertainty), context.fit ? k * 1.35 : 0)
  const start = points.at(-1).timestamp
  return { estimatedAt: start + base * 60000, low: fast === null ? null : start + fast * 60000, high: slow === null ? null : start + slow * 60000, context }
}
