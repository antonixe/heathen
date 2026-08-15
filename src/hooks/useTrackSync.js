import { useEffect, useRef } from 'react'

// Fields the Worker stores. Anything outside this list changing locally must not trigger a push,
// or every poll would re-send the whole roster.
const signature = video => JSON.stringify({
  videoId: video.videoId, title: video.title, channelName: video.channelName,
  thumbnailUrl: video.thumbnailUrl, customLabel: video.customLabel,
  tags: video.tags || [], status: video.status, pollInterval: video.pollInterval, addedAt: video.addedAt,
})

// Pushes the roster to the scheduled poller so it tracks whatever the app tracks. One direction
// only: samples still come back through the normal client poll for now.
export function useTrackSync(videos, url, token, onToast) {
  const pushed = useRef(new Map())          // videoId -> last signature sent
  const running = useRef(false)
  const latestToast = useRef(onToast)
  latestToast.current = onToast

  useEffect(() => {
    if (!url || !token || !videos?.length && !pushed.current.size) return
    if (running.current) return             // a push is already in flight; the next change re-runs it
    const base = url.trim().replace(/\/+$/, '')
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    let cancelled = false

    const push = async () => {
      running.current = true
      const failures = []
      try {
        const seen = new Set()
        for (const video of videos || []) {
          if (cancelled) return
          seen.add(video.videoId)
          const current = signature(video)
          if (pushed.current.get(video.videoId) === current) continue
          try {
            const response = await fetch(`${base}/tracks`, { method: 'POST', headers, body: current })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            pushed.current.set(video.videoId, current)
          } catch (error) { failures.push(`${video.videoId}: ${error.message}`) }
        }
        for (const videoId of [...pushed.current.keys()]) {
          if (cancelled || seen.has(videoId)) continue
          try {
            const response = await fetch(`${base}/tracks?videoId=${encodeURIComponent(videoId)}`, { method: 'DELETE', headers })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            pushed.current.delete(videoId)
          } catch (error) { failures.push(`${videoId}: ${error.message}`) }
        }
      } finally { running.current = false }
      // one toast for the batch rather than one per track, and only when something actually broke
      if (failures.length && !cancelled) {
        latestToast.current?.('Sync failed', `${failures.length} track${failures.length === 1 ? '' : 's'} not sent · ${failures[0]}`, 'down')
      }
    }

    push()
    return () => { cancelled = true }
  }, [videos, url, token])
}
