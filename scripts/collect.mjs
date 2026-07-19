// Polls YouTube for every id in the data branch's watchlist.json (pushed by
// the app via src/utils/watchlistSync.js) and appends snapshots to
// _data/snapshots.json (the data branch worktree). Run by .github/workflows/collect.yml.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const SNAPSHOT_FILE = '_data/snapshots.json'
const WATCHLIST_FILE = '_data/watchlist.json'

const apiKey = process.env.YOUTUBE_API_KEY
if (!apiKey) {
  console.error('YOUTUBE_API_KEY is not set.')
  process.exit(1)
}

const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null
const ids = existsSync(WATCHLIST_FILE)
  ? [...new Set(JSON.parse(readFileSync(WATCHLIST_FILE, 'utf8')))].filter(id => /^[A-Za-z0-9_-]{11}$/.test(String(id)))
  : []

if (!ids.length) {
  console.log('No watchlist on the data branch yet; nothing to collect.')
  process.exit(0)
}

const snapshots = existsSync(SNAPSHOT_FILE) ? JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) : []
const timestamp = Date.now()

for (let i = 0; i < ids.length; i += 50) {
  const params = new URLSearchParams({ part: 'statistics', id: ids.slice(i, i + 50).join(','), key: apiKey })
  const response = await fetch('https://www.googleapis.com/youtube/v3/videos?' + params)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    console.error(body?.error?.message || 'YouTube API returned ' + response.status + '.')
    process.exit(1)
  }
  for (const item of body.items ?? []) {
    snapshots.push({
      videoId: item.id,
      timestamp,
      viewCount: numeric(item.statistics?.viewCount) ?? 0,
      likeCount: numeric(item.statistics?.likeCount),
      commentCount: numeric(item.statistics?.commentCount),
    })
  }
}

const kept = snapshots.filter(row => Number(row.timestamp) >= timestamp - RETENTION_MS)
writeFileSync(SNAPSHOT_FILE, JSON.stringify(kept))
console.log(`Collected ${ids.length} video(s); ${kept.length} snapshots retained.`)
