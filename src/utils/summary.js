import { getAllVelocityWindows, getEngagementSignal, getVelocityAcceleration } from './velocity.js'

const finite = value => Number.isFinite(Number(value))
const numberOrNull = value => finite(value) ? Number(value) : null
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
// Logistic approximation of the standard normal CDF (|error| < 0.01).
const normalCdf = x => 1 / (1 + Math.exp(-1.702 * x))

export function cleanSummaryPoints(datapoints = []) {
  return [...datapoints]
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
    .sort((left, right) => left.timestamp - right.timestamp)
}

export function buildVideoSummary(datapoints = [], existing = {}) {
  const points = cleanSummaryPoints(datapoints)
  if (!points.length) return {
    firstSampleAt: null,
    firstViewCount: null,
    lastPolledAt: null,
    lastViewCount: null,
    lastLikeCount: null,
    lastCommentCount: null,
    sampleCount: 0,
    sessionGain: 0,
    sessionAvg: null,
    peakVelocity: null,
    velocity5m: null,
    velocity30m: null,
    velocity1h: null,
    velocity3h: null,
    velocity6h: null,
    accelerationScore: 0,
    accelerationLabel: 'flat',
    engagementLift: 0,
    likeVelocity: null,
    commentVelocity: null,
    summaryUpdatedAt: Date.now(),
  }

  const first = points[0]
  const latest = points.at(-1)
  const windows = getAllVelocityWindows(points)
  const acceleration = getVelocityAcceleration(points)
  const engagement = getEngagementSignal(points)
  const elapsedMinutes = (latest.timestamp - first.timestamp) / 60000
  const pointPeak = Math.max(
    ...points
      .map(point => numberOrNull(point.velocityPerMin))
      .filter(value => value !== null),
    Number.NEGATIVE_INFINITY,
  )
  const existingPeak = numberOrNull(existing.peakVelocity)
  const peakVelocity = pointPeak === Number.NEGATIVE_INFINITY
    ? existingPeak
    : Math.max(existingPeak ?? pointPeak, pointPeak)

  return {
    firstSampleAt: first.timestamp,
    firstViewCount: first.viewCount,
    lastPolledAt: latest.timestamp,
    lastViewCount: latest.viewCount,
    lastLikeCount: latest.likeCount,
    lastCommentCount: latest.commentCount,
    sampleCount: points.length,
    sessionGain: latest.viewCount - first.viewCount,
    sessionAvg: elapsedMinutes > 0 ? (latest.viewCount - first.viewCount) / elapsedMinutes : null,
    peakVelocity,
    velocity5m: windows.v5m,
    velocity30m: windows.v30m,
    velocity1h: windows.v1h,
    velocity3h: windows.v3h,
    velocity6h: windows.v6h,
    accelerationScore: acceleration.score,
    accelerationLabel: acceleration.label,
    engagementLift: engagement.lift,
    likeVelocity: engagement.likeVelocity,
    commentVelocity: engagement.commentVelocity,
    summaryUpdatedAt: Date.now(),
  }
}

export function buildDeadlineSignal(summary = {}, milestone, now = Date.now()) {
  if (!milestone || !finite(milestone.deadlineTimestamp)) return null
  const currentCount = numberOrNull(summary.lastViewCount)
  const targetCount = numberOrNull(milestone.targetCount)
  if (currentCount === null || targetCount === null) return null

  const gap = targetCount - currentCount
  const minutesRemaining = (Number(milestone.deadlineTimestamp) - now) / 60000
  const baseVelocity = Math.max(0, [
    summary.velocity5m,
    summary.velocity30m,
    summary.velocity1h,
    summary.sessionAvg,
  ].map(numberOrNull).find(value => value !== null) ?? 0)
  const accelerationMultiplier = Math.max(0.78, Math.min(1.28, 1 + Number(summary.accelerationScore || 0) * 0.35))
  const engagementMultiplier = 1 + Math.max(0, Math.min(0.18, Number(summary.engagementLift || 0)))
  const currentVelocity = baseVelocity * accelerationMultiplier * engagementMultiplier
  const requiredVelocity = gap <= 0 ? 0 : minutesRemaining > 0 ? gap / minutesRemaining : Infinity
  const sampleCount = Number(summary.sampleCount || 0)
  const stalenessMinutes = summary.lastPolledAt ? Math.max(0, (now - Number(summary.lastPolledAt)) / 60000) : Infinity
  const agePenalty = summary.publishedAt ? 0 : 0.08
  const stalePenalty = Number.isFinite(stalenessMinutes) ? Math.max(0, Math.min(0.3, (stalenessMinutes - 30) / 240)) : 0.3
  const sampleScore = clamp(0.16 + (Math.min(sampleCount, 30) / 30) * 0.52, 0.16, 0.68)
  const confidenceScore = Math.max(0.05, Math.min(1, sampleScore - agePenalty - stalePenalty))
  const confidence = confidenceScore >= 0.52 ? 'medium' : confidenceScore >= 0.28 ? 'low' : 'very low'
  const reasons = [
    sampleCount < 8 ? 'few samples' : 'summary signal',
    summary.accelerationLabel && summary.accelerationLabel !== 'flat' ? summary.accelerationLabel : null,
    summary.engagementLift > 0.02 ? 'engagement lift' : null,
    stalePenalty > 0.05 ? 'latest sample stale' : null,
    !summary.publishedAt ? 'publish age unknown' : null,
  ].filter(Boolean)

  if (gap <= 0) return { probability: 1, confidence, confidenceScore, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity, reasons }
  if (minutesRemaining <= 0 || !Number.isFinite(requiredVelocity)) return { probability: 0, confidence, confidenceScore, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity, reasons }

  const ratio = requiredVelocity > 0 ? currentVelocity / requiredVelocity : 1
  // Lognormal pace model matching getMilestoneProbability: the chance that
  // sustained velocity clears the required pace, with spread widening as
  // summary evidence weakens and the deadline moves further out.
  const sigma = clamp(0.3 + (1 - confidenceScore) * 0.35 + clamp(minutesRemaining / (72 * 60), 0, 0.35), 0.35, 1.1)
  const probability = ratio <= 0 ? 0 : clamp(normalCdf(Math.log(ratio) / sigma), 0, 1)
  return { probability, confidence, confidenceScore, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity, reasons }
}
