const jobs = new Map()
const backoffs = [5000, 15000, 45000, 120000, 120000]
let apiKey = ''
let stagger = 0

function clearJob(videoId) {
  const job = jobs.get(videoId)
  if (job?.timer) clearTimeout(job.timer)
  jobs.delete(videoId)
}

function schedule(videoId, delay) {
  const job = jobs.get(videoId)
  if (!job || job.paused) return
  clearTimeout(job.timer)
  job.nextAt = Date.now() + delay
  job.timer = setTimeout(() => poll(videoId), delay)
  postMessage({ type: 'SCHEDULED', videoId, nextAt: job.nextAt })
}

async function poll(videoId) {
  const job = jobs.get(videoId)
  if (!job || job.paused) return
  const params = new URLSearchParams({ part: 'statistics,snippet', id: videoId, key: apiKey })
  try {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`)
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      const reason = body?.error?.errors?.[0]?.reason
      const code = response.status === 403 ? (reason === 'quotaExceeded' ? 'QUOTA' : 'FORBIDDEN') : response.status
      throw Object.assign(new Error(body?.error?.message || `HTTP ${response.status}`), { code })
    }
    if (!body.items?.length) throw Object.assign(new Error('Video not found.'), { code: 404 })
    const item = body.items[0]
    job.attempt = 0
    postMessage({
      type: 'DATA', videoId, timestamp: Date.now(), viewCount: Number(item.statistics?.viewCount || 0),
      title: item.snippet?.title, channelName: item.snippet?.channelTitle,
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
    })
    schedule(videoId, job.pollInterval * 1000)
  } catch (error) {
    const code = error.code ?? 'NETWORK'
    postMessage({ type: 'ERROR', videoId, code, message: error.message || 'Polling failed.' })
    if (code === 403 || code === 'FORBIDDEN' || code === 'QUOTA') {
      clearJob(videoId)
      postMessage({ type: 'QUOTA_WARNING', videoId })
    } else if (code === 404) clearJob(videoId)
    else if (job.attempt < backoffs.length) schedule(videoId, backoffs[job.attempt++])
    else { job.paused = true; postMessage({ type: 'GAVE_UP', videoId }) }
  }
}

function upsertVideos(videos, initial = false) {
  const wanted = new Set(videos.map(video => video.videoId))
  for (const id of jobs.keys()) if (!wanted.has(id)) clearJob(id)
  videos.forEach((video, index) => {
    const existing = jobs.get(video.videoId)
    if (existing) { existing.pollInterval = Number(video.pollInterval) || 60; return }
    jobs.set(video.videoId, { videoId: video.videoId, pollInterval: Number(video.pollInterval) || 60, timer: null, attempt: 0, paused: false })
    schedule(video.videoId, initial ? (stagger++ + index) * 2000 : index * 2000)
  })
}

self.onmessage = event => {
  const message = event.data
  if (message.type === 'START') { apiKey = message.apiKey; stagger = 0; upsertVideos(message.videos, true) }
  if (message.type === 'UPDATE_CONFIG') upsertVideos(message.videos)
  if (message.type === 'STOP_ALL') { for (const id of [...jobs.keys()]) clearJob(id) }
  if (message.type === 'PAUSE') { const job = jobs.get(message.videoId); if (job) { job.paused = true; clearTimeout(job.timer) } }
  if (message.type === 'RESUME') { const job = jobs.get(message.videoId); if (job) { job.paused = false; job.attempt = 0; schedule(message.videoId, 0) } }
}
