import { fetchYouTubeVideo } from '../utils/youtube.js'

const jobs = new Map()
const backoffs = [5000, 15000, 45000, 120000, 120000]
let apiKey = ''

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
  try {
    const data = await fetchYouTubeVideo(videoId, apiKey)
    job.attempt = 0
    postMessage({ type: 'DATA', timestamp: Date.now(), ...data })
    schedule(videoId, job.pollInterval * 1000)
  } catch (error) {
    const code = error.code ?? 'NETWORK'
    postMessage({ type: 'ERROR', videoId, code, message: error.message || 'Polling failed.' })
    if (code === 403 || code === 'FORBIDDEN' || code === 'QUOTA' || code === 404 || code === 'NO_KEY') clearJob(videoId)
    else if (job.attempt < backoffs.length) schedule(videoId, backoffs[job.attempt++])
    else job.paused = true
  }
}

function upsertVideos(videos) {
  const wanted = new Set(videos.map(video => video.videoId))
  for (const id of jobs.keys()) if (!wanted.has(id)) clearJob(id)
  videos.forEach((video, index) => {
    const existing = jobs.get(video.videoId)
    if (existing) { existing.pollInterval = Number(video.pollInterval) || 60; return }
    jobs.set(video.videoId, { videoId: video.videoId, pollInterval: Number(video.pollInterval) || 60, timer: null, attempt: 0, paused: false })
    schedule(video.videoId, index * 2000)
  })
}

self.onmessage = event => {
  const message = event.data
  if (message.type === 'START') { apiKey = message.apiKey; upsertVideos(message.videos) }
  if (message.type === 'STOP_ALL') { for (const id of [...jobs.keys()]) clearJob(id) }
  // Manual refresh. Also the way back for a job that exhausted its backoff and parked itself,
  // so clear the attempt count and the paused flag before rescheduling.
  if (message.type === 'REFRESH_ALL') {
    [...jobs.keys()].forEach((videoId, index) => {
      const job = jobs.get(videoId)
      if (!job) return
      job.attempt = 0
      job.paused = false
      schedule(videoId, index * 120)
    })
  }
}
