const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

export function extractVideoId(value) {
  const input = String(value ?? '').trim()
  if (VIDEO_ID.test(input)) return input
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    let candidate = null
    if (host === 'youtu.be') candidate = url.pathname.split('/').filter(Boolean)[0]
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      candidate = url.searchParams.get('v')
      if (!candidate) {
        const [kind, id] = url.pathname.split('/').filter(Boolean)
        if (['shorts', 'live', 'embed'].includes(kind)) candidate = id
      }
    }
    return VIDEO_ID.test(candidate ?? '') ? candidate : null
  } catch { return null }
}

export function parseVideoLines(text, limit = 10) {
  return String(text ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean).slice(0, limit)
    .map(value => ({ value, videoId: extractVideoId(value), valid: Boolean(extractVideoId(value)) }))
}

// videos.list takes up to 50 ids per call and still costs a single quota unit, so polling the
// whole roster in one request is what makes a 5-minute server-side schedule affordable:
// 288 units a day whatever the track count, rather than 288 per track.
export const MAX_IDS_PER_CALL = 50

const mapItem = item => ({
  videoId: item.id,
  title: item.snippet?.title || item.id,
  channelName: item.snippet?.channelTitle || 'Unknown channel',
  thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
  viewCount: Number(item.statistics?.viewCount || 0),
})

const chunk = (items, size) => {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

// Resolves to a Map of videoId -> data, holding only the ids YouTube returned. Absent ids are
// deleted or private; the caller decides what that means rather than this throwing for the batch.
export async function fetchYouTubeVideos(videoIds, apiKey, options = {}) {
  if (!apiKey) throw Object.assign(new Error('API key is required.'), { code: 'NO_KEY' })
  const { signal, fetch: fetchImpl = fetch } = options
  const found = new Map()

  for (const batch of chunk([...new Set(videoIds)], MAX_IDS_PER_CALL)) {
    if (!batch.length) continue
    const params = new URLSearchParams({ part: 'statistics,snippet', id: batch.join(','), key: apiKey })
    let response
    try { response = await fetchImpl(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal }) }
    catch (cause) { throw Object.assign(new Error('Network request failed.'), { code: 'NETWORK', cause }) }
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const reason = body?.error?.errors?.[0]?.reason
      const code = response.status === 403 ? (reason === 'quotaExceeded' ? 'QUOTA' : 'FORBIDDEN') : response.status
      throw Object.assign(new Error(body?.error?.message || `YouTube API returned ${response.status}.`), { code })
    }
    for (const item of body.items || []) found.set(item.id, mapItem(item))
  }
  return found
}

export async function fetchYouTubeVideo(videoId, apiKey, signal) {
  const found = await fetchYouTubeVideos([videoId], apiKey, { signal })
  const data = found.get(videoId)
  if (!data) throw Object.assign(new Error('Video not found or unavailable.'), { code: 404 })
  return data
}
