import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, ArrowLeft, Download, MoreVertical, Pause, Play } from 'lucide-react'
import { db } from '../../db/db.js'
import { downloadFile, videoToCsv } from '../../utils/export.js'
import { getMilestoneProbability } from '../../utils/probability.js'
import { deriveReleaseState } from '../../utils/releaseState.js'
import { formatGapDuration, getPollingGap } from '../../utils/pollingGap.js'
import { formatDateTimeEAT, formatRelativeTime, formatTimeEAT, getMidnightEAT } from '../../utils/time.js'
import useCountdown from '../../hooks/useCountdown.js'
import VelocityChart from './VelocityChart.jsx'
import HeatmapGrid from './HeatmapGrid.jsx'
import MilestonePanel from './MilestonePanel.jsx'
import NotesLog from './NotesLog.jsx'
import SessionLog from './SessionLog.jsx'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const detailTabs = [
  { key: 'overview', label: 'Overview' },
  { key: 'milestones', label: 'Milestones' },
  { key: 'notes', label: 'Notes' },
  { key: 'history', label: 'History' },
]

const stateLabels = {
  sampling: 'Sampling',
  tracking: 'Tracking',
  polling: 'Polling now',
  surging: 'Surging',
  stale: 'Stale sample',
  paused: 'Paused',
  quota: 'Quota stopped',
  error: 'Polling error',
  unavailable: 'Unavailable',
}

const compact = value => value === null || value === undefined ? '-' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)

const nearestDeadlineMilestone = milestones => {
  const dated = (milestones || []).filter(item => item?.deadlineTimestamp && !item.hitAt)
  const upcoming = dated.filter(item => item.deadlineTimestamp > Date.now()).sort((left, right) => left.deadlineTimestamp - right.deadlineTimestamp)
  if (upcoming.length) return upcoming[0]
  return dated.filter(item => item.deadlineTimestamp <= Date.now()).sort((left, right) => right.deadlineTimestamp - left.deadlineTimestamp)[0] ?? null
}

const midnightContextLabel = () => Number(formatTimeEAT(Date.now()).slice(0, 2)) < 6 ? 'Tomorrow' : 'Tonight'
const formatDeadlineLabel = deadlineTimestamp => {
  if (formatTimeEAT(deadlineTimestamp) === '00:00' && Math.abs(deadlineTimestamp - getMidnightEAT()) < 60000) return `${midnightContextLabel()}, 00:00 EAT`
  return `${formatDateTimeEAT(deadlineTimestamp)} EAT`
}

function MilestoneDeadlineRail({ milestone, points, video, videos, calibration }) {
  const countdown = useCountdown(milestone?.deadlineTimestamp)
  const probability = milestone ? getMilestoneProbability(points, milestone.targetCount, milestone.deadlineTimestamp, { video, peerVideos: videos, calibration }) : null
  const currentCount = Number(video.lastViewCount ?? points.at(-1)?.viewCount ?? 0)
  const gap = Math.max(0, Number(milestone?.targetCount || 0) - currentCount)
  const estimate = probability ? Math.round(Number(probability.probability || 0) * 100) : null
  const eta = Number.isFinite(Number(probability?.estimatedHitTime)) ? `${formatDateTimeEAT(probability.estimatedHitTime)} EAT` : 'No ETA'
  const passed = countdown === 'DEADLINE PASSED'

  if (!milestone) return null

  return <dl className="detail-deadline-rail" data-state={passed ? 'missed' : 'active'} aria-label="Active milestone deadline">
    <div><dt>Target</dt><dd>{Number(milestone.targetCount).toLocaleString()}</dd></div>
    <div><dt>Gap</dt><dd>{gap.toLocaleString()} to go</dd></div>
    <div><dt>Estimate</dt><dd className={estimate !== null && estimate >= 70 ? 'text-success' : estimate !== null && estimate < 40 ? 'text-destructive' : ''}>{estimate === null ? 'No signal' : `${estimate}% / ${probability.confidence || 'low'} evidence`}</dd></div>
    <div><dt>Time remaining</dt><dd className={passed ? 'text-destructive' : ''}>{countdown}</dd></div>
    <div><dt>ETA</dt><dd>{eta}</dd></div>
    <div className="detail-deadline-date"><dt>Deadline</dt><dd>{formatDeadlineLabel(milestone.deadlineTimestamp)}</dd></div>
  </dl>
}

export default function VideoDetail({ video, videos = [], calibration, onClose }) {
  const points = useLiveQuery(() => db.datapoints.where('videoId').equals(video.videoId).sortBy('timestamp'), [video.videoId], [])
  const notes = useLiveQuery(() => db.notes.where('videoId').equals(video.videoId).sortBy('timestamp'), [video.videoId], [])
  const milestones = useLiveQuery(() => db.milestones.where('videoId').equals(video.videoId).sortBy('createdAt'), [video.videoId], [])
  const [tab, setTab] = useState('overview')
  const backButtonRef = useRef(null)
  const paused = video.pollState === 'paused'

  useEffect(() => {
    const previouslyFocused = document.activeElement
    backButtonRef.current?.focus()
    return () => {
      // The rundown remounts on close, so the opening row element is usually
      // gone; the rundown main (tabIndex -1) is the stable fallback target.
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) previouslyFocused.focus()
      else document.getElementById('rundown-main')?.focus()
    }
  }, [])
  const activeMilestone = useMemo(() => nearestDeadlineMilestone(milestones), [milestones])
  const rowState = deriveReleaseState(video)
  const observationGap = getPollingGap(video)
  const displayState = observationGap ? 'stale' : rowState
  const displayStateLabel = observationGap ? 'Observation gap' : stateLabels[rowState]
  const title = video.customLabel || video.title || video.videoId
  const currentViews = Number(video.lastViewCount ?? points.at(-1)?.viewCount ?? 0)
  const firstSeen = points[0]?.timestamp ?? video.addedAt
  const published = video.publishedAt ? `${formatDateTimeEAT(video.publishedAt)} EAT` : 'Unknown'
  const lastObserved = video.lastPolledAt ? formatRelativeTime(video.lastPolledAt) : 'No observation'

  return <section className="detail-view fixed inset-0 z-30 flex flex-col overflow-hidden bg-background" aria-label={`${title} evidence workspace`}>
    <header className="detail-topbar">
      <div className="detail-breadcrumb min-w-0">
        <Button ref={backButtonRef} size="icon-sm" variant="ghost" onClick={onClose} aria-label="Back to release rundown"><ArrowLeft className="size-4" /></Button>
        <span className="detail-product-label">Velocity Desk / Release</span>
        <span className="detail-top-title">{title}</span>
      </div>
      <span className="detail-status" data-state={displayState}>{displayStateLabel || 'Tracking'}</span>
      <div className="detail-actions">
        <Button size="sm" variant="outline" onClick={() => db.videos.update(video.id, { pollState: paused ? 'idle' : 'paused' })}>{paused ? <Play className="size-4" /> : <Pause className="size-4" />}{paused ? 'Resume' : 'Pause'}</Button>
        <Button size="sm" variant="outline" onClick={() => downloadFile(`${video.videoId}.csv`, videoToCsv(points, notes), 'text/csv')}><Download className="size-4" />Export</Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="More release actions"><MoreVertical className="size-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem onClick={() => db.videos.update(video.id, { status: 'archived' })}><Archive className="size-4" />Archive release</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>

    <section className="detail-masthead">
      <div className="detail-release-identity">
        <div className="detail-thumbnail">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : <span>No thumbnail</span>}</div>
        <div className="min-w-0">
          <h1>{title}</h1>
          {video.customLabel && video.title && <p className="detail-original-title">{video.title}</p>}
          <p className="detail-channel">{video.channelName || 'Unknown channel'}</p>
          <p className="detail-source-line"><span>YouTube</span><code>{video.videoId}</code></p>
        </div>
      </div>

      <dl className="detail-date-ledger">
        <div><dt>Published</dt><dd>{published}</dd></div>
        <div><dt>First seen</dt><dd>{firstSeen ? `${formatDateTimeEAT(firstSeen)} EAT` : '-'}</dd></div>
        <div><dt>Last observation</dt><dd>{lastObserved}</dd></div>
      </dl>

      <dl className="detail-metric-ledger" aria-label="Release evidence summary">
        <div><dt>Total views</dt><dd>{currentViews.toLocaleString()}</dd></div>
        <div><dt>5m velocity</dt><dd className={rowState === 'surging' ? 'text-success' : ''}>{Number(video.velocity5m || 0).toFixed(1)}<small>/min</small></dd></div>
        <div><dt>30m velocity</dt><dd>{Number(video.velocity30m || 0).toFixed(1)}<small>/min</small></dd></div>
        <div><dt>Session gain</dt><dd className={Number(video.sessionGain || 0) > 0 ? 'text-success' : ''}>{Number(video.sessionGain || 0) > 0 ? '+' : ''}{compact(video.sessionGain || 0)}</dd></div>
      </dl>
    </section>

    {activeMilestone && <MilestoneDeadlineRail milestone={activeMilestone} points={points} video={video} videos={videos} calibration={calibration} />}

    <div className="detail-layout min-h-0 flex-1">
      <aside className="detail-sidebar">
        <section className="detail-context-section">
          <header><h2>Tracking</h2><span className="detail-context-state" data-state={displayState}>{displayStateLabel}</span></header>
          <div className="space-y-2"><Label htmlFor="custom-label">Custom label</Label><Input id="custom-label" defaultValue={video.customLabel || ''} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} onBlur={event => db.videos.update(video.id, { customLabel: event.target.value.trim() })} /></div>
          <div className="space-y-2"><Label htmlFor="tags">Tags</Label><Input id="tags" defaultValue={(video.tags || []).join(', ')} onKeyDown={event => event.key === 'Enter' && event.currentTarget.blur()} onBlur={event => db.videos.update(video.id, { tags: event.target.value.split(',').map(value => value.trim()).filter(Boolean) })} placeholder="artist, region, campaign" /></div>
          <div className="space-y-2"><Label htmlFor="detail-poll-interval">Poll interval</Label><Select value={String(video.pollInterval || 60)} onValueChange={value => db.videos.update(video.id, { pollInterval: Number(value) })}><SelectTrigger id="detail-poll-interval" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 seconds</SelectItem><SelectItem value="60">1 minute</SelectItem><SelectItem value="120">2 minutes</SelectItem><SelectItem value="300">5 minutes</SelectItem></SelectContent></Select></div>
        </section>

        <section className="detail-context-section">
          <h2>Release metadata</h2>
          <dl className="detail-metadata-list">
            <div><dt>Added</dt><dd>{video.addedAt ? `${formatDateTimeEAT(video.addedAt)} EAT` : '-'}</dd></div>
            <div><dt>Samples</dt><dd>{points.length.toLocaleString()}</dd></div>
            <div><dt>Likes</dt><dd>{video.lastLikeCount?.toLocaleString() ?? '-'}</dd></div>
            <div><dt>Comments</dt><dd>{video.lastCommentCount?.toLocaleString() ?? '-'}</dd></div>
            <div><dt>Poll tier</dt><dd>{video.currentTier || 'Fixed'}</dd></div>{observationGap && <div><dt>Observation gap</dt><dd className="text-warning">{formatGapDuration(observationGap.elapsedMs)} / {observationGap.missedIntervals} expected polls</dd></div>}
          </dl>
        </section>

        <section className="detail-context-section detail-source-id">
          <h2>Source ID</h2>
          <code>{video.videoId}</code>
        </section>
      </aside>

      <main className="detail-workspace min-h-0">
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="detail-tabsbar">
            <TabsList aria-label="Release evidence views">
              {detailTabs.map(item => <TabsTrigger key={item.key} value={item.key}>
                {item.label}
                {item.key === 'milestones' && milestones.length > 0 ? <Badge variant="secondary" className="metric">{milestones.length}</Badge> : null}
                {item.key === 'notes' && notes.length > 0 ? <Badge variant="secondary" className="metric">{notes.length}</Badge> : null}
              </TabsTrigger>)}
            </TabsList>
          </div>
          <TabsContent value="overview" className="detail-tab-panel"><VelocityChart points={points} notes={notes} milestones={milestones} video={video} videos={videos} calibration={calibration} /><HeatmapGrid datapoints={points} /></TabsContent>
          <TabsContent value="milestones" className="detail-tab-panel"><MilestonePanel videoId={video.videoId} video={video} videos={videos} calibration={calibration} points={points} milestones={milestones} /></TabsContent>
          <TabsContent value="notes" className="detail-tab-panel"><NotesLog videoId={video.videoId} notes={notes} /></TabsContent>
          <TabsContent value="history" className="detail-tab-panel"><SessionLog video={video} points={points} notes={notes} /></TabsContent>
        </Tabs>
      </main>
    </div>
  </section>
}