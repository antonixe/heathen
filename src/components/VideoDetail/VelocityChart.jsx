import { useMemo, useState } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMilestoneProbability } from '../../utils/probability.js'
import { detectBatchFlush, projectViewsAtTime } from '../../utils/velocity.js'

const ACCENT = 'oklch(0.84 0.14 82)'
const UP = 'oklch(0.74 0.14 148)'
const BATCH = 'oklch(0.68 0.10 290)'
const SURFACE = 'oklch(0.16 0.018 265)'
const FIFTEEN_MINUTES = 15 * 60 * 1000
const SIX_HOURS = 6 * 60 * 60 * 1000

const decimate = (data, max = 1200) => {
  if (data.length <= max) return data
  const bucket = data.length / max, result = []
  for (let index = 0; index < max; index += 1) result.push(data[Math.min(data.length - 1, Math.floor(index * bucket))])
  return result
}
const formatTime = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const BatchDot = ({ cx, cy, payload }) => payload?.isBatch ? <circle cx={cx} cy={cy} r="3" fill={SURFACE} stroke={BATCH} strokeWidth="1.5" /> : null

export default function VelocityChart({ points, notes, milestones }) {
  const [mode, setMode] = useState('both'), [showProjections, setShowProjections] = useState(false)
  const [startIndex, setStartIndex] = useState(null), [endIndex, setEndIndex] = useState(null), [dragIndex, setDragIndex] = useState(null), [zoomRange, setZoomRange] = useState(null)
  const sortedPoints = useMemo(() => [...points].sort((left, right) => left.timestamp - right.timestamp), [points])
  const batchTimes = useMemo(() => new Set(detectBatchFlush(sortedPoints).map(index => sortedPoints[index]?.timestamp)), [sortedPoints])
  const visiblePoints = useMemo(() => decimate(zoomRange ? sortedPoints.filter(point => point.timestamp >= zoomRange.start && point.timestamp <= zoomRange.end) : sortedPoints).map(point => ({ ...point, isBatch: batchTimes.has(point.timestamp) })), [batchTimes, sortedPoints, zoomRange])
  const projectionData = useMemo(() => {
    if (!showProjections || sortedPoints.length < 2) return []
    const last = sortedPoints.at(-1), rows = [{ timestamp: last.timestamp, projected: last.viewCount, low: last.viewCount, high: last.viewCount }]
    for (let timestamp = last.timestamp + FIFTEEN_MINUTES; timestamp <= last.timestamp + SIX_HOURS; timestamp += FIFTEEN_MINUTES) {
      const projection = projectViewsAtTime(sortedPoints, timestamp)
      if (projection) rows.push({ timestamp, projected: projection.projected, low: projection.low, high: projection.high })
    }
    return rows
  }, [showProjections, sortedPoints])
  const data = useMemo(() => {
    const rows = visiblePoints.map(point => ({ ...point }))
    if (!projectionData.length) return rows
    if (rows.at(-1)?.timestamp === projectionData[0].timestamp) rows.at(-1).projected = projectionData[0].projected
    return [...rows, ...projectionData.slice(1)]
  }, [projectionData, visiblePoints])
  const activeMilestone = useMemo(() => milestones.filter(item => item.deadlineTimestamp).sort((left, right) => left.deadlineTimestamp - right.deadlineTimestamp)[0] ?? null, [milestones])
  const milestoneProjection = useMemo(() => activeMilestone ? getMilestoneProbability(sortedPoints, activeMilestone.targetCount, activeMilestone.deadlineTimestamp) : null, [activeMilestone, sortedPoints])
  const projectionEnd = sortedPoints.length ? sortedPoints.at(-1).timestamp + SIX_HOURS : 0
  const xDomain = zoomRange && !showProjections ? [zoomRange.start, zoomRange.end] : [data[0]?.timestamp ?? 'dataMin', showProjections ? Math.max(projectionEnd, activeMilestone?.deadlineTimestamp ?? 0, milestoneProjection?.estimatedHitTime ?? 0) : data.at(-1)?.timestamp ?? 'dataMax']
  const selectionStart = startIndex !== null ? data[startIndex]?.timestamp : null, selectionEnd = dragIndex !== null ? data[dragIndex]?.timestamp : null
  const resetZoom = () => { setStartIndex(null); setEndIndex(null); setDragIndex(null); setZoomRange(null) }
  const handleMouseDown = event => { if (event?.activeTooltipIndex === undefined || event.activeTooltipIndex === null) return; setStartIndex(event.activeTooltipIndex); setEndIndex(null); setDragIndex(event.activeTooltipIndex) }
  const handleMouseMove = event => { if (startIndex === null || event?.activeTooltipIndex === undefined || event.activeTooltipIndex === null) return; setDragIndex(event.activeTooltipIndex) }
  const handleMouseUp = event => {
    if (startIndex === null) return
    const releasedIndex = event?.activeTooltipIndex ?? dragIndex
    setEndIndex(releasedIndex)
    if (releasedIndex !== null && releasedIndex !== startIndex) {
      const first = data[Math.min(startIndex, releasedIndex)]?.timestamp, last = data[Math.max(startIndex, releasedIndex)]?.timestamp
      if (first !== undefined && last !== undefined) setZoomRange({ start: first, end: last })
    }
    setStartIndex(null); setDragIndex(null)
  }

  return <section className="chart-section"><header><span className="section-label">Velocity chart</span><div className="segmented"><button className={mode === 'views' ? 'active' : ''} onClick={() => setMode('views')}>Views</button><button className={mode === 'velocity' ? 'active' : ''} onClick={() => setMode('velocity')}>Velocity</button><button className={mode === 'both' ? 'active' : ''} onClick={() => setMode('both')}>Both</button><button className={showProjections ? 'active' : ''} onClick={() => setShowProjections(value => !value)}>Projections</button>{zoomRange && <button onClick={resetZoom}>Reset zoom</button>}</div></header><div className="chart-wrap">{data.length < 2 ? <div className="chart-empty">At least two samples are needed.</div> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 10, left: 4 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onDoubleClick={resetZoom}>
    <CartesianGrid stroke="oklch(0.22 0.014 268)" strokeDasharray="2 4" vertical={false} /><XAxis dataKey="timestamp" type="number" domain={xDomain} allowDataOverflow minTickGap={45} axisLine={false} tickLine tickFormatter={formatTime} tick={{ fill: 'oklch(0.40 0.008 268)', fontSize: 11, fontFamily: 'DM Mono' }} /><YAxis yAxisId="views" hide={mode === 'velocity' && !showProjections} width={76} axisLine={false} tickLine tickFormatter={value => Intl.NumberFormat('en', { notation: 'compact' }).format(value)} tick={{ fill: 'oklch(0.40 0.008 268)', fontSize: 11, fontFamily: 'DM Mono' }} /><YAxis yAxisId="velocity" orientation="right" hide={mode === 'views'} width={54} axisLine={false} tickLine tick={{ fill: 'oklch(0.40 0.008 268)', fontSize: 11, fontFamily: 'DM Mono' }} />
    <Tooltip labelFormatter={formatTime} contentStyle={{ background: SURFACE, border: '1px solid oklch(0.22 0.014 268)', borderRadius: 4, fontFamily: 'DM Mono', fontSize: 12, boxShadow: 'none' }} labelStyle={{ color: 'oklch(0.94 0.008 90)' }} />
    {showProjections && projectionData.slice(1).map((point, index) => { const previous = projectionData[index]; return <ReferenceArea key={point.timestamp} yAxisId="views" x1={previous.timestamp} x2={point.timestamp} y1={Math.min(previous.low, point.low)} y2={Math.max(previous.high, point.high)} fill={ACCENT} fillOpacity={0.08} strokeOpacity={0} /> })}
    {mode !== 'velocity' && <Line yAxisId="views" type="monotone" dataKey="viewCount" stroke={ACCENT} strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: SURFACE, stroke: ACCENT }} isAnimationActive={false} />}
    {mode !== 'views' && <Line yAxisId="velocity" type="monotone" dataKey="velocityPerMin" stroke={UP} strokeWidth={1} strokeDasharray="4 2" dot={<BatchDot />} activeDot={{ r: 3, fill: SURFACE, stroke: UP }} isAnimationActive={false} />}
    {showProjections && <Line yAxisId="views" type="monotone" dataKey="projected" stroke={ACCENT} strokeWidth={1.5} strokeDasharray="3 5" dot={false} connectNulls isAnimationActive={false} />}
    {notes.map(note => <ReferenceLine key={note.id} x={note.timestamp} stroke="oklch(0.65 0.008 268)" strokeDasharray="2 3" />)}
    {milestones.map(item => <ReferenceLine key={item.id} yAxisId="views" y={item.targetCount} stroke={UP} strokeDasharray="7 4" />)}
    {showProjections && activeMilestone && <ReferenceLine x={activeMilestone.deadlineTimestamp} stroke="oklch(0.80 0.16 72)" strokeDasharray="4 4" label={{ value: 'Deadline', fill: 'oklch(0.80 0.16 72)', position: 'insideTop' }} />}
    {showProjections && milestoneProjection?.estimatedHitTime && <ReferenceLine x={milestoneProjection.estimatedHitTime} stroke={ACCENT} strokeDasharray="4 4" label={{ value: `ETA ~${formatTime(milestoneProjection.estimatedHitTime)}`, fill: ACCENT, position: 'insideTop' }} />}
    {selectionStart !== null && selectionEnd !== null && <ReferenceArea yAxisId="views" x1={selectionStart} x2={selectionEnd} fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} strokeOpacity={0.5} />}
  </ComposedChart></ResponsiveContainer>}</div></section>
}
