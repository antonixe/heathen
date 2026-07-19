import { cleanDatapoints, getIntervals, getPredictionContext, getTimeToMilestone, integratedViews, projectViewsAtTime } from './velocity.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

function normal(random) {
  const a = Math.max(Number.EPSILON, random())
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * random())
}
function seededRandom(seed) {
  let state = seed >>> 0
  return () => { state += 0x6D2B79F5; let v = state; v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296 }
}

// Coefficient of variation of recent interval velocities. A steady release
// cannot produce a decay fit (the fitter requires k > 0), so realized
// stability is the evidence that stands in for one.
function velocityStability(context) {
  const velocities = getIntervals(context.points).slice(-12).map(row => row.velocity).filter(Number.isFinite)
  if (velocities.length < 4) return null
  const mean = velocities.reduce((sum, value) => sum + value, 0) / velocities.length
  if (mean <= 0) return null
  const variance = velocities.reduce((sum, value) => sum + (value - mean) ** 2, 0) / velocities.length
  return Math.sqrt(variance) / mean
}

function confidenceFrom(context, horizonMinutes, calibration) {
  const reasons = []
  const stability = velocityStability(context)
  let score = context.quality.score
  if (context.fit?.r2 >= 0.75) { score += 0.12; reasons.push('decay fit strong') }
  else if (context.fit?.r2 >= 0.5) { score += 0.05; reasons.push('decay fit usable') }
  else if (stability !== null && stability < 0.35) {
    score -= 0.06
    reasons.push('steady velocity, no decay fit')
  } else {
    score -= 0.18
    reasons.push('rolling velocity only')
  }

  if (context.quality.sampleCount < 8) reasons.push('few samples')
  if (context.quality.stalenessPenalty > 0.05) reasons.push('latest sample stale')
  if (context.quality.gapPenalty > 0.05) reasons.push('uneven polling gaps')
  if (context.quality.batchCount) reasons.push('batch flush adjusted')
  if (context.phase.phase === 'unknown') reasons.push('publish age unknown')
  else reasons.push(`${context.phase.phase} phase`)
  if (context.acceleration.label !== 'flat') reasons.push(context.acceleration.label)
  if (context.engagement.hasEngagement && context.engagement.lift > 0.02) reasons.push('engagement lift')
  if (context.baselineWeight > 0) reasons.push(`${context.baseline.count} peer baseline${context.baseline.count === 1 ? '' : 's'}`)

  // Horizon uncertainty is already priced into the probability spread
  // (uncertaintyFrom), so the label only takes a light discount for it.
  const horizonPenalty = clamp(horizonMinutes / (72 * 60), 0, 0.15)
  if (horizonPenalty >= 0.12) reasons.push('long horizon')
  if (calibration?.ready) {
    score += 0.05
    reasons.push('calibrated on ' + calibration.count + ' outcomes')
  } else {
    score = Math.min(score, 0.74)
    reasons.push('heuristic, not yet calibrated')
  }
  score = clamp(score - context.phase.penalty - horizonPenalty, 0.05, 1)
  const label = score >= 0.78 ? 'high' : score >= 0.52 ? 'medium' : score >= 0.28 ? 'low' : 'very low'
  return { score, label, reasons: [...new Set(reasons)] }
}

function uncertaintyFrom(context, horizonMinutes) {
  // Without a decay fit, uncertainty follows measured velocity variability
  // instead of a flat worst-case penalty; a release holding a steady rate is
  // strong evidence, not missing evidence.
  const stability = velocityStability(context)
  const fitSigma = context.fit ? 0.2 : stability === null ? 0.42 : clamp(stability * 1.1, 0.16, 0.42)
  const qualitySigma = (1 - context.quality.score) * 0.55
  // Hour-scale fluctuations largely average out across a day, so the horizon
  // penalty grows slower and caps lower than the old 36h/0.45 curve.
  const horizonSigma = clamp(horizonMinutes / (72 * 60), 0, 0.35)
  const phaseSigma = context.phase.penalty
  const accelerationSigma = Math.abs(context.acceleration.score) * 0.18
  return clamp(fitSigma + qualitySigma + horizonSigma + phaseSigma + accelerationSigma, 0.12, 1.25)
}


export function buildProbabilityCalibration(snapshots = [], minimumOutcomes = 30) {
  const rows = (snapshots || []).filter(row =>
    Number.isFinite(Number(row.probability)) &&
    Number(row.probability) >= 0 &&
    Number(row.probability) <= 1 &&
    (row.outcome === 'hit' || row.outcome === 'missed')
  )
  const bins = Array.from({ length: 10 }, (_, index) => ({
    index,
    midpoint: (index + 0.5) / 10,
    count: 0,
    hits: 0,
    probabilityTotal: 0,
  }))
  let squaredError = 0
  rows.forEach(row => {
    const probability = Number(row.probability)
    const outcome = row.outcome === 'hit' ? 1 : 0
    const bin = bins[Math.min(9, Math.floor(probability * 10))]
    bin.count += 1
    bin.hits += outcome
    bin.probabilityTotal += probability
    squaredError += (probability - outcome) ** 2
  })
  const calibratedBins = bins.map(bin => ({
    ...bin,
    meanProbability: bin.count ? bin.probabilityTotal / bin.count : bin.midpoint,
    observedRate: bin.count ? (bin.hits + bin.midpoint * 4) / (bin.count + 4) : bin.midpoint,
  }))
  return {
    count: rows.length,
    ready: rows.length >= minimumOutcomes,
    brierScore: rows.length ? squaredError / rows.length : null,
    bins: calibratedBins,
  }
}

export function applyProbabilityCalibration(probability, calibration) {
  const raw = clamp(Number(probability) || 0, 0, 1)
  if (!calibration?.ready || !Array.isArray(calibration.bins)) return raw
  const bin = calibration.bins[Math.min(9, Math.floor(raw * 10))]
  if (!bin?.count) return raw
  const empiricalWeight = clamp(bin.count / 20, 0, 0.65)
  return clamp(raw * (1 - empiricalWeight) + bin.observedRate * empiricalWeight, 0, 1)
}
export function getMilestoneProbability(datapoints, targetCount, deadlineTimestamp, options = {}) {
  const points = cleanDatapoints(datapoints)
  if (!points.length || !Number.isFinite(targetCount) || !Number.isFinite(deadlineTimestamp)) return null
  const now = options.now ?? Date.now()
  const current = Number(points.at(-1).viewCount)
  const gap = targetCount - current
  const minutesRemaining = (deadlineTimestamp - now) / 60000
  const horizon = Math.max(0, (deadlineTimestamp - points.at(-1).timestamp) / 60000)
  const context = getPredictionContext(points, options)
  const currentVelocity = context.velocity
  const requiredVelocity = gap <= 0 ? 0 : minutesRemaining > 0 ? gap / minutesRemaining : Infinity
  const projection = projectViewsAtTime(points, deadlineTimestamp, options) ?? { projected: current, low: current, high: current }
  const hit = getTimeToMilestone(points, targetCount, current, options)
  const confidence = confidenceFrom(context, horizon, options.calibration)

  if (gap <= 0 || minutesRemaining <= 0) return {
    probability: gap <= 0 ? 1 : 0,
    requiredVelocity,
    currentVelocity,
    cushion: currentVelocity - requiredVelocity,
    projectedAtDeadline: projection.projected,
    projectedRange: { low: projection.low, high: projection.high },
    estimatedHitTime: gap <= 0 ? points.at(-1).timestamp : null,
    confidence: confidence.label,
    confidenceScore: confidence.score,
    reasons: confidence.reasons,
    context,
  }

  const simulations = options.simulations ?? 800
  const random = options.random ?? seededRandom((points.length * 2654435761 + Math.round(targetCount) + Math.round(deadlineTimestamp / 60000)) >>> 0)
  const sigma = uncertaintyFrom(context, horizon)
  let reached = 0
  for (let i = 0; i < simulations; i += 1) {
    const sampledK = context.fit ? Math.max(0, context.fit.k * Math.exp(normal(random) * sigma * 0.35)) : 0
    const sampledVelocity = Math.max(0, context.velocity * Math.exp(normal(random) * sigma))
    if (current + integratedViews(sampledVelocity, sampledK, horizon) >= targetCount) reached += 1
  }

  const rawProbability = reached / simulations
  return {
    probability: applyProbabilityCalibration(rawProbability, options.calibration),
    rawProbability,
    requiredVelocity,
    currentVelocity,
    cushion: currentVelocity - requiredVelocity,
    projectedAtDeadline: projection.projected,
    projectedRange: { low: projection.low, high: projection.high },
    estimatedHitTime: hit?.estimatedAt <= deadlineTimestamp ? hit.estimatedAt : null,
    confidence: confidence.label,
    confidenceScore: confidence.score,
    reasons: confidence.reasons,
    context,
  }
}
