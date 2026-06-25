function clean(datapoints) {
  return [...(datapoints || [])]
    .filter(point => Number.isFinite(Number(point.timestamp)) && Number.isFinite(Number(point.viewCount)))
    .map(point => ({ ...point, timestamp: Number(point.timestamp), viewCount: Number(point.viewCount) }))
    .sort((a, b) => a.timestamp - b.timestamp)
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
  const points = clean(datapoints)
  if (points.length < 2 || !Number.isFinite(windowMinutes) || windowMinutes <= 0) return null
  const cutoff = points.at(-1).timestamp - windowMinutes * 60000
  if (points[0].timestamp > cutoff) return null
  const start = valueAt(points, cutoff)
  return start === null ? null : (points.at(-1).viewCount - start) / windowMinutes
}

function intervals(datapoints) {
  const points = clean(datapoints)
  return points.slice(1).map((point, i) => {
    const minutes = (point.timestamp - points[i].timestamp) / 60000
    return minutes > 0 ? { timestamp: point.timestamp, velocity: (point.viewCount - points[i].viewCount) / minutes } : null
  }).filter(Boolean)
}

export function getAllVelocityWindows(datapoints) {
  const points = clean(datapoints), rows = intervals(points)
  const minutes = points.length > 1 ? (points.at(-1).timestamp - points[0].timestamp) / 60000 : 0
  return {
    v5m: getRollingVelocity(points, 5), v30m: getRollingVelocity(points, 30),
    v1h: getRollingVelocity(points, 60), v3h: getRollingVelocity(points, 180), v6h: getRollingVelocity(points, 360),
    sessionAvg: minutes > 0 ? (points.at(-1).viewCount - points[0].viewCount) / minutes : null,
    peak: rows.length ? Math.max(...rows.map(row => row.velocity)) : null,
  }
}

export function detectBatchFlush(datapoints, thresholdMultiplier = 5) {
  const points = clean(datapoints), flagged = []
  for (let i = 2; i < points.length; i += 1) {
    const minutes = (points[i].timestamp - points[i - 1].timestamp) / 60000
    if (minutes <= 0) continue
    const spike = (points[i].viewCount - points[i - 1].viewCount) / minutes
    const baseline = getRollingVelocity(points.slice(0, i), 30)
    if (baseline !== null && baseline > 0 && spike > baseline * thresholdMultiplier) flagged.push(i)
  }
  return flagged
}

export function fitDecayCurve(datapoints) {
  const rows = intervals(datapoints).filter(row => row.velocity > 0)
  if (rows.length < 6) return null
  const originTimestamp = rows[0].timestamp
  const xs = rows.map(row => (row.timestamp - originTimestamp) / 60000)
  const ys = rows.map(row => Math.log(row.velocity))
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

function model(datapoints) {
  const points = clean(datapoints), fit = fitDecayCurve(points), windows = getAllVelocityWindows(points)
  const fallback = [windows.v5m, windows.v30m, windows.v1h, windows.sessionAvg].find(v => v !== null) ?? 0
  if (!fit) return { fit: null, velocity: Math.max(0, fallback) }
  const age = (points.at(-1).timestamp - fit.originTimestamp) / 60000
  return { fit, velocity: fit.v0 * Math.exp(-fit.k * age) }
}

export function projectViewsAtTime(datapoints, targetTimestamp) {
  const points = clean(datapoints)
  if (!points.length) return null
  const last = points.at(-1), minutes = Math.max(0, (targetTimestamp - last.timestamp) / 60000)
  const { fit, velocity } = model(points), k = fit?.k ?? 0
  const projected = last.viewCount + integratedViews(velocity, k, minutes)
  const lower = last.viewCount + integratedViews(fit ? velocity : velocity * 0.7, fit ? k * 1.3 : 0, minutes)
  const upper = last.viewCount + integratedViews(fit ? velocity : velocity * 1.3, fit ? k * 0.7 : 0, minutes)
  return { projected: Math.round(projected), low: Math.round(Math.min(lower, upper)), high: Math.round(Math.max(lower, upper)) }
}

function minutesForGap(gap, velocity, decay) {
  if (gap <= 0) return 0
  if (velocity <= 0) return null
  if (decay <= 1e-9) return gap / velocity
  const ratio = gap * decay / velocity
  return ratio >= 1 ? null : -Math.log(1 - ratio) / decay
}

export function getTimeToMilestone(datapoints, targetCount, currentCount) {
  const points = clean(datapoints)
  if (!points.length) return null
  const gap = targetCount - (Number.isFinite(currentCount) ? currentCount : points.at(-1).viewCount)
  const { fit, velocity } = model(points), k = fit?.k ?? 0
  const base = minutesForGap(gap, velocity, k)
  if (base === null) return null
  const fast = minutesForGap(gap, fit ? velocity : velocity * 1.3, fit ? k * 0.7 : 0)
  const slow = minutesForGap(gap, fit ? velocity : velocity * 0.7, fit ? k * 1.3 : 0)
  const start = points.at(-1).timestamp
  return { estimatedAt: start + base * 60000, low: fast === null ? null : start + fast * 60000, high: slow === null ? null : start + slow * 60000 }
}
