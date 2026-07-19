import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { BarChart3, GitCompare, Library, Moon, Play, Plus, Search, Settings, Sun, X } from 'lucide-react'
import { db, DEFAULT_SETTINGS, getAllSettings, rebuildAllVideoSummaries, setSetting } from './db/db.js'
import { usePoller } from './hooks/usePoller.js'
import { useKeyboard } from './hooks/useKeyboard.js'
import { useTheme } from './hooks/useTheme.js'
import { formatTimeEAT } from './utils/time.js'
import { buildProbabilityCalibration } from './utils/probability.js'
import { hasReleaseError } from './utils/releaseState.js'
import { getPollingGap } from './utils/pollingGap.js'
import { getStoragePersistenceStatus, requestStoragePersistence } from './utils/storagePersistence.js'
import { runBackfill } from './utils/backfill.js'
import { syncWatchlist } from './utils/watchlistSync.js'
import Dashboard from './components/Dashboard/Dashboard.jsx'
import AddVideoModal from './components/AddVideo/AddVideoModal.jsx'
import SettingsPanel from './components/Settings/SettingsPanel.jsx'
import QuotaBar from './components/QuotaBar/QuotaBar.jsx'
import ToastStack from './components/shared/Toast.jsx'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

const VideoDetail = lazy(() => import('./components/VideoDetail/VideoDetail.jsx'))
const Watchlist = lazy(() => import('./components/Watchlist/Watchlist.jsx'))
const CompareView = lazy(() => import('./components/CompareView/CompareView.jsx'))

const EMPTY_ADD_DRAFT = { text: '', label: '', tags: '', interval: '' }
const readAddDraft = () => {
  try { return { ...EMPTY_ADD_DRAFT, ...JSON.parse(sessionStorage.getItem('velocityDesk.addDraft') || '{}') } }
  catch { return { ...EMPTY_ADD_DRAFT } }
}

function LoadingFallback() {
  return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground metric" role="status">Loading...</div>
}

function RailAction({ icon: Icon, label, active, onClick }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon" className="utility-action" data-active={active || undefined} aria-label={label} aria-current={active ? 'page' : undefined} onClick={onClick}>
        <Icon className="size-4" aria-hidden="true" />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right">{label}</TooltipContent>
  </Tooltip>
}

export default function App() {
  const videos = useLiveQuery(() => db.videos.orderBy('addedAt').reverse().toArray(), [], [])
  const settings = useLiveQuery(() => getAllSettings(), [], DEFAULT_SETTINGS)
  const { resolved: resolvedTheme, setTheme } = useTheme()
  const resolvedSnapshots = useLiveQuery(
    () => db.predictionSnapshots.where('resolvedAt').above(0).reverse().limit(1000).toArray(),
    [],
    [],
  )
  const predictionCalibration = useMemo(() => buildProbabilityCalibration(resolvedSnapshots), [resolvedSnapshots])
  const [view, setView] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [watchOpen, setWatchOpen] = useState(false)
  const [compareVideo, setCompareVideo] = useState(null)
  const [toasts, setToasts] = useState([])
  const [filter, setFilter] = useState('all')
  const [clockNow, setClockNow] = useState(Date.now())
  const [commandQuery, setCommandQuery] = useState('')
  const [addDraft, setAddDraft] = useState(readAddDraft)
  const [resumeAddAfterSettings, setResumeAddAfterSettings] = useState(false)
  const [settingsInitialSection, setSettingsInitialSection] = useState('api')
  const [storageStatus, setStorageStatus] = useState('checking')
  const [backfilled, setBackfilled] = useState(false)
  const summaryRebuildStarted = useRef(false)
  const searchInput = useRef(null)

  const toast = useCallback((title, body) => {
    const id = crypto.randomUUID()
    setToasts(items => [...items.slice(-2), { id, title, body }])
    setTimeout(() => setToasts(items => items.filter(item => item.id !== id)), 5000)
  }, [])

  // Polling stays off until cloud snapshots are replayed, so live polls never
  // land in the datapoint log ahead of older backfilled observations.
  const poller = usePoller(videos, settings.apiKey, settings.pollingPaused || !backfilled, toast)

  useEffect(() => {
    runBackfill()
      .then(count => { if (count) toast('Cloud backfill', `Merged ${count} samples collected while the app was closed.`) })
      .finally(() => setBackfilled(true))
  }, [toast])

  // Keep the cloud collector's watchlist in step with what is tracked here.
  // syncWatchlist reads ids from the DB and no-ops when nothing changed, so
  // firing on every videos emission is cheap.
  useEffect(() => {
    if (!settings.githubToken) return
    const timer = setTimeout(() => syncWatchlist(settings.githubToken).catch(() => {}), 3000)
    return () => clearTimeout(timer)
  }, [videos, settings.githubToken])

  useEffect(() => {
    const timer = setInterval(() => setClockNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    getStoragePersistenceStatus().then(setStorageStatus)
  }, [])

  useEffect(() => {
    try {
      const hasDraft = Object.values(addDraft).some(Boolean)
      if (hasDraft) sessionStorage.setItem('velocityDesk.addDraft', JSON.stringify(addDraft))
      else sessionStorage.removeItem('velocityDesk.addDraft')
    } catch {}
  }, [addDraft])

  useEffect(() => {
    if (summaryRebuildStarted.current) return
    if (!videos.some(video => video.lastPolledAt && !video.summaryUpdatedAt)) return
    summaryRebuildStarted.current = true
    rebuildAllVideoSummaries().catch(() => {})
  }, [videos])

  const closeLayers = useCallback(() => {
    setAddOpen(false)
    setSettingsOpen(false)
    setWatchOpen(false)
    setCompareVideo(null)
  }, [])

  const openAdd = useCallback(() => { closeLayers(); setResumeAddAfterSettings(false); setAddOpen(true) }, [closeLayers])
  const closeAdd = useCallback(() => { setAddOpen(false); setAddDraft({ ...EMPTY_ADD_DRAFT }) }, [])
  const openSettings = useCallback(() => { closeLayers(); setResumeAddAfterSettings(false); setSettingsInitialSection('api'); setSettingsOpen(true) }, [closeLayers])
  const openDataSettings = useCallback(() => { closeLayers(); setResumeAddAfterSettings(false); setSettingsInitialSection('data'); setSettingsOpen(true) }, [closeLayers])
  const openSettingsForAdd = useCallback(() => { closeLayers(); setResumeAddAfterSettings(true); setSettingsInitialSection('api'); setSettingsOpen(true) }, [closeLayers])
  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    if (resumeAddAfterSettings) setAddOpen(true)
    setResumeAddAfterSettings(false)
  }, [resumeAddAfterSettings])
  const openWatchlist = useCallback(() => { closeLayers(); setWatchOpen(true) }, [closeLayers])
  const openCompare = useCallback(initial => { closeLayers(); setCompareVideo(initial?.videoId ? initial : {}) }, [closeLayers])

  const protectStorage = useCallback(async () => {
    const result = await requestStoragePersistence()
    setStorageStatus(result)
    toast(result === 'persistent' ? 'Local storage protected' : 'Persistent storage not granted', result === 'persistent' ? 'The browser has agreed not to evict Velocity Desk data automatically.' : 'Keep regular backups because this browser may still clear local data.')
    return result
  }, [toast])

  const handlers = useMemo(() => ({
    a: openAdd,
    s: openSettings,
    w: openWatchlist,
    c: openCompare,
    p: () => setSetting('pollingPaused', !settings.pollingPaused),
    '/': () => searchInput.current?.focus(),
    escape: view ? () => setView(null) : settingsOpen ? closeSettings : addOpen ? closeAdd : closeLayers,
  }), [settings.pollingPaused, closeLayers, closeAdd, closeSettings, openAdd, openSettings, openWatchlist, openCompare, addOpen, settingsOpen, view])

  useKeyboard(handlers)

  const active = videos.filter(video => video.status === 'active')
  const pollingGaps = active.filter(video => getPollingGap(video, clockNow))
  const issueCount = active.filter(hasReleaseError).length
  const backupReminderMs = Number(settings.backupReminderDays || 7) * 24 * 60 * 60 * 1000
  const backupDue = videos.length > 0 && (!settings.lastBackupAt || Date.now() - Number(settings.lastBackupAt) > backupReminderMs)
  const storageNeedsProtection = videos.length > 0 && (storageStatus === 'available' || storageStatus === 'denied')
  const openDetail = video => { closeLayers(); setView(video) }

  if (view) {
    const current = videos.find(video => video.id === view.id) || view
    return <TooltipProvider delayDuration={250}><Suspense fallback={<LoadingFallback />}><VideoDetail video={current} videos={videos} calibration={predictionCalibration} onClose={() => setView(null)} /></Suspense><ToastStack toasts={toasts} dismiss={id => setToasts(items => items.filter(item => item.id !== id))} /></TooltipProvider>
  }

  return <TooltipProvider delayDuration={250}>
    <div className="app-frame grid h-[100dvh] overflow-hidden text-foreground md:grid-cols-[68px_minmax(0,1fr)]">
      <a className="skip-link" href="#rundown-main">Skip to release rundown</a>
      <aside className="utility-rail hidden h-[100dvh] flex-col md:flex" aria-label="Workspace tools">
        <div className="utility-brand" aria-label="Velocity Desk"><span>VD</span></div>
        <nav className="utility-nav" aria-label="Primary navigation">
          <RailAction icon={BarChart3} label={'Release rundown, ' + active.length + ' active and ' + issueCount + ' flagged'} active={!addOpen && !settingsOpen && !watchOpen && compareVideo === null} onClick={() => { closeLayers(); setFilter('all') }} />
          <RailAction icon={Library} label="Watchlist" active={watchOpen} onClick={openWatchlist} />
          <RailAction icon={GitCompare} label="Compare releases" active={compareVideo !== null} onClick={openCompare} />
          <div className="mt-auto" />
          <RailAction icon={Settings} label="Settings" active={settingsOpen} onClick={openSettings} />
        </nav>
      </aside>

      <main className="flex min-w-0 flex-col overflow-hidden">
        <header className="release-commandbar">
          <div className="command-identity min-w-0">
            <span className="command-mobile-mark md:hidden" aria-hidden="true">VD</span>
            <span className="command-product"><strong>Velocity Desk</strong><small>Release monitor</small></span>
            <span className="command-session hidden lg:flex"><span>Local workspace</span><time dateTime={new Date(clockNow).toISOString()}>{formatTimeEAT(clockNow)} EAT</time></span>
          </div>

          <div className="command-search min-w-0" role="search">
            <Search className="size-4" aria-hidden="true" />
            <input ref={searchInput} value={commandQuery} onChange={event => setCommandQuery(event.target.value)} placeholder="Search releases, artists, channels" aria-label="Search tracked releases" />
            {commandQuery ? <button type="button" className="command-search-clear" onClick={() => setCommandQuery('')} aria-label="Clear search"><X className="size-3.5" /></button> : <kbd className="kbd-token" aria-hidden="true">/</kbd>}
          </div>

          <div className="hidden lg:block"><QuotaBar compact /></div>

          <div className="command-actions flex items-center gap-1.5 justify-self-end">
            <Button size="icon-sm" variant="ghost" className="command-icon md:hidden" onClick={openWatchlist} aria-label="Watchlist"><Library className="size-4" /></Button>
            <Button size="icon-sm" variant="ghost" className="command-icon md:hidden" onClick={openCompare} aria-label="Compare releases"><GitCompare className="size-4" /></Button>
            <Button size="icon-sm" variant="ghost" className="command-icon md:hidden" onClick={openSettings} aria-label="Settings"><Settings className="size-4" /></Button>
            <Button size="icon-sm" variant="ghost" className="command-icon" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')} aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}</Button>
            <Button className="command-primary" size="sm" onClick={openAdd}><Plus className="size-4" />Track release</Button>
          </div>
        </header>

        {(!settings.apiKey || settings.pollingPaused || poller.lockActive || backupDue || pollingGaps.length > 0 || storageNeedsProtection) && <section className="status-ribbon" aria-label="Workspace notices">
          {!settings.apiKey && <div className="status-item" data-tone="warning" role="status"><span className="status-dot" aria-hidden="true" /><span><strong>API key missing.</strong> Polling is stopped.</span><button type="button" onClick={openSettings}>Configure</button></div>}
          {settings.pollingPaused && <div className="status-item" role="status"><span className="status-dot" aria-hidden="true" /><span><strong>Polling paused.</strong> Worker timers are stopped.</span><button type="button" onClick={() => setSetting('pollingPaused', false)}><Play className="size-3" aria-hidden="true" />Resume</button></div>}
          {poller.lockActive && <div className="status-item" role="status"><span className="status-dot" aria-hidden="true" /><span><strong>Another tab owns polling.</strong> Manual refresh remains available.</span></div>}
          {pollingGaps.length > 0 && <div className="status-item" data-tone="warning" role="status"><span className="status-dot" aria-hidden="true" /><span><strong>{pollingGaps.length} observation gap{pollingGaps.length === 1 ? '' : 's'}.</strong> Polling only runs while the browser is open and the device is awake.</span><button type="button" onClick={() => { setCommandQuery(''); setFilter('gaps') }}>Review</button></div>}
          {storageNeedsProtection && <div className="status-item" data-tone="warning" role="status"><span className="status-dot" aria-hidden="true" /><span><strong>Local storage is not protected.</strong> The browser may evict history.</span><button type="button" onClick={storageStatus === 'available' ? protectStorage : openDataSettings}>{storageStatus === 'available' ? 'Protect data' : 'Review'}</button></div>}
          {backupDue && <div className="status-item" data-tone="warning" role="status"><span className="status-dot" aria-hidden="true" /><span><strong>Backup due.</strong> Browser-owned history has not been exported recently.</span><button type="button" onClick={openDataSettings}>Review</button></div>}
        </section>}

        <Dashboard videos={active} filter={filter} searchQuery={commandQuery} onFilterChange={setFilter} calibration={predictionCalibration} onAdd={openAdd} onOpen={openDetail} onCompare={openCompare} />
      </main>
    </div>

    {addOpen && <AddVideoModal apiKey={settings.apiKey} defaultInterval={settings.defaultPollInterval} draft={addDraft} onDraftChange={patch => setAddDraft(current => ({ ...current, ...patch }))} onClose={closeAdd} onSettings={openSettingsForAdd} onToast={toast} />}
    {settingsOpen && <SettingsPanel settings={settings} initialSection={settingsInitialSection} storageStatus={storageStatus} onProtectStorage={protectStorage} onClose={closeSettings} onToast={toast} />}
    {watchOpen && <Suspense fallback={<LoadingFallback />}><Watchlist videos={videos} onClose={() => setWatchOpen(false)} onOpen={openDetail} /></Suspense>}
    {compareVideo !== null && <Suspense fallback={<LoadingFallback />}><CompareView videos={videos} initial={compareVideo?.videoId ? compareVideo : null} onClose={() => setCompareVideo(null)} /></Suspense>}
    <ToastStack toasts={toasts} dismiss={id => setToasts(items => items.filter(item => item.id !== id))} />
  </TooltipProvider>
}