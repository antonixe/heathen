import { useState } from 'react'
import { db, removeVideo } from '../../db/db.js'
import Ask from '../shared/Ask.jsx'

const haystack = video => [video.title, video.customLabel, video.channelName, ...(video.tags || [])].join(' ').toLowerCase()

export default function Watchlist({ videos, onClose, onOpen }) {
  const [query, setQuery] = useState(''), [tab, setTab] = useState('active'), [pending, setPending] = useState(null)
  const term = query.trim().toLowerCase()
  const inTab = videos.filter(video => video.status === tab)
  const filtered = term ? inTab.filter(video => haystack(video).includes(term)) : inTab
  const counts = { active: 0, archived: 0 }
  videos.forEach(video => { if (video.status in counts) counts[video.status] += 1 })

  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section className="modal watchlist">
      <header><div><span className="eyebrow">LOCAL LIBRARY</span><h2>Watchlist</h2></div><button className="plain close" onClick={onClose}>ESC</button></header>
      <div className="watch-controls">
        <div className="segmented">
          {['active', 'archived'].map(name => <button key={name} className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
            {name.toUpperCase()}<i>{counts[name]}</i>
          </button>)}
        </div>
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search title, channel, tag" />
      </div>
      <div className="watch-rows">
        {filtered.map(video => <div className="watch-row" key={video.videoId}>
          {video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : <div className="thumb-placeholder" />}
          <button className="row-main" onClick={() => onOpen(video)}>
            <span className="row-title"><i className={`status-dot ${video.pollState || 'idle'}`} title={video.pollState || 'idle'} /><b>{video.customLabel || video.title || video.videoId}</b></span>
            <span className="row-meta">{video.channelName || 'Awaiting metadata'} <i>·</i> {video.lastViewCount?.toLocaleString() || 'No samples'}</span>
            {video.tags?.length > 0 && <span className="row-tags">{video.tags.map(tag => <i className="badge" key={tag}>{tag}</i>)}</span>}
          </button>
          <div className="row-actions">
            <button onClick={() => db.videos.update(video.id, { status: tab === 'active' ? 'archived' : 'active' })}>{tab === 'active' ? 'ARCHIVE' : 'RESTORE'}</button>
            <button className="danger-button" onClick={() => setPending(video)}>REMOVE</button>
          </div>
        </div>)}
        {!filtered.length && <p className="watch-empty">
          {counts[tab] === 0 ? `No ${tab} tracks yet.` : <>Nothing here matches <b>{query.trim()}</b>.</>}
        </p>}
      </div>
      {pending && <Ask title="Remove this track?" danger confirmLabel="Remove"
        body={`${pending.customLabel || pending.title} and its entire local history will be deleted. This cannot be undone.`}
        onDone={value => { setPending(null); if (value) removeVideo(pending) }} />}
    </section>
  </div>
}
