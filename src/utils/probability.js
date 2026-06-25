import { fitDecayCurve, getAllVelocityWindows, integratedViews, projectViewsAtTime, getTimeToMilestone } from './velocity.js'

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
  const currentVelocity = Math.max(0, [windows.v5m, windows.v30m, windows.v1h, windows.sessionAvg].find(v => v !== null) ?? 0)
  const requiredVelocity = gap <= 0 ? 0 : minutesRemaining > 0 ? gap / minutesRemaining : Infinity
  const projection = projectViewsAtTime(points, deadlineTimestamp) ?? { projected: current, low: current, high: current }
  const fit = fitDecayCurve(points), hit = getTimeToMilestone(points, targetCount, current)
  const confidence = fit?.r2 >= 0.75 && points.length >= 20 ? 'high' : fit?.r2 >= 0.5 && points.length >= 10 ? 'medium' : 'low'
  if (gap <= 0 || minutesRemaining <= 0) return {
    probability: gap <= 0 ? 1 : 0, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity,
    projectedAtDeadline: projection.projected, projectedRange: { low: projection.low, high: projection.high },
    estimatedHitTime: gap <= 0 ? points.at(-1).timestamp : null, confidence,
  }
  const horizon = Math.max(0, (deadlineTimestamp - points.at(-1).timestamp) / 60000)
  const age = fit ? (points.at(-1).timestamp - fit.originTimestamp) / 60000 : 0
  const velocity = fit ? fit.v0 * Math.exp(-fit.k * age) : currentVelocity
  const simulations = options.simulations ?? 500
  const random = options.random ?? seededRandom((points.length * 2654435761 + Math.round(targetCount) + Math.round(deadlineTimestamp / 60000)) >>> 0)
  let reached = 0
  for (let i = 0; i < simulations; i += 1) {
    const k = fit ? Math.max(0, fit.k + normal(random) * fit.k * 0.2) : 0
    const sampledVelocity = Math.max(0, velocity * (1 + normal(random) * (fit ? 0.08 : 0.25)))
    if (current + integratedViews(sampledVelocity, k, horizon) >= targetCount) reached += 1
  }
  return {
    probability: reached / simulations, requiredVelocity, currentVelocity, cushion: currentVelocity - requiredVelocity,
    projectedAtDeadline: projection.projected, projectedRange: { low: projection.low, high: projection.high },
    estimatedHitTime: hit?.estimatedAt <= deadlineTimestamp ? hit.estimatedAt : null, confidence,
  }
}
