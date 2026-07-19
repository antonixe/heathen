import { useEffect, useMemo, useRef, useState } from 'react'
import Dexie from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { Archive, BarChart3, Check, Eye, ImageOff, MoreVertical, Pause, RefreshCw, Tag, Target, Trash2, X } from 'lucide-react'
import { db, deleteVideoData } from '../../db/db.js'
import MiniSparkline from './MiniSparkline.jsx'
import { buildDeadlineSignal } from '../../utils/summary.js'
import { applyProbabilityCalibration } from '../../utils/probability.js'
import { getActiveMilestone } from '../../utils/milestone.js'
import { formatRelativeTime, formatTimeEAT } from '../../utils/time.js'
import { deriveReleaseState } from '../../utils/releaseState.js'
import { formatGapDuration, getPollingGap } from '../../utils/pollingGap.js'
import useCountdown from '../../hooks/useCountdown.js'
import { refreshNow } from '../../hooks/usePoller.js'
import ProbabilityBadge from '../shared/ProbabilityBadge.jsx'
import AnimatedCount from '../shared/AnimatedCount.jsx'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const metric = value => value === null || value === undefined ? '-' : Number(value).toFixed(1)
const compact = value => value === null || value === undefined ? '-' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const pollInterval = video => video.currentIntervalMs ? `${Math.round(video.currentIntervalMs / 1000)}s` : `${video.pollInterval || 60}s`
const bestVelocity = video => Math.max(0, Number(video.velocity5m || 0), Number(video.velocity30m || 0), Number(video.velocity1h || 0), Number(video.sessionAvg || 0))


function stateConfig(rowState) {
  if (rowState === 'surging') return { label: 'Surging', text: 'text-success', progress: 'bg-success' }
  if (rowState === 'polling') return { label: 'Polling', text: 'text-foreground', progress: 'bg-success' }
  if (rowState === 'error') return { label: 'Polling error', text: 'text-destructive', progress: 'bg-destructive' }
  if (rowState === 'quota') return { label: 'Quota stopped', text: 'text-warning', progress: 'bg-warning' }
  if (rowState === 'unavailable') return { label: 'Unavailable', text: 'text-destructive', progress: 'bg-destructive' }
  if (rowState === 'paused') return { label: 'Paused', text: 'text-warning', progress: 'bg-warning' }
  if (rowState === 'stale') return { label: 'Stale', text: 'text-warning', progress: 'bg-warning' }
  if (rowState === 'sampling') return { label: 'Sampling', text: 'text-muted-foreground', progress: 'bg-foreground' }
  return { label: 'Tracking', text: 'text-muted-foreground', progress: 'bg-foreground' }
}

function ReleaseStat({ label, value, tone = 'text-foreground', className }) {
  return <div className={cn('release-stat min-w-0', className)}>
    <span className="release-stat-label lg:hidden">{label}</span>
    <span className={cn('metric block truncate text-sm', tone)}>{value}</span>
  </div>
}

export default function VideoTile({ video, index, calibration, onOpen, onCompare }) {
  const milestones = useLiveQuery(() => db.milestones.where('videoId').equals(video.videoId).toArray(), [video.videoId], [])
  const sparkPoints = useLiveQuery(
    () => db.datapoints.where('[videoId+timestamp]')
      .between([video.videoId, Dexie.minKey], [video.videoId, Dexie.maxKey])
      .reverse().limit(20).toArray()
      .then(rows => rows.reverse()),
    [video.videoId],
    [],
  )
  const [refreshState, setRefreshState] = useState('idle')
  const [isSwitchingMilestone, setIsSwitchingMilestone] = useState(false)
  const [editingLabel, setEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [removeArmed, setRemoveArmed] = useState(false)
  const refreshTimers = useRef([])
  const removeTimer = useRef(null)
  const labelInput = useRef(null)
  const previousMilestoneId = useRef(null)

  useEffect(() => () => {
    refreshTimers.current.forEach(clearTimeout)
    clearTimeout(removeTimer.current)
  }, [])

  useEffect(() => {
    if (!editingLabel) return
    labelInput.current?.focus()
    labelInput.current?.select()
  }, [editingLabel])

  const latestTimestamp = video.lastPolledAt ?? null
  const latestViewCount = video.lastViewCount ?? 0
  const firstViewCount = video.firstViewCount ?? latestViewCount
  const activeMilestone = useMemo(() => getActiveMilestone(milestones, latestViewCount), [milestones, latestViewCount])
  const activeMilestoneId = activeMilestone?.id ?? null
  const activeMilestoneHit = Boolean(activeMilestone?.hitAt) || (activeMilestone && latestViewCount >= activeMilestone.targetCount)
  const countdown = useCountdown(activeMilestone?.deadlineTimestamp && !activeMilestoneHit ? activeMilestone.deadlineTimestamp : null)
  const countdownText = activeMilestoneHit ? 'HIT' : countdown
  const countdownPassed = countdownText === 'DEADLINE PASSED'
  const signalBase = activeMilestone?.deadlineTimestamp && !activeMilestoneHit ? buildDeadlineSignal(video, activeMilestone) : null
  const signal = signalBase ? {
    ...signalBase,
    probability: applyProbabilityCalibration(signalBase.probability, calibration),
    reasons: [...(signalBase.reasons || []), calibration?.ready ? 'empirically calibrated' : 'heuristic estimate'],
  } : null
  const gap = activeMilestone ? Math.max(0, activeMilestone.targetCount - latestViewCount) : 0
  const etaTimestamp = activeMilestone && !activeMilestoneHit && bestVelocity(video) > 0 ? Date.now() + (gap / bestVelocity(video)) * 60000 : null
  const state = video.pollState || 'idle'
  const rowState = deriveReleaseState(video)
  const observationGap = getPollingGap(video)
  const displayRowState = observationGap ? 'stale' : rowState
  const tone = observationGap ? { label: 'Observation gap', text: 'text-warning', progress: 'bg-warning' } : stateConfig(rowState)
  const sessionGain = video.sessionGain ?? 0
  const progress = activeMilestone && activeMilestone.targetCount !== firstViewCount
    ? activeMilestoneHit ? 1 : Math.max(0, Math.min(1, (latestViewCount - firstViewCount) / (activeMilestone.targetCount - firstViewCount)))
    : activeMilestoneHit ? 1 : 0
  const refreshTooltip = refreshState === 'loading' ? 'Fetching...' : refreshState === 'error' ? 'Failed, try again' : refreshState === 'cooldown' ? 'Cooling down' : 'Refresh now'
  const displayTitle = video.customLabel || video.title || video.videoId
  const subtitle = video.customLabel && video.title ? video.title : video.channelName || 'Awaiting metadata'
  const sampleText = latestTimestamp ? formatRelativeTime(latestTimestamp) : video.errorMessage || 'No sample yet'
  const pollText = observationGap ? 'Gap ' + formatGapDuration(observationGap.elapsedMs) : rowState === 'polling' ? 'Polling now' : rowState === 'error' ? 'Poll failed' : rowState === 'quota' ? 'Quota stopped' : rowState === 'unavailable' ? 'Unavailable' : video.nextPollAt ? formatRelativeTime(video.nextPollAt) : (video.currentTier || 'fixed') + ' cycle'
  const etaText = activeMilestoneHit ? 'HIT' : etaTimestamp ? `${formatTimeEAT(etaTimestamp)} EAT` : '-'
  const targetText = activeMilestone ? compact(activeMilestone.targetCount) : 'None'
  const gapText = activeMilestone ? compact(gap) : '-'
  const deadlineText = activeMilestone?.deadlineTimestamp ? countdownText : 'No deadline'

  useEffect(() => {
    if (previousMilestoneId.current === null) {
      previousMilestoneId.current = activeMilestoneId
      return undefined
    }
    if (previousMilestoneId.current === activeMilestoneId) return undefined
    previousMilestoneId.current = activeMilestoneId
    setIsSwitchingMilestone(true)
    const timer = setTimeout(() => setIsSwitchingMilestone(false), 200)
    return () => clearTimeout(timer)
  }, [activeMilestoneId])

  const pause = async () => db.videos.update(video.id, { pollState: state === 'paused' ? 'idle' : 'paused' })
  const beginLabelEdit = () => {
    setLabelDraft(video.customLabel || video.title || '')
    setEditingLabel(true)
  }
  const saveLabel = async event => {
    event?.preventDefault()
    await db.videos.update(video.id, { customLabel: labelDraft.trim() })
    setEditingLabel(false)
  }
  const cancelLabel = () => {
    setLabelDraft('')
    setEditingLabel(false)
  }
  const armRemove = () => {
    clearTimeout(removeTimer.current)
    setRemoveArmed(true)
    removeTimer.current = setTimeout(() => setRemoveArmed(false), 8000)
  }
  const remove = async () => {
    clearTimeout(removeTimer.current)
    await deleteVideoData(video.videoId)
  }
  const startCooldown = delay => {
    refreshTimers.current.push(setTimeout(() => {
      setRefreshState('cooldown')
      refreshTimers.current.push(setTimeout(() => setRefreshState('idle'), 5000))
    }, delay))
  }
  const handleRefresh = async event => {
    event?.stopPropagation()
    if (refreshState !== 'idle') return
    refreshTimers.current.forEach(clearTimeout)
    refreshTimers.current = []
    setRefreshState('loading')
    try {
      await refreshNow(video.videoId)
      setRefreshState('success')
      startCooldown(420)
    } catch {
      setRefreshState('error')
      startCooldown(1500)
    }
  }

  return <article className="release-row group text-card-foreground" style={{ '--row-index': index }} data-state={displayRowState} data-editing={editingLabel || undefined} data-tile-index={index} onClick={event => { if (!event.target.closest('button,[role="menuitem"],input')) onOpen(video) }}>
    <span className="release-ordinal metric" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>

    <div className="release-primary min-w-0">
      <div className="release-art overflow-hidden">
        {video.thumbnailUrl ? <img className="h-full w-full object-cover" src={video.thumbnailUrl} alt="" loading="lazy" /> : <div className="grid h-full place-items-center text-muted-foreground"><ImageOff className="size-4" /></div>}
      </div>
      <div className="min-w-0">
        <div className="release-state-line">
          <span className={cn('release-state', tone.text)}>{tone.label}</span>
          {signal && <ProbabilityBadge {...signal} label="target signal" />}
        </div>
        {editingLabel ? <form className="release-label-editor" onSubmit={saveLabel} onClick={event => event.stopPropagation()}>
          <input ref={labelInput} value={labelDraft} onChange={event => setLabelDraft(event.target.value)} onKeyDown={event => event.key === 'Escape' && cancelLabel()} aria-label="Track label" />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Save label"><Check className="size-3.5" /></Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel label editing" onClick={cancelLabel}><X className="size-3.5" /></Button>
        </form> : <h2 className="line-clamp-1 text-sm font-semibold leading-tight"><button type="button" className="max-w-full truncate text-left hover:underline" onClick={() => onOpen(video)}>{displayTitle}</button></h2>}
        <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>

    <ReleaseStat className="release-views" label="Views" value={latestTimestamp ? <AnimatedCount value={latestViewCount} /> : '-'} tone={rowState === 'error' || rowState === 'unavailable' ? 'text-destructive' : 'text-foreground'} />
    <ReleaseStat className="release-velocity-five" label="5m" value={metric(video.velocity5m)} tone={rowState === 'surging' ? 'text-success' : rowState === 'error' ? 'text-destructive' : 'text-foreground'} />
    <ReleaseStat className="release-velocity-thirty" label="30m" value={metric(video.velocity30m)} tone={rowState === 'surging' ? 'text-success' : rowState === 'error' ? 'text-destructive' : 'text-foreground'} />

    <div className="release-trend hidden lg:block" aria-hidden="true"><MiniSparkline points={sparkPoints} /></div>

    <div className={cn('release-target transition-opacity', isSwitchingMilestone && 'opacity-60')}>
      <span className="release-stat-label lg:hidden">Target</span>
      <span className={cn('metric block truncate text-sm', activeMilestone ? 'text-foreground' : 'text-muted-foreground')}>{targetText}</span>
      <span className={cn('metric mt-1 block truncate text-[11px] text-muted-foreground', countdownPassed && 'text-destructive')}>{activeMilestone ? `${gapText} to go / ${deadlineText}` : 'No target set'}</span>
      {latestTimestamp && activeMilestone && <Progress value={progress * 100} className="mt-2 h-0.5 bg-border" indicatorClassName={tone.progress} />}
    </div>

    <div className="release-poll min-w-0">
      <span className="release-stat-label lg:hidden">Next poll</span>
      <span className={cn('metric block truncate text-sm', rowState === 'error' || rowState === 'unavailable' ? 'text-destructive' : observationGap || rowState === 'stale' || rowState === 'quota' || rowState === 'paused' ? 'text-warning' : 'text-foreground')}>{pollText}</span>
      {rowState === 'polling' && <span className="polling-track mt-2" aria-hidden="true"><span /></span>}
      {rowState === 'error' ? <button type="button" className="row-recovery mt-1" disabled={refreshState !== 'idle'} onClick={handleRefresh}><RefreshCw className={cn('size-3', refreshState === 'loading' && 'animate-spin')} />Retry</button> : <span className="metric mt-1 block truncate text-[11px] text-muted-foreground">{observationGap ? 'Missed ' + observationGap.missedIntervals + ' expected / ' + sampleText : pollInterval(video) + ' / ' + sampleText}</span>}
      {sessionGain > 0 && <span className="metric mt-1 block text-[11px] text-success">+{compact(sessionGain)} session</span>}
      {etaText !== '-' && <span className="metric mt-1 block truncate text-[11px] text-muted-foreground">ETA {etaText}</span>}
    </div>

    <div className="release-actions flex items-start justify-end gap-1" onClick={event => event.stopPropagation()}>
      <Tooltip>
        <TooltipTrigger asChild><Button type="button" size="icon-sm" variant="ghost" disabled={refreshState !== 'idle'} onClick={handleRefresh} aria-label="Refresh now"><RefreshCw className={cn('size-4', refreshState === 'loading' && 'animate-spin', refreshState === 'error' && 'text-destructive')} /></Button></TooltipTrigger>
        <TooltipContent>{refreshTooltip}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button type="button" size="icon-sm" variant="ghost" aria-label="Track actions"><MoreVertical className="size-4" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => onOpen(video)}><Eye className="size-4" />View detail</DropdownMenuItem>
          <DropdownMenuItem onClick={beginLabelEdit}><Tag className="size-4" />Edit label inline</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onOpen(video)}><Target className="size-4" />Add milestone</DropdownMenuItem>
          <DropdownMenuItem onClick={pause}><Pause className="size-4" />{state === 'paused' ? 'Resume' : 'Pause'}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onCompare(video)}><BarChart3 className="size-4" />Compare</DropdownMenuItem>
          <DropdownMenuItem onClick={() => db.videos.update(video.id, { status: 'archived' })}><Archive className="size-4" />Archive</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={armRemove}><Trash2 className="size-4" />Stage removal</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    {removeArmed && <div className="release-removal" role="group" aria-label={`Confirm removal of ${displayTitle}`} onClick={event => event.stopPropagation()}>
      <span><strong>Remove this release?</strong> Its local samples, milestones, and notes will be deleted.</span>
      <div className="flex shrink-0 gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => setRemoveArmed(false)}>Keep</Button><Button type="button" size="sm" variant="destructive" onClick={remove}>Remove</Button></div>
    </div>}
  </article>
}