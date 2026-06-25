import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/db.js'
import { getAllVelocityWindows, getTimeToMilestone } from '../../utils/velocity.js'
import { getMilestoneProbability } from '../../utils/probability.js'
import AnimatedCount from '../shared/AnimatedCount.jsx'
import MiniSparkline from './MiniSparkline.jsx'

const metric = value => value === null || value === undefined ? '—' : value.toFixed(1)
const age = timestamp => {
  if (!timestamp) return 'Never updated'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  return seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.floor(seconds / 60)}m ago`
}

export default function VideoTile({ video, index, onOpen, onCompare }) {
  const points = useLiveQuery(() => db.datapoints.where('videoId').equals(video.videoId).sortBy('timestamp'), [video.videoId], [])
  const milestone = useLiveQuery(() => db.milestones.where('videoId').equals(video.videoId).first(), [video.videoId], null)
  const [expanded, setExpanded] = useState(false), [menuOpen, setMenuOpen] = useState(false)
  const [, tick] = useState(0)
  const menuRef = useRef(null)

  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    const close = event => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const windows = getAllVelocityWindows(points)
  const latest = points.at(-1), first = points[0]
  const estimate = milestone ? getTimeToMilestone(points, milestone.targetCount, latest?.viewCount) : null
  const probability = milestone?.deadlineTimestamp ? getMilestoneProbability(points, milestone.targetCount, milestone.deadlineTimestamp) : null
  const state = video.pollState || 'idle'
  const sessionGain = latest && first ? latest.viewCount - first.viewCount : 0
  const progress = milestone && latest && first && milestone.targetCount !== first.viewCount
    ? Math.max(0, Math.min(1, (latest.viewCount - first.viewCount) / (milestone.targetCount - first.viewCount)))
    : 0
  const velocityTone = !milestone || !probability ? 'neutral' : (windows.v5m ?? 0) >= probability.requiredVelocity ? 'above' : 'below'

  const pause = async () => db.videos.update(video.id, { pollState: state === 'paused' ? 'idle' : 'paused' })
  const setLabel = async () => {
    const label = prompt('Track label', video.customLabel || video.title || '')
    if (label !== null) await db.videos.update(video.id, { customLabel: label.trim() })
  }
  const remove = async () => {
    if (!confirm('Remove this video and all local history?')) return
    await db.transaction('rw', db.videos, db.datapoints, db.notes, db.milestones, async () => {
      await db.videos.delete(video.id)
      await db.datapoints.where('videoId').equals(video.videoId).delete()
      await db.notes.where('videoId').equals(video.videoId).delete()
      await db.milestones.where('videoId').equals(video.videoId).delete()
    })
  }
  const runMenuAction = action => { setMenuOpen(false); action() }

  return <article className={`track-row${expanded ? ' is-expanded' : ''}`} tabIndex="0" data-tile-index={index} onKeyDown={event => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') onOpen(video)
    if (event.key === ' ') { event.preventDefault(); setExpanded(value => !value) }
  }}>
    <div className="track-main" onClick={event => { if (!event.target.closest('button')) onOpen(video) }}>
      <div className="status-col"><span className={`status-dot ${state}`} title={state} /></div>
      <button className="identity-col" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className="track-title">{video.customLabel || video.title || video.videoId}</span>
        <span className="track-channel">{video.channelName || 'Awaiting metadata'} <i>·</i> <span className="poll-badge">{video.pollInterval || 60}s</span></span>
      </button>
      <button className="count-col" onClick={() => onOpen(video)} aria-label={`Open ${video.customLabel || video.title || video.videoId} details`}>
        <span className="hero-count">{latest ? <AnimatedCount value={latest.viewCount} /> : '—'}</span>
        <span className="count-updated">{latest ? age(latest.timestamp) : video.errorMessage || 'Fetching first sample'}</span>
      </button>
      <div className="stats-col">
        <span className={`stat-line ${velocityTone}`}><i>5m</i><b>{metric(windows.v5m)}</b></span>
        <span className="stat-line"><i>30m</i><b>{metric(windows.v30m)}</b></span>
        <span className="stat-line quiet"><i>{milestone ? 'ETA' : 'SES'}</i><b>{milestone ? (milestone.hitAt ? 'HIT' : estimate?.estimatedAt ? `~${new Date(estimate.estimatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—') : `${sessionGain >= 0 ? '+' : ''}${sessionGain.toLocaleString()}`}</b></span>
      </div>
      <div className="actions-col" ref={menuRef}><button className="menu-trigger" onClick={() => setMenuOpen(value => !value)} aria-label="Track actions" aria-expanded={menuOpen}><span /><span /><span /></button>{menuOpen && <div className="track-menu">
        <button onClick={() => runMenuAction(() => onOpen(video))}>View detail</button>
        <button onClick={() => runMenuAction(setLabel)}>Set label</button>
        <button onClick={() => runMenuAction(() => onOpen(video))}>Add milestone</button>
        <button onClick={() => runMenuAction(pause)}>{state === 'paused' ? 'Resume' : 'Pause'}</button>
        <button onClick={() => runMenuAction(() => onCompare(video))}>Compare</button>
        <button onClick={() => runMenuAction(() => db.videos.update(video.id, { status: 'archived' }))}>Archive</button>
        <button className="danger-item" onClick={() => runMenuAction(remove)}>Remove</button>
      </div>}</div>
    </div>
    {milestone && latest && <div className="milestone-progress"><i style={{ width: `${progress * 100}%` }} /><div><span>Gap: {Math.max(0, milestone.targetCount - latest.viewCount).toLocaleString()}</span><span>{probability ? `${Math.round(probability.probability * 100)}%` : 'No deadline'}</span><span>ETA {milestone.hitAt ? 'hit' : estimate?.estimatedAt ? `~${new Date(estimate.estimatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}</span></div></div>}
    <div className="expanded-signal"><MiniSparkline points={points} /><div className="expanded-stats"><span>5m {metric(windows.v5m)}</span><span>30m {metric(windows.v30m)}</span><span>1h {metric(windows.v1h)}</span><span>{latest ? age(latest.timestamp) : 'No data'}</span><span>Next {video.nextPollAt ? Math.max(0, Math.ceil((video.nextPollAt - Date.now()) / 1000)) : '—'}s</span></div></div>
  </article>
}
