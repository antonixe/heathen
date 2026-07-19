import { useMemo } from 'react'
import { formatDateEAT, formatDateFullEAT, formatTimeEAT } from '../../utils/time.js'

const DAY_MS = 24 * 60 * 60 * 1000
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const hourEAT = timestamp => Number(formatTimeEAT(timestamp).slice(0, 2))

export default function HeatmapGrid({ datapoints = [] }) {
  const heatmap = useMemo(() => {
    const valid = datapoints
      .filter(point => Number.isFinite(Number(point.timestamp)))
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp)
    const spansDay = valid.length > 1 && valid.at(-1).timestamp - valid[0].timestamp >= DAY_MS
    const dates = [...new Set(valid.map(point => formatDateEAT(point.timestamp)))]
    const dateFull = new Map(valid.map(point => [formatDateEAT(point.timestamp), formatDateFullEAT(point.timestamp)]))
    const buckets = new Map()

    valid.forEach(point => {
      const velocity = Number(point.velocityPerMin)
      if (!Number.isFinite(velocity)) return
      const hour = hourEAT(point.timestamp)
      const key = `${formatDateEAT(point.timestamp)}-${hour}`
      const bucket = buckets.get(key) ?? { sum: 0, count: 0 }
      bucket.sum += velocity
      bucket.count += 1
      buckets.set(key, bucket)
    })

    const cells = new Map()
    let peak = 0
    buckets.forEach((bucket, key) => {
      const average = bucket.sum / bucket.count
      cells.set(key, { average, count: bucket.count })
      peak = Math.max(peak, average)
    })
    return { spansDay, dates, dateFull, cells, peak }
  }, [datapoints])

  if (!heatmap.spansDay) return <section className="evidence-surface heatmap-panel"><header className="evidence-panel-header"><div><h2>Hourly velocity</h2><p>Average views per minute by hour in EAT</p></div></header><div className="evidence-empty">Twenty-four hours of observations are needed.</div></section>

  return <section className="evidence-surface heatmap-panel"><header className="evidence-panel-header"><div><h2>Hourly velocity</h2><p>Average views per minute by hour in EAT</p></div><span className="evidence-header-metric metric">Peak {heatmap.peak.toFixed(1)} v/min</span></header><div className="overflow-x-auto pb-1"><div className="heatmap-grid" role="grid" aria-label="Average hourly velocity by tracked date in EAT">
    <span className="text-[10px] text-muted-foreground metric" aria-hidden="true" />
    {HOURS.map(hour => <span className="text-center text-[10px] text-muted-foreground metric" key={`hour-${hour}`}>{hour % 3 === 0 ? hour : ''}</span>)}
    {heatmap.dates.map(date => {
      const fullDate = heatmap.dateFull.get(date) || date
      return [<span className="truncate text-[10px] text-muted-foreground metric" key={`${date}-label`}>{date}</span>, ...HOURS.map(hour => {
        const cell = heatmap.cells.get(`${date}-${hour}`)
        const intensity = cell && heatmap.peak > 0 ? Math.max(0, Math.min(1, cell.average / heatmap.peak)) : 0
        const hourLabel = `${String(hour).padStart(2, '0')}:00 EAT`
        const tooltip = cell ? `${fullDate} ${hourLabel}: avg ${cell.average.toFixed(1)} v/min (${cell.count} session${cell.count === 1 ? '' : 's'})` : `${fullDate} ${hourLabel}: no samples`
        return <span className="heatmap-cell" style={{ '--heat-opacity': intensity }} tabIndex={cell ? 0 : -1} role="gridcell" aria-label={tooltip} key={`${date}-${hour}`}><span className="heatmap-tooltip" role="tooltip">{tooltip}</span></span>
      })]
    })}
  </div></div></section>
}
