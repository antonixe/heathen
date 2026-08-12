import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { detectBatchFlush } from '../../utils/velocity.js'
import { downloadFile, videoToCsv } from '../../utils/export.js'

const LIMIT = 500
const timeOf = ts => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const dayOf = ts => new Date(ts).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' })

export default function SessionLog({ video, points, notes }) {
  const [expanded, setExpanded] = useState(false)
  const dialog = useRef(null)
  // O(n²) over the whole history, and this re-renders on every poll
  const flagged = useMemo(() => new Set(detectBatchFlush(points)), [points])
  const rows = useMemo(() => points.slice(-LIMIT).reverse(), [points])
  const exportCsv = () => downloadFile(`${video.videoId}.csv`, videoToCsv(points, notes), 'text/csv')

  useEffect(() => { if (expanded) dialog.current?.showModal() }, [expanded])

  // the sidebar copy drops Δ to keep nine-figure counts intact at 300px; the popup has the room
  const table = wide => <table className={wide ? 'log-wide' : ''}>
    <thead><tr><th>TIME</th><th>VIEWS</th>{wide && <th>Δ</th>}<th>V/MIN</th></tr></thead>
    <tbody>{rows.map((point, i) => {
      const index = points.length - 1 - i
      const day = dayOf(point.timestamp)
      const newDay = i === 0 || day !== dayOf(rows[i - 1].timestamp)
      return <Fragment key={point.id || point.timestamp}>
        {newDay && <tr className="log-day"><td colSpan={wide ? 4 : 3}>{day}</td></tr>}
        <tr className={flagged.has(index) ? 'is-batch' : ''}
          title={`${point.delta >= 0 ? '+' : ''}${point.delta?.toLocaleString() ?? '—'} views${flagged.has(index) ? ' · batch flush' : ''}`}>
          <td>{timeOf(point.timestamp)}</td>
          <td>{point.viewCount.toLocaleString()}</td>
          {wide && <td>{point.delta?.toLocaleString() ?? '—'}</td>}
          <td>{point.velocityPerMin?.toFixed(1) ?? '—'}</td>
        </tr>
      </Fragment>
    })}</tbody>
  </table>

  return <section className="detail-section session-section">
    <header>
      <h3>LOG</h3>
      <span>{points.length.toLocaleString()} samples</span>
      <button className="plain" onClick={() => setExpanded(true)} aria-label="Expand log">⤢</button>
    </header>
    <div className="table-scroll">{table(false)}</div>
    {points.length > LIMIT && <p className="help">Showing the latest {LIMIT} rows. Export includes every observation.</p>}
    <button className="export-link" onClick={exportCsv}>Export CSV</button>

    {expanded && <dialog
      ref={dialog}
      className="log-dialog"
      onKeyDown={event => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); setExpanded(false) }}
    >
      <header>
        <h3>{video.customLabel || video.title || video.videoId}</h3>
        <span>{points.length.toLocaleString()} samples</span>
        <button className="plain close" onClick={() => setExpanded(false)}>ESC</button>
      </header>
      <div className="log-dialog-scroll">{table(true)}</div>
      <footer>
        {points.length > LIMIT && <span className="help">Latest {LIMIT} of {points.length.toLocaleString()}. Export includes every observation.</span>}
        <button className="export-link" onClick={exportCsv}>Export CSV</button>
      </footer>
    </dialog>}
  </section>
}
