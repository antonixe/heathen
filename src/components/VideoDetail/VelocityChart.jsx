import { useMemo, useState } from 'react'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getMilestoneProbability } from '../../utils/probability.js'
import { detectBatchFlush, projectViewsAtTime } from '../../utils/velocity.js'
import { compact } from '../../utils/format.js'
import { chart } from '../../utils/theme.js'

const FIFTEEN_MINUTES = 15 * 60 * 1000
const SIX_HOURS = 6 * 60 * 60 * 1000

const decimate = (data, max = 1200) => {
  if (data.length <= max) return data
  const bucket = data.length / max, result = []
  for (let index = 0; index < max; index += 1) result.push(data[Math.min(data.length - 1, Math.floor(index * bucket))])
  return result
}
const formatTime = timestamp => new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const BatchDot = ({ cx, cy, payload }) => payload?.isBatch
  ? <circle cx={cx} cy={cy} r="2.5" fill={chart().panel} stroke={chart().blue} strokeWidth="1.5" /> : null

export default function VelocityChart({ points, notes, milestones }) {
  const [mode, setMode] = useState('both'), [showProjections, setShowProjections] = useState(false)
  const [startIndex, setStartIndex] = useState(null), [dragIndex, setDragIndex] = useState(null), [zoomRange, setZoomRange] = useState(null)
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

  const c = chart()
  const axisTick = { fill: c.label, fontSize: 10, fontFamily: 'IBM Plex Mono' }

  return <section className="chart-section"><header><span className="section-label">Velocity chart</span><div className="segmented"><button className={mode === 'views' ? 'active' : ''} onClick={() => setMode('views')}>Views</button><button className={mode === 'velocity' ? 'active' : ''} onClick={() => setMode('velocity')}>Velocity</button><button className={mode === 'both' ? 'active' : ''} onClick={() => setMode('both')}>Both</button><button className={showProjections ? 'active' : ''} onClick={() => setShowProjections(value => !value)}>Projections</button>{zoomRange && <button onClick={resetZoom}>Reset zoom</button>}</div></header><div className="chart-legend"><span><i className="swatch line amber" />Views</span><span><i className="swatch line green" />Velocity</span>{showProjections && <span><i className="swatch line amber dashed" />Projected</span>}</div><div className="chart-wrap">{data.length < 2 ? <div className="chart-empty">At least two samples are needed.</div> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 10, left: 4 }} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onDoubleClick={resetZoom}>
    <defs>
      <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={c.amber} stopOpacity={0.16} />
        <stop offset="100%" stopColor={c.amber} stopOpacity={0} />
      </linearGradient>
    </defs>
    <CartesianGrid stroke={c.grid} strokeDasharray="0" vertical={false} />
    <XAxis dataKey="timestamp" type="number" domain={xDomain} allowDataOverflow minTickGap={45} axisLine={false} tickLine={false} tickFormatter={formatTime} tick={axisTick} />
    <YAxis yAxisId="views" hide={mode === 'velocity' && !showProjections} width={64} axisLine={false} tickLine={false} tickFormatter={compact} tick={axisTick} />
    <YAxis yAxisId="velocity" orientation="right" hide={mode === 'views'} width={48} axisLine={false} tickLine={false} tick={axisTick} />
    <Tooltip labelFormatter={formatTime} contentStyle={{ background: c.panel, border: `1px solid ${c.border}`, borderRadius: 9, fontFamily: 'IBM Plex Mono', fontSize: 11.5, boxShadow: 'none' }} labelStyle={{ color: c.text }} />
    {showProjections && projectionData.slice(1).map((point, index) => { const previous = projectionData[index]; return <ReferenceArea key={point.timestamp} yAxisId="views" x1={previous.timestamp} x2={point.timestamp} y1={Math.min(previous.low, point.low)} y2={Math.max(previous.high, point.high)} fill={c.amber} fillOpacity={0.08} strokeOpacity={0} /> })}
    {/* primary series: 2px amber line over a .16 -> 0 vertical gradient */}
    {mode !== 'velocity' && <Area yAxisId="views" type="monotone" dataKey="viewCount" stroke={c.amber} strokeWidth={2} fill="url(#viewsFill)" dot={false} activeDot={{ r: 3, fill: c.panel, stroke: c.amber }} isAnimationActive={false} />}
    {mode !== 'views' && <Line yAxisId="velocity" type="monotone" dataKey="velocityPerMin" stroke={c.green} strokeWidth={1.5} strokeOpacity={0.9} dot={<BatchDot />} activeDot={{ r: 3, fill: c.panel, stroke: c.green }} isAnimationActive={false} />}
    {showProjections && <Line yAxisId="views" type="monotone" dataKey="projected" stroke={c.amber} strokeOpacity={0.55} strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />}
    {/* vertical lines still need a yAxisId once two y-axes exist, or recharts throws on render */}
    {notes.map(note => <ReferenceLine key={note.id} yAxisId="views" x={note.timestamp} stroke={c.label} strokeOpacity={0.5} strokeDasharray="2 3" />)}
    {milestones.map(item => <ReferenceLine key={item.id} yAxisId="views" y={item.targetCount} stroke={c.amber} strokeOpacity={0.55} strokeDasharray="6 4" />)}
    {/* different offsets keep these two off each other: being on track puts the ETA right beside
        the deadline, which is exactly when both labels wanted the same spot */}
    {showProjections && activeMilestone && <ReferenceLine yAxisId="views" x={activeMilestone.deadlineTimestamp} stroke={c.amber} strokeOpacity={0.55} strokeDasharray="4 4" label={{ value: 'Deadline', fill: c.amber, fontFamily: 'IBM Plex Mono', fontSize: 10, position: 'insideTop', offset: 6 }} />}
    {showProjections && milestoneProjection?.estimatedHitTime && <ReferenceLine yAxisId="views" x={milestoneProjection.estimatedHitTime} stroke={c.green} strokeDasharray="4 4" label={{ value: `ETA ~${formatTime(milestoneProjection.estimatedHitTime)}`, fill: c.green, fontFamily: 'IBM Plex Mono', fontSize: 10, position: 'insideTop', offset: 26 }} />}
    {selectionStart !== null && selectionEnd !== null && <ReferenceArea yAxisId="views" x1={selectionStart} x2={selectionEnd} fill={c.amber} fillOpacity={0.14} stroke={c.amber} strokeOpacity={0.5} />}
  </ComposedChart></ResponsiveContainer>}</div></section>
}
