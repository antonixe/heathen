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

export async function fetchYouTubeVideo(videoId, apiKey, signal) {
  if (!apiKey) throw Object.assign(new Error('API key is required.'), { code: 'NO_KEY' })
  const params = new URLSearchParams({ part: 'statistics,snippet', id: videoId, key: apiKey })
  let response
  try { response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`, { signal }) }
  catch (cause) { throw Object.assign(new Error('Network request failed.'), { code: 'NETWORK', cause }) }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const reason = body?.error?.errors?.[0]?.reason
    const code = response.status === 403 ? (reason === 'quotaExceeded' ? 'QUOTA' : 'FORBIDDEN') : response.status
    throw Object.assign(new Error(body?.error?.message || `YouTube API returned ${response.status}.`), { code })
  }
  if (!body.items?.length) throw Object.assign(new Error('Video not found or unavailable.'), { code: 404 })
  const item = body.items[0]
  return {
    videoId, title: item.snippet?.title || videoId,
    channelName: item.snippet?.channelTitle || 'Unknown channel',
    thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
    viewCount: Number(item.statistics?.viewCount || 0),
  }
}
