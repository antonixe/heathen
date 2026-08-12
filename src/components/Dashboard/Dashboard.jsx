import { useCallback, useState } from 'react'
import VideoTile from '../VideoTile/VideoTile.jsx'

export default function Dashboard({ videos, onAdd, onOpen, onCompare }) {
  // Each tile already computes its own ETA from data only it has loaded, so it reports the number
  // up rather than the dashboard re-querying every video's history to sort by it.
  const [etas, setEtas] = useState({})
  const reportEta = useCallback((videoId, at) => {
    setEtas(previous => previous[videoId] === at ? previous : { ...previous, [videoId]: at })
  }, [])

  if (!videos.length) return <main className="empty-state" onClick={onAdd}>
    <strong>0 tracks</strong><p>Press A to start tracking</p>
  </main>

  // soonest projected hit on top; sort is stable, so anything without a live ETA — no milestone,
  // already hit, or unreachable at the current rate — keeps its existing order underneath
  const ordered = [...videos].sort((a, b) => (etas[a.videoId] ?? Infinity) - (etas[b.videoId] ?? Infinity))

  return <main className="dashboard" aria-label="Tracked videos">{ordered.map((video, index) =>
    <VideoTile key={video.videoId} video={video} index={index} onOpen={onOpen} onCompare={onCompare} onEta={reportEta} />)}</main>
}
