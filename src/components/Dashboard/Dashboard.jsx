import VideoTile from '../VideoTile/VideoTile.jsx'

export default function Dashboard({ videos, vitals, onVitals, onAdd, onOpen, onCompare }) {
  if (!videos.length) return <main className="empty-state" onClick={onAdd}>
    <strong>0 tracks</strong><p>Press A to start tracking</p>
  </main>

  // soonest projected hit on top; sort is stable, so anything without a live ETA — no milestone,
  // already hit, or unreachable at the current rate — keeps its existing order underneath
  const ordered = [...videos].sort((a, b) =>
    (vitals[a.videoId]?.eta ?? Infinity) - (vitals[b.videoId]?.eta ?? Infinity))

  return <main className="dashboard" aria-label="Tracked videos">{ordered.map((video, index) =>
    <VideoTile key={video.videoId} video={video} index={index} onOpen={onOpen} onCompare={onCompare} onVitals={onVitals} />)}</main>
}
