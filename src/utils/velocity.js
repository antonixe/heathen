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

// Views gained across an arbitrary span, interpolating between samples. Returns null when the
// history does not reach back to `from`, so a partial window is never reported as a real figure.
export function viewsBetween(datapoints, fromTimestamp, toTimestamp) {
  const points = clean(datapoints)
  if (points.length < 2) return null
  const last = points.at(-1)
  const from = valueAt(points, fromTimestamp)
  const to = toTimestamp >= last.timestamp ? last.viewCount : valueAt(points, toTimestamp)
  return from === null || to === null ? null : to - from
}

// Rolling-window velocity at every sample. Per-sample deltas are useless here: YouTube reveals
// views in batch flushes, so most raw intervals are 0 and get dropped, leaving only the spikes —
// which inflates the fitted v0 several-fold. A window spanning whole flush cycles averages them out.
// The left pointer only moves forward, so this stays linear even though it runs on every render.
function rollingSeries(points, windowMinutes) {
  const span = windowMinutes * 60000, rows = []
  let left = 0
  for (let i = 0; i < points.length; i += 1) {
    const cutoff = points[i].timestamp - span
    if (points[0].timestamp > cutoff) continue
    while (left + 1 < i && points[left + 1].timestamp <= cutoff) left += 1
    const a = points[left], b = points[left + 1] ?? a
    const start = b.timestamp === a.timestamp ? a.viewCount
      : a.viewCount + (b.viewCount - a.viewCount) * ((cutoff - a.timestamp) / (b.timestamp - a.timestamp))
    rows.push({ timestamp: points[i].timestamp, velocity: (points[i].viewCount - start) / windowMinutes })
  }
  return rows
}

export function getAllVelocityWindows(datapoints) {
  const points = clean(datapoints)
  const minutes = points.length > 1 ? (points.at(-1).timestamp - points[0].timestamp) / 60000 : 0
  return {
    v5m: getRollingVelocity(points, 5), v30m: getRollingVelocity(points, 30), v1h: getRollingVelocity(points, 60),
    sessionAvg: minutes > 0 ? (points.at(-1).viewCount - points[0].viewCount) / minutes : null,
  }
}

export function detectBatchFlush(datapoints, thresholdMultiplier = 5) {
  const points = clean(datapoints), flagged = []
  // one linear pass for every baseline, rather than re-slicing and rescanning the history per sample
  const baselines = new Map(rollingSeries(points, 30).map(row => [row.timestamp, row.velocity]))
  for (let i = 2; i < points.length; i += 1) {
    const minutes = (points[i].timestamp - points[i - 1].timestamp) / 60000
    if (minutes <= 0) continue
    const spike = (points[i].viewCount - points[i - 1].viewCount) / minutes
    const baseline = baselines.get(points[i - 1].timestamp)   // window ending at the preceding sample
    if (baseline > 0 && spike > baseline * thresholdMultiplier) flagged.push(i)
  }
  return flagged
}

// Divides the daily shape out before regressing. A day/night cycle is not exponential decay, so
// left in it wrecks r² and the fit gets rejected exactly when the swing is strongest — which is
// when the projection most needs a decay rate. Deseasonalised, the fit sees the trend alone.
export function fitDecayCurve(datapoints, profile = hourlyProfile(datapoints)) {
  const points = clean(datapoints)
  if (points.length < 2) return null
  const rows = rollingSeries(points, 30)
    .map(row => ({ timestamp: row.timestamp, velocity: row.velocity / (profile?.[new Date(row.timestamp).getHours()] || 1) }))
    .filter(row => row.velocity > 0)
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
  // Standard errors straight from the regression, so the band tracks fit quality instead of a guess.
  // logSE is the prediction SE at the latest sample: the leading 1 covers scatter about the line,
  // which is what keeps a tight in-sample fit from claiming a near-zero forecast error.
  const sigma = xs.length > 2 ? Math.sqrt(residual / (xs.length - 2)) : 0
  const kSE = sigma / Math.sqrt(denominator)
  const logSE = sigma * Math.sqrt(1 + 1 / xs.length + (xs.at(-1) - meanX) ** 2 / denominator)
  return k > 0 && r2 >= 0.4 ? { k, v0: Math.exp(intercept), r2, originTimestamp, kSE, logSE } : null
}

const DAY_MINUTES = 24 * 60

// Hour-of-day shape as multipliers around 1.0, in the viewer's local timezone.
// Each 30m reading is divided by the 24h window ending at the same instant before bucketing:
// a 24h window spans exactly one cycle, so what survives is the time-of-day shape with the decay
// trend divided out. Skip that step and an early, faster day just looks like "mornings are strong".
export function hourlyProfile(datapoints) {
  const points = clean(datapoints)
  if (points.length < 2) return null
  const baseline = new Map(rollingSeries(points, DAY_MINUTES).map(row => [row.timestamp, row.velocity]))
  const sums = Array(24).fill(0), counts = Array(24).fill(0)
  let first = null, last = null
  for (const row of rollingSeries(points, 30)) {
    const base = baseline.get(row.timestamp)
    if (!base || base <= 0 || row.velocity <= 0) continue
    const hour = new Date(row.timestamp).getHours()
    sums[hour] += row.velocity / base
    counts[hour] += 1
    first ??= row.timestamp
    last = row.timestamp
  }
  const seen = counts.filter(Boolean).length
  if (!seen) return null
  const means = sums.map((sum, hour) => counts[hour] ? sum / counts[hour] : null)
  const average = means.filter(v => v !== null).reduce((s, v) => s + v, 0) / seen
  if (!average) return null
  // unobserved hours sit at 1.0, then a 3-hour circular smooth takes the edge off thin buckets
  const raw = means.map(v => v === null ? 1 : v / average)
  const smoothed = raw.map((_, h) => (raw[(h + 23) % 24] + raw[h] + raw[(h + 1) % 24]) / 3)
  // One noisy day should not swing a projection, so shrink toward flat until ~2 days have accrued.
  const weight = Math.min(1, (last - first) / (2 * DAY_MINUTES * 60000))
  return smoothed.map(v => 1 + (v - 1) * weight)
}

// Average busyness of the hours being projected across. Multiplies a deseasonalised base velocity
// (see model), so there is no division by the current hour here — doing that as well would correct
// twice. Decay-weighted, so on long horizons the near hours that supply most of the views dominate.
export function seasonalFactor(profile, fromTimestamp, minutes, decay = 0) {
  if (!profile || !(minutes > 0)) return 1
  let weighted = 0, total = 0
  for (let m = 0; m < minutes; m += 60) {
    const w = Math.exp(-decay * m)
    weighted += profile[new Date(fromTimestamp + m * 60000).getHours()] * w
    total += w
  }
  return total ? weighted / total : 1
}

export function integratedViews(velocity, decay, minutes) {
  if (minutes <= 0 || velocity <= 0) return 0
  return Math.abs(decay) < 1e-9 ? velocity * minutes : velocity * (1 - Math.exp(-decay * minutes)) / decay
}

// `velocity` is a DESEASONALISED base level: multiply it by an hour's profile entry to get the
// expected velocity in that hour. The two sources need different treatment to get there — a 30m
// window carries the current hour's shape, whereas the regression averages over whole cycles.
export function model(datapoints) {
  const points = clean(datapoints), profile = hourlyProfile(points)
  const fit = fitDecayCurve(points, profile), windows = getAllVelocityWindows(points)
  // decisions run off the 30m window; v5m is display-only (too noisy to steer on)
  const fallback = [windows.v30m, windows.v1h, windows.sessionAvg].find(v => v !== null) ?? 0
  // the fit already regressed on deseasonalised rows, so its level is a base level; a raw window is not
  if (!fit) {
    const hour = profile?.[new Date(points.at(-1).timestamp).getHours()] || 1
    return { fit: null, profile, velocity: Math.max(0, fallback) / hour }
  }
  const age = (points.at(-1).timestamp - fit.originTimestamp) / 60000
  return { fit, profile, velocity: fit.v0 * Math.exp(-fit.k * age) }
}

// 95% bounds on (velocity, decay). With a fit they come from its standard errors; without one there
// is nothing to estimate from, so a flat ±30% stands in. Slow decay pairs with fast velocity.
const Z = 1.96
export function modelBounds(fit, velocity) {
  if (!fit) return { slow: { velocity: velocity * 0.7, k: 0 }, fast: { velocity: velocity * 1.3, k: 0 } }
  return {
    slow: { velocity: velocity * Math.exp(-Z * fit.logSE), k: fit.k + Z * fit.kSE },
    fast: { velocity: velocity * Math.exp(Z * fit.logSE), k: Math.max(0, fit.k - Z * fit.kSE) },
  }
}

export function projectViewsAtTime(datapoints, targetTimestamp) {
  const points = clean(datapoints)
  if (!points.length) return null
  const last = points.at(-1), minutes = Math.max(0, (targetTimestamp - last.timestamp) / 60000)
  const { fit, profile, velocity } = model(points), k = fit?.k ?? 0
  const shape = seasonalFactor(profile, last.timestamp, minutes, k)
  const projected = last.viewCount + integratedViews(velocity, k, minutes) * shape
  const { slow, fast } = modelBounds(fit, velocity)
  const lower = last.viewCount + integratedViews(slow.velocity, slow.k, minutes) * shape
  const upper = last.viewCount + integratedViews(fast.velocity, fast.k, minutes) * shape
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
  const { fit, profile, velocity } = model(points), k = fit?.k ?? 0
  const start = points.at(-1).timestamp
  // The horizon is what we are solving for, so guess it, price the hours it spans, solve again.
  // Converges in a couple of passes because a longer estimate can only pull in later hours.
  let base = minutesForGap(gap, velocity, k)
  if (base === null) return null
  let shape = 1
  for (let pass = 0; pass < 3; pass += 1) {
    shape = seasonalFactor(profile, start, base, k)
    const next = minutesForGap(gap, velocity * shape, k)
    if (next === null) return null
    base = next
  }
  const bounds = modelBounds(fit, velocity)
  const fast = minutesForGap(gap, bounds.fast.velocity * shape, bounds.fast.k)
  const slow = minutesForGap(gap, bounds.slow.velocity * shape, bounds.slow.k)
  return { estimatedAt: start + base * 60000, low: fast === null ? null : start + fast * 60000, high: slow === null ? null : start + slow * 60000 }
}
