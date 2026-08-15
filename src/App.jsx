import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, getAllSettings, setSetting } from './db/db.js'
import { usePoller } from './hooks/usePoller.js'
import { useKeyboard } from './hooks/useKeyboard.js'
import Dashboard from './components/Dashboard/Dashboard.jsx'
import AddVideoModal from './components/AddVideo/AddVideoModal.jsx'
import SettingsPanel from './components/Settings/SettingsPanel.jsx'
import TopBar from './components/TopBar/TopBar.jsx'
import ToastStack from './components/shared/Toast.jsx'

const VideoDetail = lazy(() => import('./components/VideoDetail/VideoDetail.jsx'))
const Watchlist = lazy(() => import('./components/Watchlist/Watchlist.jsx'))
const CompareView = lazy(() => import('./components/CompareView/CompareView.jsx'))

const loading = <div className="loading-fallback" role="status">Loading…</div>

export default function App() {
  const videos = useLiveQuery(() => db.videos.orderBy('addedAt').reverse().toArray(), [], [])
  const settings = useLiveQuery(() => getAllSettings(), [], DEFAULT_SETTINGS)
  const [view, setView] = useState(null), [addOpen, setAddOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false)
  const [watchOpen, setWatchOpen] = useState(false), [compareVideo, setCompareVideo] = useState(null), [toasts, setToasts] = useState([])
  const toast = useCallback((title, body, tone) => {
    const id = crypto.randomUUID()
    setToasts(items => [...items.slice(-2), { id, title, body, tone }])
    // bad news and milestones are worth reading twice; routine confirmations are not
    setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), tone === 'down' || tone === 'hit' ? 9000 : 5000)
  }, [])
  const pollNow = usePoller(videos, settings.apiKey, settings.pollingPaused, toast)
  const closeLayers = useCallback(() => { setAddOpen(false); setSettingsOpen(false); setWatchOpen(false); setCompareVideo(null) }, [])
  const active = videos.filter(video => video.status === 'active')
  // nothing to refresh without a key, while paused, or with an empty board
  const canRefresh = Boolean(settings.apiKey) && !settings.pollingPaused && active.length > 0
  const refresh = useCallback(() => {
    if (!canRefresh) return
    pollNow()
    toast('Refreshing', `${active.length} track${active.length === 1 ? '' : 's'} queued for an immediate poll.`)
  }, [canRefresh, pollNow, active.length, toast])
  // Each tile already derives these from history only it has loaded, so it reports them up rather
  // than the bar re-querying every video. Scalars, so the equality guard stays cheap and loop-free.
  const [vitals, setVitals] = useState({})
  const reportVitals = useCallback((videoId, next) => {
    setVitals(previous => {
      const current = previous[videoId]
      if (current && current.eta === next.eta && current.velocity === next.velocity && current.risk === next.risk) return previous
      return { ...previous, [videoId]: next }
    })
  }, [])
  const roster = useMemo(() => {
    const tracked = new Set(active.map(video => video.videoId))
    let velocity = 0, risk = 0
    for (const [videoId, vital] of Object.entries(vitals)) {
      if (!tracked.has(videoId)) continue
      velocity += vital.velocity || 0
      if (vital.risk) risk += 1
    }
    const upcoming = active.map(video => video.nextPollAt).filter(Boolean).sort((a, b) => a - b)
    return { count: active.length, velocity, risk, nextAt: upcoming[0] ?? null }
  }, [active, vitals])

  const handlers = useMemo(() => ({
    a: () => setAddOpen(true), s: () => setSettingsOpen(true), w: () => setWatchOpen(true), c: () => setCompareVideo({}),
    r: refresh, p: () => setSetting('pollingPaused', !settings.pollingPaused), escape: view ? () => setView(null) : closeLayers,
  }), [settings.pollingPaused, closeLayers, view, refresh])
  useKeyboard(handlers)
  const openDetail = video => { closeLayers(); setView(video) }
  if (view) {
    const current = videos.find(video => video.id === view.id) || view
    return <><Suspense fallback={loading}><VideoDetail video={current} onClose={() => setView(null)} /></Suspense><ToastStack toasts={toasts} dismiss={id => setToasts(items => items.filter(item => item.id !== id))} /></>
  }
  return <div className="app-shell">
    <TopBar roster={roster} paused={settings.pollingPaused} live={Boolean(settings.apiKey)}
      onAdd={() => setAddOpen(true)} onRefresh={refresh} canRefresh={canRefresh}
      onWatchlist={() => setWatchOpen(true)} onSettings={() => setSettingsOpen(true)} />
    <button className="mobile-track-fab" onClick={() => setAddOpen(true)} aria-label="Track a video">+</button>
    {!settings.apiKey && <div className="system-banner"><span>API KEY MISSING</span><p>Polling is stopped until a YouTube Data API key is saved.</p><button onClick={() => setSettingsOpen(true)}>Open settings</button></div>}
    {settings.pollingPaused && <div className="system-banner paused"><span>POLLING PAUSED</span><p>All worker timers are stopped.</p><button onClick={() => setSetting('pollingPaused', false)}>Resume</button></div>}
    <Dashboard videos={active} vitals={vitals} onVitals={reportVitals} onAdd={() => setAddOpen(true)} onOpen={openDetail} onCompare={setCompareVideo} />
    {addOpen && <AddVideoModal apiKey={settings.apiKey} defaultInterval={settings.defaultPollInterval} videos={videos} onClose={() => setAddOpen(false)} onSettings={() => { setAddOpen(false); setSettingsOpen(true) }} onToast={toast} />}
    {settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} onToast={toast} />}
    {watchOpen && <Suspense fallback={loading}><Watchlist videos={videos} onClose={() => setWatchOpen(false)} onOpen={openDetail} /></Suspense>}
    {compareVideo !== null && <Suspense fallback={loading}><CompareView videos={videos} initial={compareVideo?.videoId ? compareVideo : null} onClose={() => setCompareVideo(null)} /></Suspense>}
    <ToastStack toasts={toasts} dismiss={id => setToasts(items => items.filter(item => item.id !== id))} />
  </div>
}
