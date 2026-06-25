import { useEffect, useRef } from 'react'
import { db, addObservation } from '../db/db.js'
import { incrementQuota } from './useQuota.js'
import { getAllVelocityWindows } from '../utils/velocity.js'

function notify(title, body) {
  if (Notification.permission === 'granted') new Notification(title, { body })
}

export function usePoller(videos, apiKey, paused, onToast) {
  const workerRef = useRef(null)
  const latestToast = useRef(onToast)
  latestToast.current = onToast

  useEffect(() => {
    const worker = new Worker(new URL('../workers/poller.worker.js', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = async event => {
      const message = event.data
      if (message.type === 'DATA') {
        const before = await db.datapoints.where('videoId').equals(message.videoId).reverse().limit(32).toArray()
        const prior = getAllVelocityWindows(before.reverse()).v30m
        const { crossed } = await addObservation(message.videoId, message.viewCount, message.timestamp)
        await db.videos.where('videoId').equals(message.videoId).modify({
          title: message.title, channelName: message.channelName, thumbnailUrl: message.thumbnailUrl,
        })
        const used = await incrementQuota()
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
          const text = `${video?.customLabel || video?.title || message.videoId} hit ${row.targetCount.toLocaleString()}`
          latestToast.current?.('Milestone crossed', text); notify('Milestone crossed', text)
        })
        if (used === 8000) latestToast.current?.('Quota warning', 'YouTube quota reached 80%.')
        if (used >= 9500) worker.postMessage({ type: 'STOP_ALL' })
      }
      if (message.type === 'ERROR') {
        await db.videos.where('videoId').equals(message.videoId).modify({ pollState: message.code === 404 ? 'not-found' : message.code === 'QUOTA' ? 'quota' : 'error', errorCode: message.code, errorMessage: message.message })
        latestToast.current?.('Polling error', message.message)
      }
      if (message.type === 'SCHEDULED') await db.videos.where('videoId').equals(message.videoId).modify({ nextPollAt: message.nextAt })
    }
    return () => worker.terminate()
  }, [])

  useEffect(() => {
    const worker = workerRef.current
    if (!worker) return
    const config = (videos || []).filter(video => video.status === 'active' && video.pollState !== 'paused')
      .map(({ videoId, pollInterval }) => ({ videoId, pollInterval }))
    if (!apiKey || paused) worker.postMessage({ type: 'STOP_ALL' })
    else worker.postMessage({ type: 'START', videos: config, apiKey })
  }, [videos, apiKey, paused])
}
