import { db, addObservation, recordPollEvent } from '../db/db.js'

// Raw view of the data branch maintained by .github/workflows/collect.yml.
export const SNAPSHOTS_URL = 'https://raw.githubusercontent.com/antonixe/heathen/data/snapshots.json'

export function selectBackfillPoints(snapshots, videos) {
  const lastByVideo = new Map(
    (videos || [])
      .filter(video => video.status === 'active')
      .map(video => [video.videoId, Number(video.lastPolledAt) || 0]),
  )
  return (Array.isArray(snapshots) ? snapshots : [])
    .filter(row => row
      && lastByVideo.has(row.videoId)
      && Number.isFinite(Number(row.timestamp))
      && Number.isFinite(Number(row.viewCount))
      && Number(row.timestamp) > lastByVideo.get(row.videoId))
    .sort((a, b) => a.timestamp - b.timestamp)
}

async function applySnapshots(snapshots) {
  const videos = await db.videos.toArray()
  const points = selectBackfillPoints(snapshots, videos)
  // ponytail: sequential replay through addObservation, ~1s per 100 points.
  // Batch-insert datapoints directly if week-long gaps ever feel slow on load.
  for (const point of points) {
    await addObservation(point.videoId, point.viewCount, point.timestamp, {
      likeCount: point.likeCount,
      commentCount: point.commentCount,
    }).catch(() => {})
  }
  if (points.length) {
    await recordPollEvent({ type: 'backfill', message: `Merged ${points.length} cloud-collected samples.` }).catch(() => {})
  }
  return points.length
}

export async function runBackfill() {
  let snapshots
  try {
    const response = await fetch(SNAPSHOTS_URL, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!response.ok) return 0
    snapshots = await response.json()
  } catch {
    return 0
  }
  // Web lock serializes tabs: the loser re-reads lastPolledAt and finds nothing left to apply.
  if (navigator.locks?.request) {
    return navigator.locks.request('velocityDesk.backfill', () => applySnapshots(snapshots))
  }
  return applySnapshots(snapshots)
}
