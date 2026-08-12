import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS, getAllSettings, setSetting } from './db/db.js'
import { usePoller } from './hooks/usePoller.js'
import { useKeyboard } from './hooks/useKeyboard.js'
import Dashboard from './components/Dashboard/Dashboard.jsx'
import AddVideoModal from './components/AddVideo/AddVideoModal.jsx'
import SettingsPanel from './components/Settings/SettingsPanel.jsx'
import QuotaBar from './components/QuotaBar/QuotaBar.jsx'
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
    <header className="topbar"><div className="topbar-inner"><div className="brand"><b>VELOCITY</b><i aria-hidden="true" /><small>YT tracker</small></div><QuotaBar /><nav><button className="track-button primary" onClick={() => setAddOpen(true)}>+ Track <kbd>A</kbd></button><button className="top-icon" onClick={refresh} disabled={!canRefresh} aria-label="Refresh all tracks now"><span>R</span><em>Refresh</em></button><button className="top-icon" onClick={() => setWatchOpen(true)} aria-label="Open watchlist"><span>W</span><em>Watchlist</em></button><button className="top-icon settings-trigger" onClick={() => setSettingsOpen(true)} aria-label="Open settings"><span>S</span></button></nav></div></header>
    <button className="mobile-track-fab" onClick={() => setAddOpen(true)} aria-label="Track a video">+</button>
    {!settings.apiKey && <div className="system-banner"><span>API KEY MISSING</span><p>Polling is stopped until a YouTube Data API key is saved.</p><button onClick={() => setSettingsOpen(true)}>Open settings</button></div>}
    {settings.pollingPaused && <div className="system-banner paused"><span>POLLING PAUSED</span><p>All worker timers are stopped.</p><button onClick={() => setSetting('pollingPaused', false)}>Resume</button></div>}
    <Dashboard videos={active} onAdd={() => setAddOpen(true)} onOpen={openDetail} onCompare={setCompareVideo} />
    {addOpen && <AddVideoModal apiKey={settings.apiKey} defaultInterval={settings.defaultPollInterval} videos={videos} onClose={() => setAddOpen(false)} onSettings={() => { setAddOpen(false); setSettingsOpen(true) }} onToast={toast} />}
    {settingsOpen && <SettingsPanel settings={settings} onClose={() => setSettingsOpen(false)} onToast={toast} />}
    {watchOpen && <Suspense fallback={loading}><Watchlist videos={videos} onClose={() => setWatchOpen(false)} onOpen={openDetail} /></Suspense>}
    {compareVideo !== null && <Suspense fallback={loading}><CompareView videos={videos} initial={compareVideo?.videoId ? compareVideo : null} onClose={() => setCompareVideo(null)} /></Suspense>}
    <ToastStack toasts={toasts} dismiss={id => setToasts(items => items.filter(item => item.id !== id))} />
  </div>
}
