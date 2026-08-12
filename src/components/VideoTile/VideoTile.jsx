import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, removeVideo } from '../../db/db.js'
import { getAllVelocityWindows, getTimeToMilestone } from '../../utils/velocity.js'
import { getMilestoneProbability } from '../../utils/probability.js'
import { age, metric } from '../../utils/format.js'
import AnimatedCount from '../shared/AnimatedCount.jsx'
import Ask from '../shared/Ask.jsx'
import MiniSparkline from './MiniSparkline.jsx'


export default function VideoTile({ video, index, onOpen, onCompare, onEta }) {
  const points = useLiveQuery(() => db.datapoints.where('videoId').equals(video.videoId).sortBy('timestamp'), [video.videoId], [])
  const milestone = useLiveQuery(() => db.milestones.where('videoId').equals(video.videoId).first(), [video.videoId], null)
  const [expanded, setExpanded] = useState(false), [menuOpen, setMenuOpen] = useState(false), [ask, setAsk] = useState(null)
  const [, tick] = useState(0)
  const menuRef = useRef(null)

  useEffect(() => { const timer = setInterval(() => tick(value => value + 1), 1000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    const close = event => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const latest = points.at(-1), first = points[0]
  // the 1s tick above only refreshes the countdown text — without this the whole model would be
  // refitted 60x a minute, which is ~30ms a pass once a few days of history have piled up
  const { windows, estimate, probability } = useMemo(() => ({
    windows: getAllVelocityWindows(points),
    estimate: milestone ? getTimeToMilestone(points, milestone.targetCount, points.at(-1)?.viewCount) : null,
    probability: milestone?.deadlineTimestamp ? getMilestoneProbability(points, milestone.targetCount, milestone.deadlineTimestamp) : null,
  }), [points, milestone])
  const state = video.pollState || 'idle'
  const sessionGain = latest && first ? latest.viewCount - first.viewCount : 0
  const progress = milestone && latest && first && milestone.targetCount !== first.viewCount
    ? Math.max(0, Math.min(1, (latest.viewCount - first.viewCount) / (milestone.targetCount - first.viewCount)))
    : 0
  const velocityTone = !milestone || !probability ? 'neutral' : (windows.v30m ?? windows.sessionAvg ?? 0) >= probability.requiredVelocity ? 'above' : 'below'

  // hand the dashboard the timestamp it sorts on; a hit or unreachable target reports nothing
  useEffect(() => {
    onEta?.(video.videoId, milestone && !milestone.hitAt ? estimate?.estimatedAt ?? null : null)
  }, [onEta, video.videoId, milestone, estimate])

  const pause = async () => db.videos.update(video.id, { pollState: state === 'paused' ? 'idle' : 'paused' })
  const runMenuAction = action => { setMenuOpen(false); action() }

  return <article className={`track-row${expanded ? ' is-expanded' : ''}`} tabIndex="0" data-tile-index={index} onKeyDown={event => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter') onOpen(video)
    if (event.key === ' ') { event.preventDefault(); setExpanded(value => !value) }
  }}>
    <div className="track-main" onClick={event => { if (!event.target.closest('button')) onOpen(video) }}>
      <div className="status-col"><b className="track-rank" aria-hidden="true">{index + 1}</b><span className={`status-dot ${state}`} title={state} /></div>
      <button className="identity-col" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className="track-title">{video.customLabel || video.title || video.videoId}</span>
        <span className="track-channel">{video.channelName || 'Awaiting metadata'} <i>·</i> <span className="poll-badge">{video.pollInterval || 60}s</span></span>
      </button>
      <div className="spark-col" aria-hidden="true"><MiniSparkline points={points} /></div>
      <button className="count-col" onClick={() => onOpen(video)} aria-label={`Open ${video.customLabel || video.title || video.videoId} details`}>
        <span className="hero-count">{latest ? <AnimatedCount value={latest.viewCount} /> : '—'}</span>
        <span className="count-updated">{latest ? age(latest.timestamp) : video.errorMessage || 'Fetching first sample'}</span>
      </button>
      <div className="stats-col">
        <span className="stat-line"><i>5m</i><b>{metric(windows.v5m)}</b></span>
        <span className={`stat-line ${velocityTone}`}><i>30m</i><b>{metric(windows.v30m)}</b></span>
        <span className="stat-line quiet"><i>{milestone ? 'ETA' : 'SES'}</i><b>{milestone ? (milestone.hitAt ? 'HIT' : estimate?.estimatedAt ? `~${new Date(estimate.estimatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—') : `${sessionGain >= 0 ? '+' : ''}${sessionGain.toLocaleString()}`}</b></span>
      </div>
      <div className="actions-col" ref={menuRef}><button className="menu-trigger" onClick={() => setMenuOpen(value => !value)} aria-label="Track actions" aria-expanded={menuOpen}><span /><span /><span /></button>{menuOpen && <div className="track-menu">
        <button onClick={() => runMenuAction(() => onOpen(video))}>View detail</button>
        <button onClick={() => runMenuAction(() => setAsk('label'))}>Set label</button>
        <button onClick={() => runMenuAction(() => onOpen(video))}>Add milestone</button>
        <button onClick={() => runMenuAction(pause)}>{state === 'paused' ? 'Resume' : 'Pause'}</button>
        <button onClick={() => runMenuAction(() => onCompare(video))}>Compare</button>
        <button onClick={() => runMenuAction(() => db.videos.update(video.id, { status: 'archived' }))}>Archive</button>
        <button className="danger-item" onClick={() => runMenuAction(() => setAsk('remove'))}>Remove</button>
      </div>}</div>
    </div>
    {milestone && latest && <div className="milestone-progress"><i style={{ width: `${progress * 100}%` }} /><div><span className="milestone-projection">{probability ? <>Proj <b className={probability.projectedAtDeadline >= milestone.targetCount ? '' : 'short'}>{probability.projectedAtDeadline.toLocaleString()}</b> <i>→ {milestone.targetCount.toLocaleString()}</i></> : <i>Target {milestone.targetCount.toLocaleString()}</i>}</span><span>{probability ? `${Math.round(probability.probability * 100)}%` : 'No deadline'}</span><span>ETA {milestone.hitAt ? 'hit' : estimate?.estimatedAt ? `~${new Date(estimate.estimatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '—'}</span></div></div>}
    {ask === 'label' && <Ask title="Track label" confirmLabel="Save" input={video.customLabel || video.title || ''}
      onDone={value => { setAsk(null); if (value !== null) db.videos.update(video.id, { customLabel: value }) }} />}
    {ask === 'remove' && <Ask title="Remove this track?" danger confirmLabel="Remove"
      body="Its entire local history is deleted with it. This cannot be undone."
      onDone={value => { setAsk(null); if (value) removeVideo(video) }} />}
    <div className="expanded-signal"><div className="expanded-stats"><span>5m {metric(windows.v5m)}</span><span>30m {metric(windows.v30m)}</span><span>1h {metric(windows.v1h)}</span><span>{latest ? age(latest.timestamp) : 'No data'}</span><span>Next {video.nextPollAt ? Math.max(0, Math.ceil((video.nextPollAt - Date.now()) / 1000)) : '—'}s</span></div></div>
  </article>
}
