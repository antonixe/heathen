import React, { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMilestoneProbability } from '../../utils/probability.js'
import { detectBatchFlush, fitDecayCurve, getRollingVelocity, projectViewsAtTime } from '../../utils/velocity.js'
import { formatTimeEAT } from '../../utils/time.js'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

const ACCENT = 'var(--primary)'
const UP = 'var(--success)'
const BATCH = 'var(--chart-5)'
const SURFACE = 'var(--card)'
const TWELVE_HOURS = 12 * 60 * 60 * 1000

class ChartErrorBoundary extends React.Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error) { console.error('VelocityChart render error', error) }
  render() {
    if (this.state.error) return <div className="grid h-[280px] place-items-center text-sm text-muted-foreground"><div className="grid justify-items-center gap-2"><span>Chart error, try toggling Projections off</span><Button size="sm" variant="outline" onClick={() => this.setState({ error: null })}>Retry</Button></div></div>
    return this.props.children
  }
}

const decimate = (data, max = 1200) => {
  if (data.length <= max) return data
  const bucket = data.length / max, result = []
  for (let index = 0; index < max; index += 1) result.push(data[Math.min(data.length - 1, Math.floor(index * bucket))])
  return result
}

const formatTime = timestamp => formatTimeEAT(timestamp)
const isFiniteNumber = value => Number.isFinite(Number(value))
const BatchDot = ({ cx, cy, payload }) => payload?.isBatch ? <circle cx={cx} cy={cy} r="3" fill={SURFACE} stroke={BATCH} strokeWidth="1.5" /> : null

function buildProjectionData(datapoints, deadlineMs, options = {}) {
  try {
    const valid = [...(datapoints || [])]
      .filter(point => isFiniteNumber(point.timestamp) && isFiniteNumber(point.viewCount))
      .map(point => ({ ...point, timestamp: Number(point.timestamp), viewCount: Number(point.viewCount) }))
      .sort((left, right) => left.timestamp - right.timestamp)
    if (valid.length < 2) return []
    const now = Date.now()
    const lastPoint = valid.at(-1)
    const currentCount = Number(lastPoint.viewCount)
    const curve = fitDecayCurve(valid)
    const fallbackEnd = now + TWELVE_HOURS
    const end = isFiniteNumber(deadlineMs) && Number(deadlineMs) > now ? Number(deadlineMs) : fallbackEnd
    const steps = 20
    const stepMs = (end - now) / steps
    if (!Number.isFinite(stepMs) || stepMs <= 0) return []
    const rows = []
    for (let index = 0; index <= steps; index += 1) {
      const timestamp = now + index * stepMs
      let projected, low, high
      if (curve?.r2 >= 0.4) {
        const result = projectViewsAtTime(valid, timestamp, options)
        if (!result) continue
        projected = result.projected; low = result.low; high = result.high
      } else {
        const velocity = getRollingVelocity(valid, 30) ?? getRollingVelocity(valid, 60) ?? 0
        const elapsed = (timestamp - now) / 60000
        projected = currentCount + velocity * elapsed
        low = currentCount + velocity * elapsed * 0.7
        high = currentCount + velocity * elapsed * 1.3
      }
      if (!Number.isFinite(projected) || !Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(timestamp)) continue
      rows.push({ timestamp, projected: Math.round(projected), low: Math.round(low), high: Math.round(high) })
    }
    return rows
  } catch (error) {
    console.error('VelocityChart projection build error', error)
    return []
  }
}

export default function VelocityChart({ points, notes, milestones, video, videos = [], calibration }) {
  const [mode, setMode] = useState('both'), [showProjections, setShowProjections] = useState(false)
  const [startIndex, setStartIndex] = useState(null), [dragIndex, setDragIndex] = useState(null), [zoomRange, setZoomRange] = useState(null)
  const sortedPoints = useMemo(() => [...(points || [])].filter(point => isFiniteNumber(point.timestamp) && isFiniteNumber(point.viewCount)).sort((left, right) => Number(left.timestamp) - Number(right.timestamp)), [points])
  const batchTimes = useMemo(() => new Set(detectBatchFlush(sortedPoints).map(index => sortedPoints[index]?.timestamp).filter(isFiniteNumber)), [sortedPoints])
  const visiblePoints = useMemo(() => decimate(zoomRange ? sortedPoints.filter(point => point.timestamp >= zoomRange.start && point.timestamp <= zoomRange.end) : sortedPoints).map(point => ({ ...point, isBatch: batchTimes.has(point.timestamp) })), [batchTimes, sortedPoints, zoomRange])
  const activeMilestone = useMemo(() => (milestones || []).filter(item => isFiniteNumber(item.deadlineTimestamp)).sort((left, right) => Number(left.deadlineTimestamp) - Number(right.deadlineTimestamp))[0] ?? null, [milestones])
  const deadlineMs = activeMilestone?.deadlineTimestamp && Number(activeMilestone.deadlineTimestamp) > Date.now() ? Number(activeMilestone.deadlineTimestamp) : null
  const projectionData = useMemo(() => showProjections ? buildProjectionData(sortedPoints, deadlineMs, { video, peerVideos: videos }) : [], [deadlineMs, showProjections, sortedPoints, video, videos])
  const data = useMemo(() => visiblePoints.map(point => ({ ...point })), [visiblePoints])
  const milestoneProjection = useMemo(() => activeMilestone ? getMilestoneProbability(sortedPoints, activeMilestone.targetCount, activeMilestone.deadlineTimestamp, { video, peerVideos: videos, calibration }) : null, [activeMilestone, sortedPoints, video, videos, calibration])
  const estimatedHitTime = isFiniteNumber(milestoneProjection?.estimatedHitTime) && Number(milestoneProjection.estimatedHitTime) > Date.now() ? Number(milestoneProjection.estimatedHitTime) : null
  const projectionEnd = projectionData.at(-1)?.timestamp
  const maxProjectionX = Math.max(projectionEnd ?? 0, deadlineMs ?? 0, estimatedHitTime ?? 0)
  const xDomain = zoomRange && !showProjections ? [zoomRange.start, zoomRange.end] : [data[0]?.timestamp ?? 'dataMin', showProjections && maxProjectionX ? maxProjectionX : data.at(-1)?.timestamp ?? 'dataMax']
  const selectionStart = startIndex !== null ? data[startIndex]?.timestamp : null, selectionEnd = dragIndex !== null ? data[dragIndex]?.timestamp : null
  const resetZoom = () => { setStartIndex(null); setDragIndex(null); setZoomRange(null) }
  const handleMouseDown = event => { if (event?.activeTooltipIndex === undefined || event.activeTooltipIndex === null) return; setStartIndex(event.activeTooltipIndex); setDragIndex(event.activeTooltipIndex) }
  const handleMouseMove = event => { if (startIndex === null || event?.activeTooltipIndex === undefined || event.activeTooltipIndex === null) return; setDragIndex(event.activeTooltipIndex) }
  const handleMouseUp = event => {
    if (startIndex === null) return
    const releasedIndex = event?.activeTooltipIndex ?? dragIndex
    if (releasedIndex !== null && releasedIndex !== startIndex) {
      const first = data[Math.min(startIndex, releasedIndex)]?.timestamp, last = data[Math.max(startIndex, releasedIndex)]?.timestamp
      if (first !== undefined && last !== undefined) setZoomRange({ start: first, end: last })
    }
    setStartIndex(null); setDragIndex(null)
  }
  const showProjectionFallback = showProjections && sortedPoints.length < 2

  return <section className="evidence-surface velocity-panel">
    <header className="velocity-panel-header">
      <div><h2>Views over time</h2><p>Observed counts and rolling velocity in EAT</p></div>
      <div className="velocity-controls">
        <div className="mode-segment" role="group" aria-label="Chart metric">
          {['views', 'velocity', 'both'].map(item => <button type="button" data-active={mode === item || undefined} aria-pressed={mode === item} key={item} onClick={() => setMode(item)}>{item === 'both' ? 'Combined' : item[0].toUpperCase() + item.slice(1)}</button>)}
        </div>
        <label className="projection-toggle"><span>Projection</span><Switch checked={showProjections} onCheckedChange={setShowProjections} aria-label="Show projection" /></label>
        {zoomRange && <Button size="sm" variant="outline" onClick={resetZoom}>Reset view</Button>}
      </div>
    </header>
    <div className="velocity-legend" aria-label="Chart legend">
      {mode !== 'velocity' && <span><i data-series="views" />Actual views</span>}
      {mode !== 'views' && <span><i data-series="velocity" />Rolling velocity</span>}
      {showProjections && <span><i data-series="projection" />Projected pace</span>}
      {activeMilestone && <span><i data-series="target" />Target</span>}
    </div>
    <div className="velocity-chart-canvas select-none">{showProjectionFallback ? <div className="grid h-full place-items-center text-sm text-muted-foreground metric">Need more data for projections</div> : data.length < 2 ? <div className="grid h-full place-items-center text-sm text-muted-foreground metric">At least two samples are needed.</div> : <ChartErrorBoundary><ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 10, left: 4 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onDoubleClick={resetZoom}>
      <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} /><XAxis dataKey="timestamp" type="number" domain={xDomain} allowDataOverflow minTickGap={45} axisLine={false} tickLine tickFormatter={formatTime} tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' }} /><YAxis yAxisId="views" hide={mode === 'velocity' && !showProjections} width={76} axisLine={false} tickLine tickFormatter={value => Intl.NumberFormat('en', { notation: 'compact' }).format(value)} tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' }} /><YAxis yAxisId="velocity" orientation="right" hide={mode === 'views'} width={54} axisLine={false} tickLine tick={{ fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-mono)' }} />
      <Tooltip labelFormatter={value => `${formatTime(value)} EAT`} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontFamily: 'var(--font-mono)', fontSize: 12, boxShadow: 'var(--shadow-md)' }} labelStyle={{ color: 'var(--foreground)' }} />
      {showProjections && projectionData.length > 1 && <Area yAxisId="views" data={projectionData} type="monotone" dataKey="high" fill={ACCENT} fillOpacity={0.08} stroke="none" dot={false} isAnimationActive={false} />}
      {showProjections && projectionData.length > 1 && <Area yAxisId="views" data={projectionData} type="monotone" dataKey="low" fill="var(--background)" fillOpacity={1} stroke="none" dot={false} isAnimationActive={false} />}
      {mode !== 'velocity' && <Line yAxisId="views" type="monotone" dataKey="viewCount" stroke={ACCENT} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: SURFACE, stroke: ACCENT }} isAnimationActive={false} />}
      {mode !== 'views' && <Line yAxisId="velocity" type="monotone" dataKey="velocityPerMin" stroke={UP} strokeWidth={1} strokeDasharray="4 2" dot={<BatchDot />} activeDot={{ r: 3, fill: SURFACE, stroke: UP }} isAnimationActive={false} />}
      {showProjections && projectionData.length > 1 && <Line yAxisId="views" data={projectionData} type="monotone" dataKey="projected" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />}
      {(notes || []).filter(note => isFiniteNumber(note.timestamp)).map(note => <ReferenceLine key={note.id ?? note.timestamp} x={Number(note.timestamp)} stroke="var(--muted-foreground)" strokeDasharray="2 3" />)}
      {(milestones || []).filter(item => isFiniteNumber(item.targetCount)).map(item => <ReferenceLine key={item.id ?? item.targetCount} yAxisId="views" y={Number(item.targetCount)} stroke={UP} strokeDasharray="7 4" />)}
      {showProjections && deadlineMs && <ReferenceLine x={deadlineMs} stroke="var(--muted-foreground)" strokeDasharray="3 3" label={{ value: 'Deadline', fill: 'var(--muted-foreground)', fontSize: 11, fontFamily: 'var(--font-sans)' }} />}
      {showProjections && estimatedHitTime && <ReferenceLine x={estimatedHitTime} stroke="var(--primary)" strokeDasharray="3 3" label={{ value: 'ETA', fill: 'var(--primary)', fontSize: 11, fontFamily: 'var(--font-sans)' }} />}
      {selectionStart !== null && selectionEnd !== null && <ReferenceArea yAxisId="views" x1={selectionStart} x2={selectionEnd} fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} strokeOpacity={0.5} />}
    </ComposedChart></ResponsiveContainer></ChartErrorBoundary>}</div>
  </section>
}
