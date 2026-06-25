import { useMemo, useState } from 'react'
import { db, addObservation } from '../../db/db.js'
import { fetchYouTubeVideo, parseVideoLines } from '../../utils/youtube.js'
import { incrementQuota } from '../../hooks/useQuota.js'

export default function AddVideoModal({ apiKey, defaultInterval, onClose, onSettings, onToast }) {
  const [text, setText] = useState(''), [label, setLabel] = useState(''), [tags, setTags] = useState('')
  const [interval, setIntervalValue] = useState(defaultInterval || 60), [busy, setBusy] = useState(false)
  const parsed = useMemo(() => parseVideoLines(text), [text])
  const valid = [...new Map(parsed.filter(row => row.valid).map(row => [row.videoId, row])).values()]
  const submit = async event => {
    event.preventDefault()
    if (!apiKey) { onSettings(); return }
    if (Notification.permission === 'default') Notification.requestPermission().catch(() => {})
    setBusy(true)
    const results = await Promise.allSettled(valid.map(async row => {
      const data = await fetchYouTubeVideo(row.videoId, apiKey)
      await incrementQuota()
      const existing = await db.videos.where('videoId').equals(row.videoId).first()
      await db.videos.put({ ...existing, videoId: row.videoId, title: data.title, channelName: data.channelName, thumbnailUrl: data.thumbnailUrl, customLabel: valid.length === 1 ? label.trim() : '', tags: tags.split(',').map(tag => tag.trim()).filter(Boolean), status: 'active', addedAt: existing?.addedAt || Date.now(), pollInterval: Number(interval), pollState: 'idle' })
      await addObservation(row.videoId, data.viewCount)
      return data.title
    }))
    const failures = results.filter(result => result.status === 'rejected')
    setBusy(false)
    if (failures.length) onToast('Some videos were not added', failures[0].reason?.message || 'YouTube request failed.')
    if (results.length > failures.length) { onToast('Tracking started', `${results.length - failures.length} video${results.length - failures.length === 1 ? '' : 's'} added.`); onClose() }
  }
  return <div className="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}><form className="modal add-modal" onSubmit={submit}><header><div><span className="eyebrow">NEW TRACKS</span><h2>Track YouTube videos</h2></div><button type="button" className="plain close" onClick={onClose}>ESC</button></header><label>URL OR VIDEO ID, ONE PER LINE (MAX 10)<textarea autoFocus rows="7" value={text} onChange={event => setText(event.target.value)} placeholder="https://youtu.be/dQw4w9WgXcQ" /></label><div className="validation-list">{parsed.map((row, index) => <div className={row.valid ? 'valid' : 'invalid'} key={`${row.value}-${index}`}><span>{row.valid ? '✓' : '×'}</span><code>{row.videoId || row.value}</code></div>)}</div><div className="form-grid"><label>CUSTOM LABEL<input value={label} onChange={event => setLabel(event.target.value)} disabled={valid.length > 1} placeholder={valid.length > 1 ? 'Single tracks only' : 'Optional'} /></label><label>TAGS<input value={tags} onChange={event => setTags(event.target.value)} placeholder="artist, region" /></label><label>POLL INTERVAL<select value={interval} onChange={event => setIntervalValue(event.target.value)}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option></select></label></div>{!apiKey && <div className="inline-error">API key required. <button type="button" className="link" onClick={onSettings}>Open settings</button></div>}<footer><span>{valid.length} valid / {parsed.length} entered</span><button className="primary" disabled={!valid.length || busy}>{busy ? 'Fetching metadata…' : `Track ${valid.length || ''} video${valid.length === 1 ? '' : 's'}`}</button></footer></form></div>
}
