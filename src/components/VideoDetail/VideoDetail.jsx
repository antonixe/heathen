import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db.js'
import { downloadFile, videoToCsv } from '../../utils/export.js'
import VelocityChart from './VelocityChart.jsx'
import HeatmapGrid from './HeatmapGrid.jsx'
import MilestonePanel from './MilestonePanel.jsx'
import NotesLog from './NotesLog.jsx'
import SessionLog from './SessionLog.jsx'

export default function VideoDetail({ video, onClose }) {
  const points = useLiveQuery(() => db.datapoints.where('videoId').equals(video.videoId).sortBy('timestamp'), [video.videoId], [])
  const notes = useLiveQuery(() => db.notes.where('videoId').equals(video.videoId).sortBy('timestamp'), [video.videoId], [])
  const milestones = useLiveQuery(() => db.milestones.where('videoId').equals(video.videoId).sortBy('createdAt'), [video.videoId], [])
  const [moreOpen, setMoreOpen] = useState(false)
  const paused = video.pollState === 'paused'

  return <div className="detail-page" role="dialog" aria-modal="true" aria-label={`${video.customLabel || video.title} detail`}>
    <header className="detail-top"><div className="detail-heading"><button className="detail-back" onClick={onClose} aria-label="Back to dashboard">←</button><h1>{video.customLabel || video.title}</h1></div><div className="detail-actions"><button onClick={() => db.videos.update(video.id, { pollState: paused ? 'idle' : 'paused' })}>{paused ? 'Resume' : 'Pause'}</button><button onClick={() => downloadFile(`${video.videoId}.csv`, videoToCsv(points, notes), 'text/csv')}>Export CSV</button><div className="detail-more"><button className="menu-trigger" onClick={() => setMoreOpen(value => !value)} aria-label="More actions" aria-expanded={moreOpen}><span /><span /><span /></button>{moreOpen && <div className="track-menu"><button onClick={() => db.videos.update(video.id, { status: 'archived' })}>Archive track</button></div>}</div></div></header>
    <div className="detail-layout"><aside className="detail-sidebar"><section className="detail-section metadata-section"><h3>METADATA</h3><label>CUSTOM LABEL<input defaultValue={video.customLabel || ''} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} onBlur={event => db.videos.update(video.id, { customLabel: event.target.value.trim() })} /></label><div className="metadata-id"><span>{video.channelName}</span><code>{video.videoId}</code></div><label>TAGS<input defaultValue={(video.tags || []).join(', ')} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} onBlur={event => db.videos.update(video.id, { tags: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label><label>POLL INTERVAL<select value={video.pollInterval || 60} onChange={event => db.videos.update(video.id, { pollInterval: Number(event.target.value) })}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option></select></label><p className="help">Added {new Date(video.addedAt).toLocaleString()}</p></section><MilestonePanel videoId={video.videoId} points={points} milestones={milestones} /><NotesLog videoId={video.videoId} notes={notes} /><SessionLog video={video} points={points} notes={notes} /></aside><main className="detail-main"><VelocityChart points={points} notes={notes} milestones={milestones} /><HeatmapGrid datapoints={points} /></main></div>
  </div>
}
