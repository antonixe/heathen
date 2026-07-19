const FIVE_MINUTES_MS = 5 * 60 * 1000

const finite = value => Number.isFinite(Number(value))
const bucket = value => Math.round(Number(value) / FIVE_MINUTES_MS) * FIVE_MINUTES_MS

const putSeries = (map, rows, series, mode, video = {}) => {
  if (!rows.length) return
  const firstTimestamp = Number(rows[0].timestamp)
  const firstViewCount = Number(rows[0].viewCount || 0)
  const publishedAt = finite(video.publishedAt) ? Number(video.publishedAt) : null

  rows.forEach(point => {
    const timestamp = Number(point.timestamp)
    let x
    let value
    if (mode === 'tracking') {
      x = Math.round((timestamp - firstTimestamp) / FIVE_MINUTES_MS) * 5
      value = Number(point.viewCount || 0) - firstViewCount
    } else if (mode === 'publish') {
      if (publishedAt === null) return
      x = Math.round((timestamp - publishedAt) / FIVE_MINUTES_MS) * 5
      value = Number(point.viewCount || 0)
    } else {
      x = bucket(timestamp)
      value = Number(point.viewCount || 0)
    }
    map.set(x, { ...(map.get(x) || { x }), [series]: value })
  })
}

export function buildComparisonSeries(rowsA = [], rowsB = [], mode = 'tracking', videoA = {}, videoB = {}) {
  const map = new Map()
  putSeries(map, rowsA, 'a', mode, videoA)
  putSeries(map, rowsB, 'b', mode, videoB)
  return [...map.values()].sort((left, right) => left.x - right.x)
}

export function canCompareSeries(rowsA = [], rowsB = [], mode = 'tracking', videoA = {}, videoB = {}) {
  if (rowsA.length < 2 || rowsB.length < 2) return { ready: false, reason: 'Each release needs at least two observations.' }
  if (mode === 'publish' && (!finite(videoA.publishedAt) || !finite(videoB.publishedAt))) {
    return { ready: false, reason: 'Published time is required for both releases.' }
  }
  return { ready: true, reason: '' }
}
