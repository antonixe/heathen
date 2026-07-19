const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const numeric = value => Number.isFinite(Number(value)) ? Number(value) : null
const timestampFromIso = value => {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : null
}

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

export function parseYouTubeItem(videoId, item = {}) {
  return {
    videoId,
    title: item.snippet?.title || videoId,
    channelName: item.snippet?.channelTitle || 'Unknown channel',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
    publishedAt: timestampFromIso(item.snippet?.publishedAt),
    viewCount: numeric(item.statistics?.viewCount) ?? 0,
    likeCount: numeric(item.statistics?.likeCount),
    commentCount: numeric(item.statistics?.commentCount),
  }
}

export async function fetchYouTubeVideo(videoId, apiKey, signal) {
  if (!apiKey) throw Object.assign(new Error('API key is required.'), { code: 'NO_KEY', quotaUnits: 0 })
  const params = new URLSearchParams({ part: 'statistics,snippet', id: videoId, key: apiKey })
  let response
  try { response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal }) }
  catch (cause) { throw Object.assign(new Error('Network request failed.'), { code: 'NETWORK', cause, quotaUnits: 0 }) }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason = body?.error?.errors?.[0]?.reason
    const code = response.status === 403 ? (reason === 'quotaExceeded' ? 'QUOTA' : 'FORBIDDEN') : response.status
    throw Object.assign(new Error(body?.error?.message || `YouTube API returned ${response.status}.`), { code, quotaUnits: 1 })
  }
  if (!body.items?.length) throw Object.assign(new Error('Video not found or unavailable.'), { code: 404, quotaUnits: 1 })
  return parseYouTubeItem(videoId, body.items[0])
}
export async function testYouTubeApiKey(apiKey, fetchImpl = globalThis.fetch) {
  const key = String(apiKey || '').trim()
  if (!key) throw Object.assign(new Error('Enter an API key before testing it.'), { code: 'NO_KEY', quotaUnits: 0 })
  const params = new URLSearchParams({ part: 'id', chart: 'mostPopular', maxResults: '1', regionCode: 'KE', key })
  let response
  try {
    response = await fetchImpl('https://www.googleapis.com/youtube/v3/videos?' + params)
  } catch (cause) {
    throw Object.assign(new Error('Network request failed while testing the API key.'), { code: 'NETWORK', cause, quotaUnits: 0 })
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason = body?.error?.errors?.[0]?.reason
    const code = response.status === 403 ? (reason === 'quotaExceeded' ? 'QUOTA' : 'FORBIDDEN') : response.status
    throw Object.assign(new Error(body?.error?.message || 'YouTube API returned ' + response.status + '.'), { code, quotaUnits: 1 })
  }
  return { valid: true, quotaUnits: 1 }
}