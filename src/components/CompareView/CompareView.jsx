import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowLeftRight } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db } from '../../db/db.js'
import { buildComparisonSeries, canCompareSeries } from '../../utils/comparison.js'
import { formatDateEAT, formatTimeEAT } from '../../utils/time.js'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const compact = value => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0))
const gain = rows => rows.length ? Number(rows.at(-1)?.viewCount || 0) - Number(rows[0]?.viewCount || 0) : 0
const duration = rows => rows.length > 1 ? Math.max(0, Number(rows.at(-1).timestamp) - Number(rows[0].timestamp)) : 0
const durationLabel = milliseconds => {
  const minutes = Math.floor(milliseconds / 60000)
  if (minutes < 60) return minutes + 'm'
  return Math.floor(minutes / 60) + 'h ' + minutes % 60 + 'm'
}

const alignmentModes = [
  { key: 'tracking', label: 'Since tracking', title: 'Gain since tracking', description: 'Each release starts at its first local observation.' },
  { key: 'publish', label: 'Since publish', title: 'Views by release age', description: 'Total views aligned to each release publication time.' },
  { key: 'clock', label: 'Shared clock', title: 'Views on shared clock', description: 'Total views aligned to the same observed time in EAT.' },
]

const formatRelativeAxis = value => {
  const minutes = Number(value)
  if (Math.abs(minutes) < 60) return minutes + 'm'
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 48) return hours + 'h'
  return Math.round(hours / 24) + 'd'
}

function ReleaseSelector({ label, series, video, value, videos, exclude, onChange, rows }) {
  const currentGain = gain(rows)
  return <section className="compare-release" data-series={series}>
    <div className="compare-select-control">
      <span className="compare-series-letter">{series}</span>
      <div className="min-w-0 flex-1 space-y-2"><Label htmlFor={'compare-track-' + series}>{label}</Label><Select value={value} onValueChange={onChange}><SelectTrigger id={'compare-track-' + series} className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent>{videos.map(item => <SelectItem key={item.videoId} value={item.videoId} disabled={item.videoId === exclude}>{item.customLabel || item.title || item.videoId}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <div className="compare-release-identity">
      <div className="compare-thumb">{video?.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : null}</div>
      <div className="min-w-0"><strong>{video?.customLabel || video?.title || 'Select a release'}</strong><span>{video?.channelName || 'No channel selected'}</span></div>
    </div>
    <dl className="compare-release-metrics">
      <div><dt>Total views</dt><dd>{compact(video?.lastViewCount)}</dd></div>
      <div><dt>30m velocity</dt><dd>{Number(video?.velocity30m || 0).toFixed(1)}<small>/min</small></dd></div>
      <div><dt>Session gain</dt><dd className={currentGain > 0 ? 'text-success' : ''}>{currentGain > 0 ? '+' : ''}{compact(currentGain)}</dd></div>
    </dl>
  </section>
}

export default function CompareView({ videos, initial, onClose }) {
  const [a, setA] = useState(initial?.videoId || videos[0]?.videoId || '')
  const [b, setB] = useState(videos.find(video => video.videoId !== (initial?.videoId || videos[0]?.videoId))?.videoId || '')
  const [alignment, setAlignment] = useState('tracking')
  const rowsA = useLiveQuery(() => a ? db.datapoints.where('videoId').equals(a).sortBy('timestamp') : [], [a], [])
  const rowsB = useLiveQuery(() => b ? db.datapoints.where('videoId').equals(b).sortBy('timestamp') : [], [b], [])
  const selectedA = videos.find(video => video.videoId === a)
  const selectedB = videos.find(video => video.videoId === b)
  const data = useMemo(() => buildComparisonSeries(rowsA, rowsB, alignment, selectedA, selectedB), [rowsA, rowsB, alignment, selectedA, selectedB])
  const comparisonState = canCompareSeries(rowsA, rowsB, alignment, selectedA, selectedB)
  const alignmentDefinition = alignmentModes.find(mode => mode.key === alignment)
  const hasCoreEvidence = rowsA.length > 1 && rowsB.length > 1
  const gainA = gain(rowsA)
  const gainB = gain(rowsB)
  const difference = gainB - gainA
  const leadLabel = !hasCoreEvidence ? 'Waiting for evidence' : difference === 0 ? 'Performance even' : (difference > 0 ? 'Release B' : 'Release A') + ' leads'
  const swap = () => {
    const previousA = a
    setA(b)
    setB(previousA)
  }
  const formatXAxis = value => alignment === 'clock' ? formatDateEAT(value) + ' ' + formatTimeEAT(value) : formatRelativeAxis(value)
  const formatTooltipLabel = value => alignment === 'clock' ? formatDateEAT(value) + ', ' + formatTimeEAT(value) + ' EAT' : formatRelativeAxis(value) + (alignment === 'publish' ? ' since publish' : ' since tracking')

  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="compare-dialog">
      <DialogHeader className="operator-dialog-header">
        <DialogTitle>Compare releases</DialogTitle>
        <DialogDescription>Choose how observations should be aligned before judging relative performance.</DialogDescription>
      </DialogHeader>

      {videos.length < 2 ? <div className="operator-empty-state"><strong>Two releases are required</strong><p>Track another release before opening the comparison workspace.</p></div> : <>
        <div className="compare-selectors">
          <ReleaseSelector label="Release A" series="A" video={selectedA} value={a} videos={videos} exclude={b} onChange={setA} rows={rowsA} />
          <Button type="button" size="icon" variant="outline" className="compare-swap" onClick={swap} aria-label="Swap compared releases"><ArrowLeftRight className="size-4" /></Button>
          <ReleaseSelector label="Release B" series="B" video={selectedB} value={b} videos={videos} exclude={a} onChange={setB} rows={rowsB} />
        </div>

        <section className="compare-chart-surface">
          <header>
            <div><h2>{alignmentDefinition.title}</h2><p>{alignmentDefinition.description}</p></div>
            <div className="compare-chart-legend"><span><i data-series="a" />A</span><span><i data-series="b" />B</span></div>
          </header>
          <div className="compare-alignment" role="tablist" aria-label="Comparison alignment">
            {alignmentModes.map(mode => <button type="button" role="tab" id={'compare-align-' + mode.key} aria-controls="compare-chart-canvas" aria-selected={alignment === mode.key} data-active={alignment === mode.key || undefined} onClick={() => setAlignment(mode.key)} key={mode.key}>{mode.label}</button>)}
          </div>
          <div className="compare-chart-canvas" id="compare-chart-canvas" role="tabpanel" aria-labelledby={'compare-align-' + alignment}>{comparisonState.ready && data.length > 1 ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
            <XAxis dataKey="x" axisLine={false} minTickGap={28} tickFormatter={formatXAxis} tick={{ fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: 11 }} />
            <YAxis width={68} axisLine={false} tickFormatter={value => Intl.NumberFormat('en', { notation: 'compact' }).format(value)} tick={{ fill: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', fontSize: 11 }} />
            {alignment === 'tracking' && <ReferenceLine y={0} stroke="var(--line-hard)" />}
            <Tooltip labelFormatter={formatTooltipLabel} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)', fontFamily: 'var(--font-mono)', fontSize: 12 }} />
            <Line name={selectedA?.customLabel || selectedA?.title || 'Release A'} dataKey="a" stroke="var(--foreground)" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
            <Line name={selectedB?.customLabel || selectedB?.title || 'Release B'} dataKey="b" stroke="var(--success)" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} />
          </LineChart></ResponsiveContainer> : <div className="operator-empty-state"><strong>Waiting for comparable evidence</strong><p>{comparisonState.reason || 'The selected alignment has no comparable observations.'}</p></div>}</div>
        </section>

        <section className="compare-summary">
          <header><h2>Comparison ledger</h2><span className="metric">{leadLabel}</span></header>
          <div className="compare-summary-head"><span>Metric</span><span>Release A</span><span>Release B</span><span>Difference</span></div>
          <div><span>View gain</span><span className="metric">+{gainA.toLocaleString()}</span><span className="metric">+{gainB.toLocaleString()}</span><span className={difference === 0 ? 'metric' : difference > 0 ? 'metric text-success' : 'metric text-destructive'}>{difference > 0 ? '+' : ''}{difference.toLocaleString()}</span></div>
          <div><span>30m velocity</span><span className="metric">{Number(selectedA?.velocity30m || 0).toFixed(1)} /min</span><span className="metric">{Number(selectedB?.velocity30m || 0).toFixed(1)} /min</span><span className="metric">{(Number(selectedB?.velocity30m || 0) - Number(selectedA?.velocity30m || 0)).toFixed(1)} /min</span></div>
          <div><span>Sample coverage</span><span className="metric">{rowsA.length} / {durationLabel(duration(rowsA))}</span><span className="metric">{rowsB.length} / {durationLabel(duration(rowsB))}</span><span>-</span></div>
        </section>
      </>}

      <DialogFooter className="compare-footer mx-0 mb-0"><span>All times in EAT</span><span>{alignmentDefinition.label} alignment</span></DialogFooter>
    </DialogContent>
  </Dialog>
}