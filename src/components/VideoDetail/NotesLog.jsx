import { useState } from 'react'
import { db } from '../../db/db.js'

export default function NotesLog({ videoId, notes }) {
  const [body, setBody] = useState('')
  const save = async () => { if (!body.trim()) return; await db.notes.add({ videoId, timestamp: Date.now(), body: body.trim() }); setBody('') }
  return <section className="detail-section notes-section"><h3>NOTES</h3><textarea rows="3" value={body} onChange={event => setBody(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save() }} placeholder="Add chart context" /><span className="field-hint">Cmd/Ctrl + Enter to save</span><div className="notes-list">{notes.slice().reverse().map(note => <article key={note.id}><time>{new Date(note.timestamp).toLocaleString()}</time><p>{note.body}</p></article>)}</div></section>
}
