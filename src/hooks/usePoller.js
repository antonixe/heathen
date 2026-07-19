import { useEffect, useMemo, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, addObservation, DEFAULT_SETTINGS, getAllSettings, recordPollEvent, setSetting } from '../db/db.js'
import { incrementQuota } from './useQuota.js'
import { usePollingLeader } from './usePollingLeader.js'
import { getAllVelocityWindows } from '../utils/velocity.js'
import { formatTimeEAT } from '../utils/time.js'
import { fetchYouTubeVideo } from '../utils/youtube.js'

let activeWorker = null
let activeApiKey = ''
const pendingRefreshes = new Map()

function notify(title, body) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body })
}

function settleRefresh(videoId, error, payload) {
  const pending = pendingRefreshes.get(videoId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingRefreshes.delete(videoId)
  if (error) pending.reject(error)
  else pending.resolve(payload)
}

async function fetchVideoNow(videoId) {
  if (!activeApiKey) throw new Error('YouTube API key is missing.')
  let data
  try {
    data = await fetchYouTubeVideo(videoId, activeApiKey)
  } catch (error) {
    const quotaUnits = Number(error.quotaUnits || 0)
    if (quotaUnits > 0) await incrementQuota(quotaUnits)
    await recordPollEvent({ type: 'manual_error', videoId, code: error.code ?? 'NETWORK', message: error.message, quotaUnits }).catch(() => {})
    throw error
  }
  const timestamp = Date.now()
  await addObservation(videoId, data.viewCount, timestamp, { likeCount: data.likeCount, commentCount: data.commentCount, publishedAt: data.publishedAt })
  await db.videos.where('videoId').equals(videoId).modify({
    title: data.title,
    channelName: data.channelName,
    thumbnailUrl: data.thumbnailUrl,
    publishedAt: data.publishedAt,
    lastLikeCount: data.likeCount,
    lastCommentCount: data.commentCount,
  })
  const used = await incrementQuota()
  await recordPollEvent({ type: 'manual_success', videoId, message: 'Manual refresh completed.', quotaUnits: 1, details: { viewCount: data.viewCount, likeCount: data.likeCount, commentCount: data.commentCount } }).catch(() => {})
  if (used >= 9500) await setSetting('pollingPaused', true)
  return { videoId, timestamp, viewCount: data.viewCount, likeCount: data.likeCount, commentCount: data.commentCount, publishedAt: data.publishedAt }
}

export function refreshNow(videoId) {
  if (!videoId) return Promise.reject(new Error('Missing video id.'))
  const existing = pendingRefreshes.get(videoId)
  if (existing) return existing.promise

  if (!activeWorker) {
    return Promise.race([
      fetchVideoNow(videoId),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Refresh timed out.')), 10000)),
    ])
  }

  const promise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRefreshes.delete(videoId)
      reject(new Error('Refresh timed out.'))
    }, 10000)
    pendingRefreshes.set(videoId, { promise: null, resolve, reject, timeout })
    activeWorker.postMessage({ type: 'POLL_NOW', videoId, apiKey: activeApiKey })
  })
  pendingRefreshes.get(videoId).promise = promise
  return promise
}

export function usePoller(videos, apiKey, paused, onToast) {
  const workerRef = useRef(null)
  const latestToast = useRef(onToast)
  const lastWorkerCommand = useRef(null)
  const quotaStopAnnounced = useRef(false)
  const settings = useLiveQuery(() => getAllSettings(), [], DEFAULT_SETTINGS)
  const lockEnabled = Boolean(apiKey && !paused)
  const isLeader = usePollingLeader(lockEnabled)
  const thresholdSurge = settings?.threshold_surge ?? DEFAULT_SETTINGS.threshold_surge
  const thresholdActive = settings?.threshold_active ?? DEFAULT_SETTINGS.threshold_active
  const thresholdSlow = settings?.threshold_slow ?? DEFAULT_SETTINGS.threshold_slow
  const adaptivePollingEnabled = settings?.adaptive_polling_enabled !== false
  const thresholds = useMemo(() => {
    const candidate = {
      surge: Number(thresholdSurge),
      active: Number(thresholdActive),
      slow: Number(thresholdSlow),
    }
    return candidate.surge > candidate.active && candidate.active > candidate.slow && candidate.slow >= 1
      ? candidate
      : {
          surge: DEFAULT_SETTINGS.threshold_surge,
          active: DEFAULT_SETTINGS.threshold_active,
          slow: DEFAULT_SETTINGS.threshold_slow,
        }
  }, [thresholdSurge, thresholdActive, thresholdSlow])

  useEffect(() => { latestToast.current = onToast }, [onToast])
  useEffect(() => { activeApiKey = apiKey || '' }, [apiKey])

  useEffect(() => {
    const worker = new Worker(new URL('../workers/poller.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker
    activeWorker = worker
    lastWorkerCommand.current = null
    const stopForQuota = async body => {
      await setSetting('pollingPaused', true)
      worker.postMessage({ type: 'STOP_ALL' })
      if (!quotaStopAnnounced.current) {
        quotaStopAnnounced.current = true
        latestToast.current?.('Quota paused', body)
      }
    }
    worker.onmessage = async event => {
      const message = event.data
      if (message.type === 'POLLING') {
        await db.videos.where('videoId').equals(message.videoId).modify(video => {
          if (video.pollState !== 'paused') video.pollState = 'polling'
        })
      }
      if (message.type === 'DATA') {
        const trackedVideo = await db.videos.where('videoId').equals(message.videoId).first()
        if (!trackedVideo) {
          settleRefresh(message.videoId, new Error('Track was removed before the refresh completed.'))
          return
        }
        const before = await db.datapoints.where('videoId').equals(message.videoId).reverse().limit(32).toArray()
        const prior = getAllVelocityWindows(before.reverse()).v30m
        const { crossed } = await addObservation(message.videoId, message.viewCount, message.timestamp, { likeCount: message.likeCount, commentCount: message.commentCount, publishedAt: message.publishedAt })
        const hasNextPoll = Number.isFinite(Number(message.nextPollInMs)) && Number(message.nextPollInMs) > 0
        const nextPollAt = hasNextPoll ? Date.now() + Number(message.nextPollInMs) : null
        await db.videos.where('videoId').equals(message.videoId).modify(video => {
          video.title = message.title
          video.channelName = message.channelName
          video.thumbnailUrl = message.thumbnailUrl
          video.publishedAt = message.publishedAt ?? video.publishedAt ?? null
          video.lastLikeCount = message.likeCount ?? video.lastLikeCount ?? null
          video.lastCommentCount = message.commentCount ?? video.lastCommentCount ?? null
          video.currentTier = message.currentTier
          video.currentIntervalMs = message.currentIntervalMs ?? null
          if (video.pollState !== 'paused') video.pollState = 'idle'
          if (message.lastVelocity !== null && message.lastVelocity !== undefined) video.lastVelocity = message.lastVelocity
          if (hasNextPoll) video.nextPollAt = nextPollAt
          else if (message.currentTier === 'MANUAL') video.nextPollAt = null
          video.poll_mode ??= 'adaptive'
          video.fixed_interval_ms ??= null
        })
        const used = await incrementQuota()
        await recordPollEvent({ type: 'poll_success', videoId: message.videoId, message: 'Poll completed.', quotaUnits: 1, details: { viewCount: message.viewCount, likeCount: message.likeCount, commentCount: message.commentCount, tier: message.currentTier } }).catch(() => {})
        const video = await db.videos.where('videoId').equals(message.videoId).first()
        const recent = await db.datapoints.where('videoId').equals(message.videoId).reverse().limit(32).toArray()
        const current = getAllVelocityWindows(recent.reverse()).v30m
        if (prior > 0 && current !== null) {
          const change = (current - prior) / prior
          if (change <= -0.4 || change >= 0.8) {
            const text = `${video?.customLabel || video?.title || message.videoId}: ${prior.toFixed(1)} to ${current.toFixed(1)} v/min`
            latestToast.current?.(change < 0 ? 'Velocity cliff' : 'Velocity surge', text)
            notify(change < 0 ? 'Velocity cliff' : 'Velocity surge', text)
          }
        }
        crossed.forEach(row => {
          const text = `${video?.customLabel || video?.title || message.videoId} hit ${row.targetCount.toLocaleString()} at ${formatTimeEAT(message.timestamp)} EAT`
          latestToast.current?.('Milestone crossed', text)
          notify('Milestone crossed', text)
        })
        if (used === 8000) latestToast.current?.('Quota warning', 'YouTube quota reached 80%.')
        if (used >= 9500) await stopForQuota('Polling paused near the daily YouTube API quota limit.')
        settleRefresh(message.videoId, null, message)
      }
      if (message.type === 'ERROR') {
        const quotaUnits = Number(message.quotaUnits || 0)
        if (quotaUnits > 0) await incrementQuota(quotaUnits)
        const pollState = message.code === 404 ? 'not-found' : message.code === 'QUOTA' ? 'quota' : 'error'
        await db.videos.where('videoId').equals(message.videoId).modify({ pollState, errorCode: message.code, errorMessage: message.message })
        await recordPollEvent({ type: 'poll_error', videoId: message.videoId, code: message.code, message: message.message, quotaUnits }).catch(() => {})
        if (message.code === 'QUOTA') await stopForQuota('YouTube reported quota exhaustion. Polling is paused until you resume it.')
        else latestToast.current?.('Polling error', message.message)
        settleRefresh(message.videoId, new Error(message.message || 'Refresh failed.'))
      }
      if (message.type === 'QUOTA_WARNING') {
        await db.videos.where('videoId').equals(message.videoId).modify({ pollState: 'quota', errorCode: 'QUOTA', errorMessage: 'YouTube API quota exhausted.' })
        await recordPollEvent({ type: 'quota_pause', videoId: message.videoId, code: 'QUOTA', message: 'YouTube reported quota exhaustion.' }).catch(() => {})
        await stopForQuota('YouTube reported quota exhaustion. Polling is paused until you resume it.')
      }
      if (message.type === 'GAVE_UP') {
        const reason = message.message || 'Polling paused after repeated failed attempts.'
        await db.videos.where('videoId').equals(message.videoId).modify({ pollState: 'error', errorCode: 'GAVE_UP', errorMessage: reason })
        await recordPollEvent({ type: 'poll_gave_up', videoId: message.videoId, code: 'GAVE_UP', message: reason }).catch(() => {})
        latestToast.current?.('Polling stopped', reason)
        settleRefresh(message.videoId, new Error(reason))
      }
      if (message.type === 'SCHEDULED') {
        await db.videos.where('videoId').equals(message.videoId).modify(video => {
          video.nextPollAt = message.nextAt
          video.currentTier = message.currentTier
          video.currentIntervalMs = message.currentIntervalMs
          video.poll_mode ??= 'adaptive'
          video.fixed_interval_ms ??= null
        })
      }
    }
    return () => {
      if (activeWorker === worker) activeWorker = null
      worker.terminate()
    }
  }, [])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker) return
    worker.postMessage({ type: 'UPDATE_THRESHOLDS', thresholds, adaptivePollingEnabled })
  }, [thresholds, adaptivePollingEnabled])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker) return
    const config = (videos || []).filter(video => video.status === 'active' && video.pollState !== 'paused')
      .map(({ videoId, pollInterval, poll_mode, fixed_interval_ms, lastVelocity, lastViewCount, lastPolledAt, nextPollAt }) => ({ videoId, pollInterval, poll_mode, fixed_interval_ms, lastVelocity, lastViewCount, lastPolledAt, nextPollAt }))
    const stopped = !apiKey || paused || !isLeader
    // Every poll writes lastPolledAt/nextPollAt back to the DB, which re-fires this
    // effect. Only the scheduling-relevant fields belong in the change signature, so
    // the worker is not restarted by its own observations.
    const command = stopped ? 'STOP_ALL' : JSON.stringify({
      apiKey,
      thresholds,
      adaptivePollingEnabled,
      jobs: config.map(({ videoId, pollInterval, poll_mode, fixed_interval_ms }) => [videoId, pollInterval, poll_mode, fixed_interval_ms]),
    })
    if (command === lastWorkerCommand.current) return
    lastWorkerCommand.current = command
    if (stopped) worker.postMessage({ type: 'STOP_ALL' })
    else worker.postMessage({ type: 'START', videos: config, apiKey, thresholds, adaptivePollingEnabled })
  }, [videos, apiKey, paused, isLeader, thresholds, adaptivePollingEnabled])

  return { isLeader, lockActive: lockEnabled && !isLeader }
}
