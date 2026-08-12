import { getAllVelocityWindows, integratedViews, model, projectViewsAtTime, getTimeToMilestone, seasonalFactor } from './velocity.js'

function normal(random) {
  const a = Math.max(Number.EPSILON, random())
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random())
}
function seededRandom(seed) {
  let state = seed >>> 0
  return () => { state += 0x6D2B79F5; let v = state; v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296 }
}

export function getMilestoneProbability(datapoints, targetCount, deadlineTimestamp, options = {}) {
  const points = [...(datapoints || [])].sort((a, b) => a.timestamp - b.timestamp)
  if (!points.length || !Number.isFinite(targetCount) || !Number.isFinite(deadlineTimestamp)) return null
  const now = options.now ?? Date.now(), current = Number(points.at(-1).viewCount), gap = targetCount - current
  const minutesRemaining = (deadlineTimestamp - now) / 60000, windows = getAllVelocityWindows(points)
  const currentVelocity = Math.max(0, [windows.v30m, windows.v1h, windows.sessionAvg].find(v => v !== null) ?? 0)
  const requiredVelocity = gap <= 0 ? 0 : minutesRemaining > 0 ? gap / minutesRemaining : Infinity
  const projection = projectViewsAtTime(points, deadlineTimestamp) ?? { projected: current, low: current, high: current }
  const { fit, profile, velocity } = model(points), hit = getTimeToMilestone(points, targetCount, current)
  const confidence = fit?.r2 >= 0.75 && points.length >= 20 ? 'high' : fit?.r2 >= 0.5 && points.length >= 10 ? 'medium' : 'low'
  if (gap <= 0 || minutesRemaining <= 0) return {
    probability: gap <= 0 ? 1 : 0, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity,
    projectedAtDeadline: projection.projected, projectedRange: { low: projection.low, high: projection.high },
    estimatedHitTime: gap <= 0 ? points.at(-1).timestamp : null, confidence,
  }
  const horizon = Math.max(0, (deadlineTimestamp - points.at(-1).timestamp) / 60000)
  const simulations = options.simulations ?? 500
  const random = options.random ?? seededRandom((points.length * 2654435761 + Math.round(targetCount) + Math.round(deadlineTimestamp / 60000)) >>> 0)
  // same hour-of-day correction the projection uses, so the two numbers cannot disagree
  const shape = seasonalFactor(profile, points.at(-1).timestamp, horizon, fit?.k ?? 0)
  let reached = 0
  for (let i = 0; i < simulations; i += 1) {
    // draw from the regression's own standard errors — velocity is lognormal since the fit is in log space.
    // Without a fit there is nothing to estimate from, so a flat 25% CV stands in.
    const k = fit ? Math.max(0, fit.k + normal(random) * fit.kSE) : 0
    const sampledVelocity = fit
      ? velocity * Math.exp(normal(random) * fit.logSE)
      : Math.max(0, velocity * (1 + normal(random) * 0.25))
    if (current + integratedViews(sampledVelocity, k, horizon) * shape >= targetCount) reached += 1
  }
  return {
    probability: reached / simulations, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity,
    projectedAtDeadline: projection.projected, projectedRange: { low: projection.low, high: projection.high },
    estimatedHitTime: hit?.estimatedAt <= deadlineTimestamp ? hit.estimatedAt : null, confidence,
  }
}
