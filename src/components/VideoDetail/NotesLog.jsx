import { useState } from 'react'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import { db } from '../../db/db.js'
import { formatDateTimeEAT } from '../../utils/time.js'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

export default function NotesLog({ videoId, notes }) {
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState(null)

  const save = async () => {
    if (!body.trim()) return
    await db.notes.add({ videoId, timestamp: Date.now(), body: body.trim() })
    setBody('')
  }

  const beginEdit = note => {
    setPendingDeleteId(null)
    setEditingId(note.id)
    setEditBody(note.body)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditBody('')
  }

  const saveEdit = async note => {
    const next = editBody.trim()
    if (!next) return
    await db.notes.update(note.id, { body: next, updatedAt: Date.now() })
    cancelEdit()
  }

  const remove = async noteId => {
    await db.notes.delete(noteId)
    setPendingDeleteId(null)
    if (editingId === noteId) cancelEdit()
  }

  return <section className="detail-mode">
    <header className="detail-mode-header">
      <div><h2>Notes</h2><p>Timestamped context for chart events, releases, and external activity.</p></div>
      <span className="metric">{notes.length} entries</span>
    </header>

    <div className="notes-workspace">
      <div className="notes-composer">
        <label htmlFor="release-note">New note</label>
        <Textarea id="release-note" rows={6} value={body} onChange={event => setBody(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); save() } }} placeholder="Record campaign activity, media placement, chart movement, or polling context." />
        <div className="notes-composer-footer"><span>{body.trim().length} characters</span><Button type="button" onClick={save} disabled={!body.trim()}>Save note</Button></div>
      </div>

      <div className="notes-timeline">
        {notes.slice().reverse().map(note => <article className="note-record" data-editing={editingId === note.id || undefined} key={note.id}>
          <div className="note-record-meta">
            <time className="metric">{formatDateTimeEAT(note.timestamp)} EAT</time>
            <div className="note-record-actions">
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => beginEdit(note)} aria-label="Edit note"><Pencil className="size-3.5" /></Button>
              <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" onClick={() => { setEditingId(null); setPendingDeleteId(note.id) }} aria-label="Stage note removal"><Trash2 className="size-3.5" /></Button>
            </div>
          </div>
          <div className="note-record-content">
            {editingId === note.id ? <div className="note-editor">
              <Textarea rows={5} value={editBody} onChange={event => setEditBody(event.target.value)} aria-label="Edit note text" />
              <div><span className="metric">{editBody.trim().length} characters</span><Button type="button" size="sm" variant="ghost" onClick={cancelEdit}><X className="size-3.5" />Cancel</Button><Button type="button" size="sm" onClick={() => saveEdit(note)} disabled={!editBody.trim()}><Check className="size-3.5" />Save</Button></div>
            </div> : <p>{note.body}</p>}
            {pendingDeleteId === note.id && <div className="note-delete-confirmation" role="group" aria-label="Confirm note removal"><span>Remove this note from the evidence log?</span><div><Button type="button" size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>Keep</Button><Button type="button" size="sm" variant="destructive" onClick={() => remove(note.id)}>Remove</Button></div></div>}
          </div>
        </article>)}
        {!notes.length && <div className="detail-mode-empty"><strong>No notes recorded</strong><p>Notes appear on the chart at the time they are saved.</p></div>}
      </div>
    </div>
  </section>
}