import VideoTile from '../VideoTile/VideoTile.jsx'

export default function Dashboard({ videos, onAdd, onOpen, onCompare }) {
  if (!videos.length) return <main className="empty-state" onClick={onAdd}>
    <strong>0 tracks</strong><p>Press A to start tracking</p>
  </main>
  return <main className="dashboard" aria-label="Tracked videos">{videos.map((video, index) => <VideoTile key={video.videoId} video={video} index={index} onOpen={onOpen} onCompare={onCompare} />)}</main>
}
