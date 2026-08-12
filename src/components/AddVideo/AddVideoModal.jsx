import { useMemo, useState } from 'react'
import { db, addObservation, POLL_INTERVALS } from '../../db/db.js'
import { fetchYouTubeVideo, parseVideoLines } from '../../utils/youtube.js'
import { incrementQuota } from '../../hooks/useQuota.js'

const LIMIT = 10
const MARK = { new: '✓', tracked: '✓', duplicate: '–', invalid: '×' }
const NOTE = { tracked: 'already tracked', duplicate: 'duplicate', invalid: 'not a YouTube link' }

export default function AddVideoModal({ apiKey, defaultInterval, videos, onClose, onSettings, onToast }) {
  const [text, setText] = useState(''), [label, setLabel] = useState(''), [tags, setTags] = useState('')
  const [interval, setIntervalValue] = useState(defaultInterval || 60), [busy, setBusy] = useState(false)

  const parsed = useMemo(() => parseVideoLines(text, LIMIT), [text])
  const ignored = useMemo(() => Math.max(0, text.split(/\r?\n/).filter(line => line.trim()).length - LIMIT), [text])
  const tracked = useMemo(() => new Set((videos || []).map(video => video.videoId)), [videos])
  // a pasted list routinely holds repeats and things already on the dashboard; say which is which
  // rather than counting them as new and silently collapsing them at submit time
  const rows = useMemo(() => {
    const seen = new Set()
    return parsed.map(row => {
      if (!row.valid) return { ...row, state: 'invalid' }
      if (seen.has(row.videoId)) return { ...row, state: 'duplicate' }
      seen.add(row.videoId)
      return { ...row, state: tracked.has(row.videoId) ? 'tracked' : 'new' }
    })
  }, [parsed, tracked])
  const queued = rows.filter(row => row.state === 'new' || row.state === 'tracked')
  const skipped = rows.length - queued.length

  const submit = async event => {
    event.preventDefault()
    if (!apiKey) { onSettings(); return }
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    setBusy(true)
    const results = await Promise.allSettled(queued.map(async row => {
      const data = await fetchYouTubeVideo(row.videoId, apiKey)
      await incrementQuota()
      const existing = await db.videos.where('videoId').equals(row.videoId).first()
      await db.videos.put({ ...existing, videoId: row.videoId, title: data.title, channelName: data.channelName, thumbnailUrl: data.thumbnailUrl, customLabel: queued.length === 1 ? label.trim() : '', tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), status: 'active', addedAt: existing?.addedAt || Date.now(), pollInterval: Number(interval), pollState: 'idle' })
      await addObservation(row.videoId, data.viewCount)
      return data.title
    }))
    const failures = results.filter(result => result.status === 'rejected')
    setBusy(false)
    if (failures.length) onToast('Some tracks were not added', failures[0].reason?.message || 'YouTube request failed.', 'down')
    if (results.length > failures.length) { onToast('Tracking started', `${results.length - failures.length} track${results.length - failures.length === 1 ? '' : 's'} added.`); onClose() }
  }

  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <form className="modal add-modal" onSubmit={submit}>
      <header><div><span className="eyebrow">NEW TRACKS</span><h2>Track YouTube videos</h2></div><button type="button" className="plain close" onClick={onClose}>ESC</button></header>

      <label>URL OR VIDEO ID, ONE PER LINE (MAX {LIMIT})<textarea autoFocus rows="7" value={text} onChange={event => setText(event.target.value)} placeholder="https://youtu.be/dQw4w9WgXcQ" /></label>

      {rows.length > 0 && <div className="validation-list">{rows.map((row, index) => <div className={row.state} key={`${row.value}-${index}`}>
        <span>{MARK[row.state]}</span><code>{row.videoId || row.value}</code>{NOTE[row.state] && <em>{NOTE[row.state]}</em>}
      </div>)}</div>}

      {ignored > 0 && <p className="inline-warn">Only the first {LIMIT} lines are read — {ignored} more ignored.</p>}

      <div className="form-grid">
        <label>CUSTOM LABEL<input value={label} onChange={event => setLabel(event.target.value)} disabled={queued.length > 1} placeholder={queued.length > 1 ? 'Single tracks only' : 'Optional'} /></label>
        <label>TAGS<input value={tags} onChange={event => setTags(event.target.value)} placeholder="artist, region" /></label>
      </div>

      <div className="field">
        <span>POLL INTERVAL</span>
        <div className="segmented spread" role="group" aria-label="Poll interval">
          {POLL_INTERVALS.map(([value, name]) => <button key={value} type="button" aria-pressed={Number(interval) === value}
            className={Number(interval) === value ? 'active' : ''} onClick={() => setIntervalValue(value)}>{name}</button>)}
        </div>
      </div>

      {!apiKey && <div className="inline-error">API key required. <button type="button" className="link" onClick={onSettings}>Open settings</button></div>}

      <footer>
        <span>{!rows.length ? 'Paste links to begin' : `${queued.length} to track${skipped ? ` · ${skipped} skipped` : ''}`}</span>
        <button className="primary" disabled={!queued.length || busy}>{busy ? 'Fetching metadata…' : `Track ${queued.length || ''} track${queued.length === 1 ? '' : 's'}`}</button>
      </footer>
    </form>
  </div>
}
