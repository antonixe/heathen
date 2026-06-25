import { useMemo } from 'react'
import './HeatmapGrid.css'

const DAY_MS = 24 * 60 * 60 * 1000
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)

const dateKey = timestamp => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const dateFromKey = key => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day, 12)
}

export default function HeatmapGrid({ datapoints = [] }) {
  const heatmap = useMemo(() => {
    const valid = datapoints
      .filter(point => Number.isFinite(Number(point.timestamp)))
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp)
    const spansDay = valid.length > 1 && valid.at(-1).timestamp - valid[0].timestamp >= DAY_MS
    const dates = [...new Set(valid.map(point => dateKey(point.timestamp)))]
    const buckets = new Map()

    valid.forEach(point => {
      const velocity = Number(point.velocityPerMin)
      if (!Number.isFinite(velocity)) return
      const hour = new Date(point.timestamp).getHours()
      const key = `${dateKey(point.timestamp)}-${hour}`
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
    return { spansDay, dates, cells, peak }
  }, [datapoints])

  if (!heatmap.spansDay) return <section className="heatmap-section"><header><span className="eyebrow">HOURLY VELOCITY PATTERN</span></header><div className="heatmap-placeholder">Need 24h of data for heatmap</div></section>

  return <section className="heatmap-section"><header><span className="eyebrow">HOURLY VELOCITY PATTERN</span><span className="heatmap-peak">PEAK {heatmap.peak.toFixed(1)} V/MIN</span></header><div className="heatmap-scroll"><div className="heatmap-grid" role="grid" aria-label="Average hourly velocity by tracked date">
    <span className="heatmap-corner" aria-hidden="true" />
    {HOURS.map(hour => <span className="heatmap-hour" key={`hour-${hour}`}>{hour % 3 === 0 ? hour : ''}</span>)}
    {heatmap.dates.map(date => {
      const dateObject = dateFromKey(date)
      const rowLabel = dateObject.toLocaleDateString([], { month: 'short', day: 'numeric' })
      const weekday = dateObject.toLocaleDateString([], { weekday: 'short' })
      return [<span className="heatmap-date" key={`${date}-label`}>{rowLabel}</span>, ...HOURS.map(hour => {
        const cell = heatmap.cells.get(`${date}-${hour}`)
        const intensity = cell && heatmap.peak > 0 ? Math.max(0, Math.min(1, cell.average / heatmap.peak)) : 0
        const tooltip = cell ? `${weekday} ${String(hour).padStart(2, '0')}:00 — avg ${cell.average.toFixed(1)} v/min (${cell.count} session${cell.count === 1 ? '' : 's'})` : `${weekday} ${String(hour).padStart(2, '0')}:00 — no samples`
        return <span className="heatmap-cell" style={{ '--heat-opacity': intensity }} tabIndex={cell ? 0 : -1} role="gridcell" aria-label={tooltip} key={`${date}-${hour}`}><span className="heatmap-tooltip" role="tooltip">{tooltip}</span></span>
      })]
    })}
  </div></div></section>
}
