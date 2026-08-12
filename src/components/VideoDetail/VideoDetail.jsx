import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, POLL_INTERVALS } from '../../db/db.js'
import { downloadFile, videoToCsv } from '../../utils/export.js'
import { getAllVelocityWindows, getRollingVelocity, viewsBetween } from '../../utils/velocity.js'
import { age, metric } from '../../utils/format.js'

const DAY = 24 * 3600000
// null when there is no usable baseline, so a first-ever reading never renders as "+100%"
const change = (current, previous) =>
  current === null || current === undefined || !previous ? null : (current - previous) / Math.abs(previous)

function Delta({ ratio, baseline }) {
  if (ratio === null) return <span className="delta flat">No baseline yet</span>
  const direction = Math.abs(ratio) < 0.005 ? 'flat' : ratio > 0 ? 'up' : 'down'
  const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '–'
  return <>
    <span className={`delta ${direction}`}>{arrow} {direction === 'flat' ? 'No change' : `${(Math.abs(ratio) * 100).toFixed(1)}%`}</span>
    {baseline && <em>vs {baseline}</em>}
  </>
}
import AnimatedCount from '../shared/AnimatedCount.jsx'
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

  const windows = useMemo(() => getAllVelocityWindows(points), [points])
  const latest = points.at(-1), first = points[0]
  const sessionGain = latest && first ? latest.viewCount - first.viewCount : 0

  // every headline number gets the same period one step back to measure against
  const trend = useMemo(() => {
    const last = points.at(-1)
    if (!last) return {}
    const now = last.timestamp
    const priorWindow = points.filter(point => point.timestamp <= now - 30 * 60000)
    return {
      velocity: windows.v30m,
      velocityPrev: getRollingVelocity(priorWindow, 30),
      day: viewsBetween(points, now - DAY, now),
      dayPrev: viewsBetween(points, now - 2 * DAY, now - DAY),
      hours: first ? (now - first.timestamp) / 3600000 : 0,
    }
  }, [points, windows.v30m, first])

  return <div className="detail-page" role="dialog" aria-modal="true" aria-label={`${video.customLabel || video.title} detail`}>
    <header className="detail-top">
      <div className="detail-heading">
        <button className="detail-back" onClick={onClose} aria-label="Back to dashboard">←</button>
        <div className="detail-title">
          <h1>{video.customLabel || video.title}</h1>
          <p><span className={`status-dot ${video.pollState || 'idle'}`} title={video.pollState || 'idle'} />{video.channelName || 'Awaiting metadata'} <i>·</i> <code>{video.videoId}</code></p>
        </div>
      </div>
      <div className="detail-actions">
        <button onClick={() => db.videos.update(video.id, { pollState: paused ? 'idle' : 'paused' })}>{paused ? 'Resume' : 'Pause'}</button>
        <button onClick={() => downloadFile(`${video.videoId}.csv`, videoToCsv(points, notes), 'text/csv')}>Export CSV</button>
        <div className="detail-more"><button className="menu-trigger" onClick={() => setMoreOpen(value => !value)} aria-label="More actions" aria-expanded={moreOpen}><span /><span /><span /></button>{moreOpen && <div className="track-menu"><button onClick={() => db.videos.update(video.id, { status: 'archived' })}>Archive track</button></div>}</div>
      </div>
    </header>

    {/* the page never showed where the track actually stands; the chart alone made you infer it */}
    <section className="detail-summary">
      <article className="stat-card">
        <header><i className="stat-icon views">▦</i>Views</header>
        <b className="stat-value">{latest ? <AnimatedCount value={latest.viewCount} /> : '—'}</b>
        <footer className="stat-foot"><span>{latest ? age(latest.timestamp) : video.errorMessage || 'Awaiting first sample'}</span></footer>
      </article>

      <article className="stat-card">
        <header><i className="stat-icon rate">⇗</i>Velocity · 30m</header>
        <b className="stat-value">{metric(windows.v30m)}<small> v/min</small></b>
        <footer className="stat-foot">
          <Delta ratio={change(trend.velocity, trend.velocityPrev)} baseline={trend.velocityPrev ? metric(trend.velocityPrev) : null} />
        </footer>
      </article>

      <article className="stat-card">
        <header><i className="stat-icon day">◷</i>Last 24h</header>
        <b className="stat-value">{trend.day === null || trend.day === undefined ? '—' : `+${Math.round(trend.day).toLocaleString()}`}</b>
        <footer className="stat-foot">
          <Delta ratio={change(trend.day, trend.dayPrev)} baseline={trend.dayPrev ? Math.round(trend.dayPrev).toLocaleString() : null} />
        </footer>
      </article>

      <article className="stat-card">
        <header><i className="stat-icon session">∑</i>Session</header>
        <b className="stat-value">{sessionGain >= 0 ? '+' : ''}{sessionGain.toLocaleString()}</b>
        <footer className="stat-foot">
          <span>{points.length.toLocaleString()} samples</span>
          <em>{trend.hours >= 1 ? `over ${Math.round(trend.hours)}h` : 'under an hour'}</em>
        </footer>
      </article>
    </section>

    <div className="detail-layout">
      <aside className="detail-sidebar">
        <MilestonePanel videoId={video.videoId} points={points} milestones={milestones} />
        <NotesLog videoId={video.videoId} notes={notes} />
        <SessionLog video={video} points={points} notes={notes} />
        {/* configuration last: you open a track to read it far more often than to re-tag it */}
        <section className="detail-section metadata-section">
          <h3>TRACK SETTINGS</h3>
          <label>CUSTOM LABEL<input defaultValue={video.customLabel || ''} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} onBlur={event => db.videos.update(video.id, { customLabel: event.target.value.trim() })} /></label>
          <label>TAGS<input defaultValue={(video.tags || []).join(', ')} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} onBlur={event => db.videos.update(video.id, { tags: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} /></label>
          <div className="field">
            <span>POLL INTERVAL</span>
            <div className="segmented spread" role="group" aria-label="Poll interval">
              {POLL_INTERVALS.map(([value, name]) => <button key={value} type="button" aria-pressed={Number(video.pollInterval) === value}
                className={Number(video.pollInterval) === value ? 'active' : ''} onClick={() => db.videos.update(video.id, { pollInterval: value })}>{name}</button>)}
            </div>
          </div>
          <p className="help">Added {new Date(video.addedAt).toLocaleString()}</p>
        </section>
      </aside>
      <main className="detail-main">
        <VelocityChart points={points} notes={notes} milestones={milestones} />
        <HeatmapGrid datapoints={points} />
      </main>
    </div>
  </div>
}
