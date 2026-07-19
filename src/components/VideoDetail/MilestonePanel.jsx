import { useMemo, useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { db, deleteMilestoneData, updateMilestoneData } from '../../db/db.js'
import { getMilestoneProbability } from '../../utils/probability.js'
import { getTimeToMilestone } from '../../utils/velocity.js'
import { getActiveMilestone, getMilestoneDisplayState } from '../../utils/milestone.js'
import { formatDateTimeEAT, formatTimeEAT, getMidnightEAT } from '../../utils/time.js'
import ProbabilityBadge from '../shared/ProbabilityBadge.jsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const toDateTimeLocalValue = timestampMs => {
  if (!Number.isFinite(Number(timestampMs))) return ''
  const date = new Date(Number(timestampMs))
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

const midnightContextLabel = () => Number(formatTimeEAT(Date.now()).slice(0, 2)) < 6 ? 'Tomorrow' : 'Tonight'
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null
const sortDeadlineAsc = (left, right) => (numeric(left.deadlineTimestamp) ?? Number.POSITIVE_INFINITY) - (numeric(right.deadlineTimestamp) ?? Number.POSITIVE_INFINITY)
const sortDeadlineDesc = (left, right) => (numeric(right.deadlineTimestamp) ?? 0) - (numeric(left.deadlineTimestamp) ?? 0)
const sortHitDesc = (left, right) => (numeric(right.hitAt) ?? 0) - (numeric(left.hitAt) ?? 0)

export default function MilestonePanel({ videoId, video, videos = [], calibration, points, milestones }) {
  const [target, setTarget] = useState('')
  const [deadlineMs, setDeadlineMs] = useState(null)
  const [deadlineInput, setDeadlineInput] = useState('')
  const [deadlineContext, setDeadlineContext] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editTarget, setEditTarget] = useState('')
  const [editDeadline, setEditDeadline] = useState('')
  const [editError, setEditError] = useState('')
  const midnightLabel = midnightContextLabel()
  const currentViewCount = points.at(-1)?.viewCount ?? 0
  const modelOptions = { video, peerVideos: videos, calibration }
  const activeMilestone = useMemo(() => getActiveMilestone(milestones, currentViewCount), [milestones, currentViewCount])
  const activeMilestoneState = activeMilestone ? getMilestoneDisplayState(activeMilestone) : null
  const activeMilestoneId = activeMilestone && activeMilestoneState !== 'hit' && activeMilestoneState !== 'missed' ? activeMilestone.id : null

  const sortedMilestones = useMemo(() => {
    const rows = (milestones || []).map(item => ({ item, state: getMilestoneDisplayState(item), isActive: item.id === activeMilestoneId }))
    const active = rows.filter(row => row.isActive)
    const imminent = rows.filter(row => !row.isActive && row.state === 'imminent').sort((left, right) => sortDeadlineAsc(left.item, right.item))
    const upcoming = rows.filter(row => !row.isActive && row.state === 'upcoming').sort((left, right) => sortDeadlineAsc(left.item, right.item))
    const missed = rows.filter(row => !row.isActive && row.state === 'missed').sort((left, right) => sortDeadlineDesc(left.item, right.item))
    const hit = rows.filter(row => !row.isActive && row.state === 'hit').sort((left, right) => sortHitDesc(left.item, right.item))
    return [...active, ...imminent, ...upcoming, ...missed, ...hit]
  }, [activeMilestoneId, milestones])

  const deadlineDisplay = deadlineMs ? (deadlineContext ? deadlineContext + ', 00:00 EAT' : formatDateTimeEAT(deadlineMs) + ' EAT') : 'No deadline selected'
  const setMidnightDeadline = () => {
    const timestamp = getMidnightEAT()
    setDeadlineMs(timestamp)
    setDeadlineInput(toDateTimeLocalValue(timestamp))
    setDeadlineContext(midnightContextLabel())
  }
  const setCustomDeadline = value => {
    setDeadlineInput(value)
    setDeadlineContext('')
    setDeadlineMs(value ? new Date(value).getTime() : null)
  }
  const add = async event => {
    event.preventDefault()
    const count = Number(target)
    if (!Number.isFinite(count) || count <= 0) return
    await db.milestones.add({ videoId, targetCount: count, deadlineTimestamp: deadlineMs, label: '', hitAt: null, createdAt: Date.now() })
    setTarget('')
    setDeadlineMs(null)
    setDeadlineInput('')
    setDeadlineContext('')
  }
  const remove = async id => {
    await deleteMilestoneData(id)
    setPendingDeleteId(null)
  }

  const beginEdit = item => {
    setPendingDeleteId(null)
    setEditingId(item.id)
    setEditTarget(String(item.targetCount))
    setEditDeadline(toDateTimeLocalValue(item.deadlineTimestamp))
    setEditError('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditTarget('')
    setEditDeadline('')
    setEditError('')
  }

  const saveEdit = async item => {
    const nextTarget = Number(editTarget)
    const nextDeadline = editDeadline ? new Date(editDeadline).getTime() : null
    if (!Number.isFinite(nextTarget) || nextTarget <= currentViewCount) {
      setEditError('Target views must remain above the current view count.')
      return
    }
    if (nextDeadline && nextDeadline <= Date.now()) {
      setEditError('Choose a future deadline or leave it empty.')
      return
    }
    try {
      await updateMilestoneData(item.id, { targetCount: nextTarget, deadlineTimestamp: nextDeadline })
      cancelEdit()
    } catch (error) {
      setEditError(error.message)
    }
  }

  return <section className="detail-mode">
    <header className="detail-mode-header">
      <div><h2>Milestones</h2><p>Targets, deadlines, confidence, and actual outcomes.</p></div>
      <span className="metric">{milestones.length} total</span>
    </header>

    <div className="milestone-workspace">
      <div className="milestone-records">
        {sortedMilestones.map(({ item, state, isActive }) => {
          const probability = item.deadlineTimestamp && state !== 'hit' ? getMilestoneProbability(points, item.targetCount, item.deadlineTimestamp, modelOptions) : null
          const eta = state !== 'hit' ? getTimeToMilestone(points, item.targetCount, points.at(-1)?.viewCount, modelOptions) : null
          const actualCount = numeric(item.actualCount) ?? points.at(-1)?.viewCount ?? item.targetCount
          const canEdit = state !== 'hit' && state !== 'missed'

          return <article className="milestone-record" data-state={state} data-active={isActive || undefined} data-editing={editingId === item.id || undefined} key={item.id}>
            <div className="milestone-record-main">
              <div className="milestone-target">
                <span className="metric">{Number(item.targetCount).toLocaleString()}</span>
                <small>views</small>
              </div>
              <div className="milestone-record-status">
                <div>{state === 'hit' && <Check className="size-4 text-success" />}{isActive && <span className="milestone-active-label">Active target</span>}<span className="capitalize">{state}</span></div>
                <p>{state === 'hit' ? 'Hit ' + formatDateTimeEAT(item.hitAt) + ' EAT at ' + Number(actualCount).toLocaleString() + ' views' : state === 'missed' ? 'Deadline passed before the target was reached.' : item.deadlineTimestamp ? 'Deadline ' + formatDateTimeEAT(item.deadlineTimestamp) + ' EAT' : 'No deadline attached.'}</p>
              </div>
              <div className="milestone-evidence">
                {probability ? <ProbabilityBadge {...probability} /> : <span className="text-xs text-muted-foreground">No probability signal</span>}
                <span className="metric">{state === 'hit' ? 'Achieved' : eta ? 'ETA ' + formatDateTimeEAT(eta.estimatedAt) + ' EAT' : 'No ETA'}</span>
              </div>
              <div className="milestone-record-actions">
                {canEdit && <Button type="button" size="icon-sm" variant="ghost" onClick={() => beginEdit(item)} aria-label="Edit milestone"><Pencil className="size-3.5" /></Button>}
                <Button type="button" size="icon-sm" variant="ghost" className="text-destructive" onClick={() => { cancelEdit(); setPendingDeleteId(item.id) }} aria-label="Stage milestone removal"><Trash2 className="size-4" /></Button>
              </div>
            </div>
            {editingId === item.id && <div className="milestone-record-editor">
              <div><Label htmlFor={'edit-target-' + item.id}>Target views</Label><Input id={'edit-target-' + item.id} className="metric" type="number" min={currentViewCount + 1} value={editTarget} onChange={event => { setEditTarget(event.target.value); setEditError('') }} /></div>
              <div><Label htmlFor={'edit-deadline-' + item.id}>Deadline</Label><Input id={'edit-deadline-' + item.id} type="datetime-local" value={editDeadline} onChange={event => { setEditDeadline(event.target.value); setEditError('') }} /></div>
              <div className="milestone-editor-actions"><Button type="button" size="sm" variant="ghost" onClick={cancelEdit}><X className="size-3.5" />Cancel</Button><Button type="button" size="sm" onClick={() => saveEdit(item)}><Check className="size-3.5" />Save changes</Button></div>
              {editError && <p className="milestone-editor-error" role="alert">{editError}</p>}
            </div>}
            {probability?.reasons?.length > 0 && editingId !== item.id && <p className="milestone-reasons">{probability.reasons.slice(0, 4).join(' / ')}</p>}
            {pendingDeleteId === item.id && <div className="milestone-delete-confirmation" role="group" aria-label="Confirm milestone removal"><span>Remove this target and its saved outcome?</span><div><Button type="button" size="sm" variant="ghost" onClick={() => setPendingDeleteId(null)}>Keep</Button><Button type="button" size="sm" variant="destructive" onClick={() => remove(item.id)}>Remove</Button></div></div>}
          </article>
        })}
        {!milestones.length && <div className="detail-mode-empty"><strong>No targets yet</strong><p>Create a target to track required pace, confidence, and the eventual outcome.</p></div>}
      </div>

      <aside className="milestone-compose">
        <div><h3>New target</h3><p>Add a view target with an optional deadline.</p></div>
        <form onSubmit={add}>
          <div className="space-y-2"><Label htmlFor="target-count">Target views</Label><Input id="target-count" className="metric" type="number" min="1" value={target} onChange={event => setTarget(event.target.value)} placeholder="200000" /></div>
          <div className="deadline-shortcut"><Button type="button" variant="outline" size="sm" onClick={setMidnightDeadline}>{midnightLabel} midnight EAT</Button><span className="metric">{deadlineDisplay}</span></div>
          <div className="space-y-2"><Label htmlFor="custom-deadline">Custom deadline</Label><Input id="custom-deadline" type="datetime-local" value={deadlineInput} onChange={event => setCustomDeadline(event.target.value)} /></div>
          <Button><Plus className="size-4" />Add target</Button>
        </form>
      </aside>
    </div>
  </section>
}