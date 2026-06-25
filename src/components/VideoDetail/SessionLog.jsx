import { detectBatchFlush } from '../../utils/velocity.js'
import { downloadFile, videoToCsv } from '../../utils/export.js'

export default function SessionLog({ video, points, notes }) {
  const flagged = new Set(detectBatchFlush(points))
  const exportCsv = () => downloadFile(`${video.videoId}.csv`, videoToCsv(points, notes), 'text/csv')
  return <section className="detail-section session-section"><header><h3>LOG</h3><span>{points.length.toLocaleString()} samples</span></header><div className="table-scroll"><table><thead><tr><th>TIME</th><th>VIEWS</th><th>Δ</th><th>V/MIN</th><th>FLAG</th></tr></thead><tbody>{points.slice(-500).reverse().map((point, reverseIndex) => { const index = points.length - 1 - reverseIndex; return <tr key={point.id || point.timestamp}><td>{new Date(point.timestamp).toLocaleString()}</td><td>{point.viewCount.toLocaleString()}</td><td>{point.delta?.toLocaleString() ?? '—'}</td><td>{point.velocityPerMin?.toFixed(2) ?? '—'}</td><td>{flagged.has(index) ? <span className="batch">BATCH</span> : ''}</td></tr> })}</tbody></table></div>{points.length > 500 && <p className="help">Showing latest 500 rows. Export includes all observations.</p>}<button className="export-link" onClick={exportCsv}>Export CSV</button></section>
}
