import { useState } from 'react'
import { db } from '../../db/db.js'
import { getMilestoneProbability } from '../../utils/probability.js'
import { getTimeToMilestone } from '../../utils/velocity.js'
import ProbabilityBadge from '../shared/ProbabilityBadge.jsx'

export default function MilestonePanel({ videoId, points, milestones }) {
  const [target, setTarget] = useState(''), [deadline, setDeadline] = useState('')
  const add = async event => {
    event.preventDefault(); const count = Number(target)
    if (!Number.isFinite(count) || count <= 0) return
    await db.milestones.add({ videoId, targetCount: count, deadlineTimestamp: deadline ? new Date(deadline).getTime() : null, label: '', hitAt: null, createdAt: Date.now() })
    setTarget(''); setDeadline('')
  }
  return <section className="detail-section milestone-section"><h3>MILESTONES</h3><div className="milestone-list">{milestones.map(item => {
    const probability = item.deadlineTimestamp ? getMilestoneProbability(points, item.targetCount, item.deadlineTimestamp) : null
    const eta = getTimeToMilestone(points, item.targetCount, points.at(-1)?.viewCount)
    return <article className={item.hitAt ? 'is-hit' : ''} key={item.id}><div><b>{item.targetCount.toLocaleString()}</b><span>{item.deadlineTimestamp ? `Deadline ${new Date(item.deadlineTimestamp).toLocaleString()}` : 'No deadline'}</span></div><div className="milestone-meta">{probability && <ProbabilityBadge {...probability} />}<span className="milestone-eta">{item.hitAt ? `Hit ${new Date(item.hitAt).toLocaleString()}` : eta ? `ETA ${new Date(eta.estimatedAt).toLocaleString()}` : 'No ETA'}</span><button className="plain" onClick={() => db.milestones.delete(item.id)} aria-label="Remove milestone">×</button></div></article>
  })}{!milestones.length && <p className="help">No targets defined.</p>}</div><details className="add-milestone"><summary>+ Add milestone</summary><form className="milestone-form" onSubmit={add}><input type="number" min="1" value={target} onChange={event => setTarget(event.target.value)} placeholder="Target views" /><input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /><button className="primary">Add target</button></form></details></section>
}
