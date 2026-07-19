import { db, recordPollEvent } from '../db/db.js'

// Pushes the active watchlist to the data branch so the GitHub Actions
// collector (.github/workflows/collect.yml) knows what to poll while the
// browser is closed.
const CONTENTS_URL = 'https://api.github.com/repos/antonixe/heathen/contents/watchlist.json'
const BRANCH = 'data'
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function normalizeWatchlist(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(id => VIDEO_ID.test(String(id))))].sort()
}

const headers = token => ({
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
})

let lastPushed = null

export async function syncWatchlist(token) {
  if (!token) return 'skipped'
  // Read ids from the DB at sync time, not from React state, so a sync fired
  // before the live query settles can never push an incorrectly empty list.
  const videos = await db.videos.where('status').equals('active').toArray()
  const payload = JSON.stringify(normalizeWatchlist(videos.map(video => video.videoId)))
  if (payload === lastPushed) return 'unchanged'

  let sha
  const current = await fetch(CONTENTS_URL + '?ref=' + BRANCH, { headers: headers(token), cache: 'no-store' })
  if (current.ok) {
    const body = await current.json()
    sha = body.sha
    try {
      const remote = JSON.stringify(normalizeWatchlist(JSON.parse(atob(String(body.content).replace(/\n/g, '')))))
      if (remote === payload) {
        lastPushed = payload
        return 'unchanged'
      }
    } catch { /* malformed remote file gets rewritten below */ }
  } else if (current.status !== 404) {
    throw new Error('GitHub returned ' + current.status + ' reading the cloud watchlist.')
  }

  const response = await fetch(CONTENTS_URL, {
    method: 'PUT',
    headers: headers(token),
    body: JSON.stringify({ message: 'Watchlist: ' + JSON.parse(payload).length + ' video(s)', content: btoa(payload), branch: BRANCH, sha }),
  })
  // 404 here usually means the data branch does not exist yet (first cron run
  // creates it); conflicts mean another tab won. Both resolve on a later sync.
  if (!response.ok) throw new Error('GitHub returned ' + response.status + ' updating the cloud watchlist.')
  lastPushed = payload
  await recordPollEvent({ type: 'watchlist_sync', message: 'Cloud watchlist updated to ' + JSON.parse(payload).length + ' video(s).' }).catch(() => {})
  return 'updated'
}
