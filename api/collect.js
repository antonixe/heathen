// Cloud collector: polls YouTube for the data branch's watchlist and appends
// snapshots to the data branch via the GitHub contents API. Triggered every
// ~10 minutes by an external cron (cron-job.org) hitting /api/collect with
// an Authorization: Bearer CRON_SECRET header. Replaces GitHub Actions cron.
const REPO = 'antonixe/heathen'
const BRANCH = 'data'
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000
// ponytail: row cap keeps snapshots.json under the contents API's 1 MB GET
// limit (~8000 rows ≈ 700 KB). Move to the git blobs API if more history is needed.
const MAX_ROWS = 8000

const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null

export function mergeSnapshots(existing, fresh, now = Date.now()) {
  const cutoff = now - RETENTION_MS
  return [...(Array.isArray(existing) ? existing : []), ...fresh]
    .filter(row => Number(row?.timestamp) >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-MAX_ROWS)
}

const gh = (path, init = {}) => fetch('https://api.github.com/repos/' + REPO + path, {
  ...init,
  headers: {
    Authorization: 'Bearer ' + process.env.GITHUB_TOKEN,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'velocity-desk-collector',
    ...init.headers,
  },
})

async function readJsonFile(name) {
  const response = await gh('/contents/' + name + '?ref=' + BRANCH)
  if (response.status === 404) return { sha: undefined, data: null }
  if (!response.ok) throw new Error('GitHub returned ' + response.status + ' reading ' + name + '.')
  const body = await response.json()
  return { sha: body.sha, data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) }
}

export default async function handler(req, res) {
  if (req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized.' })
  }
  try {
    const watchlist = await readJsonFile('watchlist.json')
    const ids = [...new Set(Array.isArray(watchlist.data) ? watchlist.data : [])]
      .filter(id => /^[A-Za-z0-9_-]{11}$/.test(String(id)))
    if (!ids.length) return res.status(200).json({ ok: true, collected: 0, note: 'Watchlist is empty.' })

    const timestamp = Date.now()
    const fresh = []
    for (let i = 0; i < ids.length; i += 50) {
      const params = new URLSearchParams({ part: 'statistics', id: ids.slice(i, i + 50).join(','), key: process.env.YOUTUBE_API_KEY })
      const response = await fetch('https://www.googleapis.com/youtube/v3/videos?' + params)
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error?.message || 'YouTube API returned ' + response.status + '.')
      for (const item of body.items ?? []) {
        fresh.push({
          videoId: item.id,
          timestamp,
          viewCount: numeric(item.statistics?.viewCount) ?? 0,
          likeCount: numeric(item.statistics?.likeCount),
          commentCount: numeric(item.statistics?.commentCount),
        })
      }
    }

    const snapshots = await readJsonFile('snapshots.json')
    const rows = mergeSnapshots(snapshots.data, fresh, timestamp)
    const put = await gh('/contents/snapshots.json', {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Snapshots ' + new Date(timestamp).toISOString(),
        content: Buffer.from(JSON.stringify(rows)).toString('base64'),
        branch: BRANCH,
        sha: snapshots.sha,
      }),
    })
    if (!put.ok) throw new Error('GitHub returned ' + put.status + ' writing snapshots.')
    return res.status(200).json({ ok: true, collected: ids.length, rows: rows.length })
  } catch (error) {
    return res.status(500).json({ error: error.message })
  }
}
