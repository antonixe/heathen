import { detectBatchFlush } from './velocity.js'
import { formatTimeEAT } from './time.js'

const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`
const pad = value => String(value).padStart(2, '0')

function timestampEAT(timestampMs) {
  const timestamp = Number(timestampMs)
  if (!Number.isFinite(timestamp)) return ''
  const eat = new Date(timestamp + 3 * 60 * 60 * 1000)
  return `${eat.getUTCFullYear()}-${pad(eat.getUTCMonth() + 1)}-${pad(eat.getUTCDate())} ${formatTimeEAT(timestamp)}:${pad(eat.getUTCSeconds())}`
}

export function videoToCsv(points, notes = []) {
  const flagged = new Set(detectBatchFlush(points))
  const noteMap = new Map(notes.map(note => [note.timestamp, note.body]))
  const rows = points.map((point, index) => [
    timestampEAT(point.timestamp), point.timestamp, point.viewCount, point.delta,
    point.velocityPerMin ?? '', point.likeCount ?? '', point.likeDelta ?? '', point.likeVelocityPerMin ?? '',
    point.commentCount ?? '', point.commentDelta ?? '', point.commentVelocityPerMin ?? '',
    flagged.has(index), noteMap.get(point.timestamp) ?? '',
  ])
  return [
    `# YouTube View Velocity Tracker export`,
    `# Timestamps are in East Africa Time (UTC+3)`,
    `# Generated: ${timestampEAT(Date.now())}`,
    ['timestamp_eat', 'timestamp_unix', 'view_count', 'delta', 'velocity_per_min', 'like_count', 'like_delta', 'like_velocity_per_min', 'comment_count', 'comment_delta', 'comment_velocity_per_min', 'is_batch_flush', 'session_notes'].map(csvCell).join(','),
    ...rows.map(row => row.map(csvCell).join(',')),
  ].join('\n')
}

export function downloadFile(name, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = Object.assign(document.createElement('a'), { href: url, download: name })
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
