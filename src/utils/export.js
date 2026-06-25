import { detectBatchFlush } from './velocity.js'

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`

export function videoToCsv(points, notes = []) {
  const flagged = new Set(detectBatchFlush(points))
  const noteMap = new Map(notes.map(note => [note.timestamp, note.body]))
  const rows = points.map((point, index) => [
    new Date(point.timestamp).toISOString(), point.timestamp, point.viewCount, point.delta,
    point.velocityPerMin ?? '', flagged.has(index), noteMap.get(point.timestamp) ?? '',
  ])
  return [['timestamp_iso', 'timestamp_unix', 'view_count', 'delta', 'velocity_per_min', 'is_batch_flush', 'session_notes'], ...rows]
    .map(row => row.map(csvCell).join(',')).join('\n')
}

export function downloadFile(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
