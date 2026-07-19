import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Activity, Bell, CheckCircle2, Database, Download, Eye, EyeOff, KeyRound, Palette, RefreshCw, ShieldCheck, SlidersHorizontal, Trash2, Upload } from 'lucide-react'
import { compactHistory, db, exportDatabase, importDatabase, markBackupComplete, normalizeDatabaseImport, recordPollEvent, setSetting } from '../../db/db.js'
import { incrementQuota } from '../../hooks/useQuota.js'
import { useTheme } from '../../hooks/useTheme.js'
import { downloadFile } from '../../utils/export.js'
import { formatDateTimeEAT, formatRelativeTime } from '../../utils/time.js'
import { testYouTubeApiKey } from '../../utils/youtube.js'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Switch } from '@/components/ui/switch'

const settingsSections = [
  { key: 'api', label: 'API', icon: KeyRound },
  { key: 'polling', label: 'Polling', icon: SlidersHorizontal },
  { key: 'appearance', label: 'Appearance', icon: Palette },
  { key: 'alerts', label: 'Alerts', icon: Bell },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'activity', label: 'Activity', icon: Activity },
]

const themeChoices = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

const storageLabels = {
  checking: 'Checking',
  persistent: 'Protected',
  available: 'Protection available',
  denied: 'Not protected',
  unsupported: 'Unavailable',
}

function SectionHeading({ title, description, aside }) {
  return <header className="settings-section-heading"><div><h2>{title}</h2><p>{description}</p></div>{aside}</header>
}

function PollEventRow({ event }) {
  return <article className="poll-event-row">
    <div><strong>{event.type.replaceAll('_', ' ')}</strong><time className="metric">{formatRelativeTime(event.timestamp)}</time></div>
    <p>{event.message || 'No additional message.'}</p>
    <footer>{event.videoId && <code>{event.videoId}</code>}{event.code && <span className="metric">Code {event.code}</span>}{event.quotaUnits > 0 && <span className="metric">+{event.quotaUnits} quota</span>}</footer>
  </article>
}

export default function SettingsPanel({ settings, initialSection = 'api', storageStatus = 'unsupported', onProtectStorage, onClose, onToast }) {
  const [section, setSection] = useState(initialSection)
  const { theme, setTheme } = useTheme()
  const [apiKey, setApiKey] = useState(settings.apiKey || '')
  const [apiTestState, setApiTestState] = useState('untested')
  const [apiTestMessage, setApiTestMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const [ghToken, setGhToken] = useState(settings.githubToken || '')
  const [ghVisible, setGhVisible] = useState(false)
  const [interval, setIntervalValue] = useState(String(settings.defaultPollInterval || 60))
  const [adaptiveEnabled, setAdaptiveEnabled] = useState(settings.adaptive_polling_enabled !== false)
  const [surge, setSurge] = useState(settings.threshold_surge ?? 80)
  const [active, setActive] = useState(settings.threshold_active ?? 20)
  const [slow, setSlow] = useState(settings.threshold_slow ?? 5)
  const [backupDays, setBackupDays] = useState(String(settings.backupReminderDays || 7))
  const [busyAction, setBusyAction] = useState(null)
  const [thresholdError, setThresholdError] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  const [clearPhrase, setClearPhrase] = useState('')
  const [importPreview, setImportPreview] = useState(null)
  const notificationSupported = typeof Notification !== 'undefined'
  const [notificationPermission, setNotificationPermission] = useState(notificationSupported ? Notification.permission : 'unsupported')
  const importRef = useRef()
  const pollEvents = useLiveQuery(() => db.pollEvents.orderBy('timestamp').reverse().limit(20).toArray(), [], [])

  useEffect(() => setSection(initialSection), [initialSection])

  useEffect(() => {
    setApiKey(settings.apiKey || '')
    setGhToken(settings.githubToken || '')
    setIntervalValue(String(settings.defaultPollInterval || 60))
    setAdaptiveEnabled(settings.adaptive_polling_enabled !== false)
    setSurge(settings.threshold_surge ?? 80)
    setActive(settings.threshold_active ?? 20)
    setSlow(settings.threshold_slow ?? 5)
    setBackupDays(String(settings.backupReminderDays || 7))
  }, [settings])

  const persistAdaptive = async () => {
    const next = {
      threshold_surge: Math.max(1, Math.min(9999, Number(surge) || 80)),
      threshold_active: Math.max(1, Math.min(9999, Number(active) || 20)),
      threshold_slow: Math.max(1, Math.min(9999, Number(slow) || 5)),
    }

    if (!(next.threshold_surge > next.threshold_active && next.threshold_active > next.threshold_slow)) {
      setThresholdError('Thresholds must descend from surge to active to slow.')
      return false
    }

    setThresholdError('')
    await Promise.all([
      setSetting('adaptive_polling_enabled', adaptiveEnabled),
      setSetting('threshold_surge', next.threshold_surge),
      setSetting('threshold_active', next.threshold_active),
      setSetting('threshold_slow', next.threshold_slow),
    ])
    setSurge(next.threshold_surge)
    setActive(next.threshold_active)
    setSlow(next.threshold_slow)
    return true
  }

  const save = async () => {
    const adaptiveSaved = await persistAdaptive()
    if (!adaptiveSaved) {
      setSection('polling')
      return
    }

    await Promise.all([
      setSetting('apiKey', apiKey.trim()),
      setSetting('githubToken', ghToken.trim()),
      setSetting('defaultPollInterval', Number(interval)),
      setSetting('backupReminderDays', Number(backupDays)),
    ])
    onToast('Settings saved', 'API, polling, thresholds, and backup cadence have been updated.')
    onClose()
  }

  const testApiKey = async () => {
    setBusyAction('test-key')
    setApiTestState('testing')
    setApiTestMessage('')
    try {
      const result = await testYouTubeApiKey(apiKey)
      if (result.quotaUnits) await incrementQuota(result.quotaUnits)
      await recordPollEvent({ type: 'api_key_test', message: 'YouTube API key test succeeded.', quotaUnits: result.quotaUnits }).catch(() => {})
      setApiTestState('valid')
      setApiTestMessage('Verified with the YouTube Data API.')
      onToast('API key verified', 'YouTube accepted the key.')
    } catch (error) {
      const quotaUnits = Number(error.quotaUnits || 0)
      if (quotaUnits) await incrementQuota(quotaUnits)
      await recordPollEvent({ type: 'api_key_test_error', code: error.code, message: error.message, quotaUnits }).catch(() => {})
      setApiTestState('invalid')
      setApiTestMessage(error.message)
      onToast('API key test failed', error.message)
    } finally {
      setBusyAction(null)
    }
  }

  const saveAdaptive = async () => {
    if (!await persistAdaptive()) return
    onToast('Adaptive polling saved', 'Worker thresholds will update automatically.')
  }

  const toggleAdaptive = async next => {
    setAdaptiveEnabled(next)
    await setSetting('adaptive_polling_enabled', next)
  }

  const exportAll = async () => {
    setBusyAction('export')
    try {
      downloadFile('velocity-desk-' + Date.now() + '.json', JSON.stringify(await exportDatabase(), null, 2), 'application/json')
      await markBackupComplete()
      onToast('Backup exported', 'Local data exported without the API key.')
    } finally {
      setBusyAction(null)
    }
  }

  const prepareImport = async event => {
    const file = event.target.files?.[0]
    if (!file) return
    event.target.value = ''
    if (file.size > 100 * 1024 * 1024) {
      onToast('Import rejected', 'Backup files must be 100 MB or smaller.')
      return
    }

    setBusyAction('prepare-import')
    try {
      const payload = JSON.parse(await file.text())
      const normalized = normalizeDatabaseImport(payload)
      setImportPreview({
        fileName: file.name,
        payload,
        exportedAt: payload.exportedAt || null,
        counts: {
          releases: normalized.videos.length,
          observations: normalized.datapoints.length,
          milestones: normalized.milestones.length,
          notes: normalized.notes.length,
        },
      })
    } catch (error) {
      setImportPreview(null)
      onToast('Import rejected', error.message)
    } finally {
      setBusyAction(null)
    }
  }

  const confirmImport = async () => {
    if (!importPreview) return
    setBusyAction('import')
    try {
      const current = await exportDatabase()
      downloadFile('velocity-desk-pre-import-' + Date.now() + '.json', JSON.stringify(current, null, 2), 'application/json')
      await importDatabase(importPreview.payload)
      await markBackupComplete()
      onToast('Import complete', 'Current data was backed up before the validated replacement was restored.')
      setImportPreview(null)
    } catch (error) {
      onToast('Import failed', error.message)
    } finally {
      setBusyAction(null)
    }
  }

  const compact = async () => {
    setBusyAction('compact')
    try {
      const result = await compactHistory({ olderThanDays: 14, bucketMinutes: 60 })
      onToast('History compacted', result.deleted.toLocaleString() + ' old samples removed.')
    } finally {
      setBusyAction(null)
    }
  }

  const clear = async () => {
    if (clearPhrase !== 'CLEAR') return
    await db.delete()
    location.reload()
  }

  const enableNotifications = async () => {
    if (!notificationSupported) {
      onToast('Desktop alerts unavailable', 'This browser does not support desktop notifications.')
      return
    }
    const permission = await Notification.requestPermission()
    setNotificationPermission(permission)
    onToast(permission === 'granted' ? 'Desktop alerts enabled' : 'Desktop alerts blocked', permission === 'granted' ? 'Milestone and polling alerts may now appear.' : 'Change the site permission in your browser to enable alerts.')
  }

  const lastBackup = settings.lastBackupAt ? formatDateTimeEAT(settings.lastBackupAt) + ' EAT' : 'Never'
  const apiConnectionLabel = apiTestState === 'valid' ? 'Verified' : apiTestState === 'invalid' ? 'Test failed' : apiKey ? 'Configured' : 'Missing key'

  return <Sheet open onOpenChange={open => !open && onClose()}>
    <SheetContent className="settings-sheet">
      <SheetHeader className="settings-sheet-header">
        <SheetTitle>Settings</SheetTitle>
        <SheetDescription>Local configuration and browser-owned data.</SheetDescription>
      </SheetHeader>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {settingsSections.map(item => {
            const Icon = item.icon
            return <button type="button" data-active={section === item.key || undefined} aria-current={section === item.key ? 'page' : undefined} key={item.key} onClick={() => { setSection(item.key); if (item.key !== 'data') { setClearArmed(false); setClearPhrase('') } }}><Icon className="size-4" /><span>{item.label}</span>{item.key === 'activity' && pollEvents.length > 0 ? <small className="metric">{pollEvents.length}</small> : null}</button>
          })}
        </nav>

        <ScrollArea className="settings-content">
          <div className="settings-section">
            {section === 'api' && <>
              <SectionHeading title="YouTube API" description="Credentials used for direct browser-to-YouTube requests." aside={<span className={'settings-connection ' + (apiTestState === 'valid' ? 'text-success' : apiTestState === 'invalid' || !apiKey ? 'text-warning' : '')}>{apiConnectionLabel}</span>} />
              <div className="settings-field-block">
                <Label htmlFor="api-key">YouTube Data API key</Label>
                <div className="settings-api-control"><Input id="api-key" type={visible ? 'text' : 'password'} value={apiKey} onChange={event => { setApiKey(event.target.value); setApiTestState('untested'); setApiTestMessage('') }} placeholder="Stored only in IndexedDB" /><Button type="button" variant="outline" size="icon" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Hide API key' : 'Show API key'}>{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button><Button type="button" variant="outline" onClick={testApiKey} disabled={!apiKey.trim() || busyAction === 'test-key'}>{busyAction === 'test-key' ? <RefreshCw className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{busyAction === 'test-key' ? 'Testing' : 'Test key'}</Button></div>
                {apiTestMessage && <p className="settings-api-result" data-state={apiTestState} role={apiTestState === 'invalid' ? 'alert' : 'status'}>{apiTestMessage}</p>}
              </div>
              <div className="settings-note"><strong>Local credential</strong><p>The browser sends this key directly to YouTube. Restrict it to the YouTube Data API and keep this app on localhost or a trusted local environment. Testing uses one quota unit.</p></div>
              <div className="settings-field-block">
                <Label htmlFor="github-token">GitHub token (cloud collector)</Label>
                <div className="settings-api-control"><Input id="github-token" type={ghVisible ? 'text' : 'password'} value={ghToken} onChange={event => setGhToken(event.target.value)} placeholder="Optional fine-grained PAT" autoComplete="off" /><Button type="button" variant="outline" size="icon" onClick={() => setGhVisible(value => !value)} aria-label={ghVisible ? 'Hide GitHub token' : 'Show GitHub token'}>{ghVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div>
              </div>
              <div className="settings-note"><strong>Watchlist sync</strong><p>With a token, tracked releases are pushed to the repo's data branch automatically so the GitHub Actions collector keeps polling them while this browser is closed. Use a fine-grained token scoped to only this repository with Contents read and write, and nothing else. Stored in IndexedDB like the API key; excluded from backups.</p></div>
            </>}

            {section === 'polling' && <>
              <SectionHeading title="Polling" description="Frequency rules for scheduled release observations." />
              <div className="settings-note warning-note"><strong>Browser-owned schedule</strong><p>Polling runs only while this browser is open and the device is awake. Velocity Desk records and surfaces observation gaps after the app resumes.</p></div>
              <div className="settings-field-block settings-inline-field"><div><Label htmlFor="default-interval">Default interval</Label><p>Used when a release does not have its own interval.</p></div><Select value={interval} onValueChange={setIntervalValue}><SelectTrigger id="default-interval"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 seconds</SelectItem><SelectItem value="60">1 minute</SelectItem><SelectItem value="120">2 minutes</SelectItem><SelectItem value="300">5 minutes</SelectItem></SelectContent></Select></div>
              <div className="settings-rule">
                <div><strong>Adaptive polling</strong><p>Adjust request frequency from the measured velocity tier.</p></div><Switch checked={adaptiveEnabled} onCheckedChange={toggleAdaptive} aria-label="Adaptive polling" />
              </div>
              {adaptiveEnabled && <div className="threshold-editor">
                <div className="threshold-head"><span>Tier</span><span>Velocity above</span></div>
                <label><span>Surge</span><Input aria-invalid={Boolean(thresholdError)} className="metric" type="number" min="1" max="9999" value={surge} onChange={event => { setSurge(event.target.value); setThresholdError('') }} /></label>
                <label><span>Active</span><Input aria-invalid={Boolean(thresholdError)} className="metric" type="number" min="1" max="9999" value={active} onChange={event => { setActive(event.target.value); setThresholdError('') }} /></label>
                <label><span>Slow</span><Input aria-invalid={Boolean(thresholdError)} className="metric" type="number" min="1" max="9999" value={slow} onChange={event => { setSlow(event.target.value); setThresholdError('') }} /></label>
                {thresholdError && <p role="alert" className="threshold-error">{thresholdError}</p>}
                <div className="threshold-footer"><span>Values are views per minute.</span><Button type="button" size="sm" variant="outline" onClick={saveAdaptive}>Save thresholds</Button></div>
              </div>}
            </>}

            {section === 'appearance' && <>
              <SectionHeading title="Appearance" description="Theme preference for this browser profile." aside={<span className="settings-connection">{theme === 'system' ? 'Following system' : theme === 'dark' ? 'Dark' : 'Light'}</span>} />
              <div className="settings-rule">
                <div><strong>Theme</strong><p>System follows your operating system preference and updates automatically.</p></div>
                <div className="mode-segment" role="group" aria-label="Theme preference">
                  {themeChoices.map(choice => <button key={choice.value} type="button" data-active={theme === choice.value || undefined} aria-pressed={theme === choice.value} onClick={() => setTheme(choice.value)}>{choice.label}</button>)}
                </div>
              </div>
              <div className="settings-note"><strong>Stored locally</strong><p>The preference is saved in this browser only and applies before the app loads, so there is no flash of the wrong theme.</p></div>
            </>}

            {section === 'alerts' && <>
              <SectionHeading title="Desktop alerts" description="Notification permission for milestone and polling events." aside={<span className={notificationPermission === 'granted' ? 'settings-connection text-success' : 'settings-connection text-warning'}>{notificationPermission === 'granted' ? 'Enabled' : notificationPermission === 'denied' ? 'Blocked' : notificationPermission === 'default' ? 'Not enabled' : 'Unavailable'}</span>} />
              <div className="settings-rule">
                <div><strong>Browser notifications</strong><p>Allow Velocity Desk to surface milestone and polling alerts outside the active tab.</p></div>
                {notificationPermission === 'default' && <Button type="button" size="sm" variant="outline" onClick={enableNotifications}>Enable</Button>}
              </div>
              {notificationPermission === 'granted' && <div className="settings-note success-note"><strong>Permission granted</strong><p>Alerts may appear when this browser is running and the operating system allows notifications.</p></div>}
              {notificationPermission === 'denied' && <div className="settings-note warning-note"><strong>Permission blocked</strong><p>Re-enable notifications from this site's browser permissions, then reopen Settings.</p></div>}
              {notificationPermission === 'unsupported' && <div className="settings-note warning-note"><strong>Unavailable</strong><p>This browser does not expose the desktop notification API.</p></div>}
            </>}

            {section === 'data' && <>
              <SectionHeading title="Local data" description="Protect, back up, restore, compact, or remove browser-owned evidence." aside={<span className="settings-connection">Last backup {lastBackup}</span>} />
              <div className="settings-rule">
                <div><strong>Persistent browser storage</strong><p>Ask the browser not to evict release history automatically.</p></div>
                <div className="settings-storage-action"><span className={'metric ' + (storageStatus === 'persistent' ? 'text-success' : storageStatus === 'available' || storageStatus === 'denied' ? 'text-warning' : '')}>{storageLabels[storageStatus] || storageStatus}</span>{(storageStatus === 'available' || storageStatus === 'denied') && <Button type="button" size="sm" variant="outline" onClick={onProtectStorage}><ShieldCheck className="size-4" />{storageStatus === 'denied' ? 'Retry' : 'Protect data'}</Button>}</div>
              </div>
              <div className="settings-field-block settings-inline-field"><div><Label htmlFor="backup-reminder">Backup reminder</Label><p>Show a workspace reminder after this many days without an export.</p></div><Select value={backupDays} onValueChange={setBackupDays}><SelectTrigger id="backup-reminder"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">Daily</SelectItem><SelectItem value="3">Every 3 days</SelectItem><SelectItem value="7">Weekly</SelectItem><SelectItem value="14">Every 2 weeks</SelectItem><SelectItem value="30">Monthly</SelectItem></SelectContent></Select></div>
              <div className="data-actions">
                <button type="button" onClick={exportAll} disabled={busyAction === 'export'}><Download className="size-4" /><span><strong>{busyAction === 'export' ? 'Exporting...' : 'Export full database'}</strong><small>JSON backup without the API key</small></span></button>
                <button type="button" onClick={() => importRef.current.click()} disabled={busyAction === 'prepare-import' || busyAction === 'import'}><Upload className="size-4" /><span><strong>{busyAction === 'prepare-import' ? 'Validating...' : 'Choose import file'}</strong><small>Preview a validated replacement before importing</small></span></button>
                <input ref={importRef} type="file" accept="application/json" hidden onChange={prepareImport} />
                <button type="button" onClick={compact} disabled={busyAction === 'compact'}><Database className="size-4" /><span><strong>{busyAction === 'compact' ? 'Compacting...' : 'Compact old history'}</strong><small>Keep recent samples raw and bucket older data hourly</small></span></button>
              </div>
              {importPreview && <div className="import-preview" role="group" aria-label="Import preview">
                <header><div><strong>Validated import preview</strong><p>{importPreview.fileName}{importPreview.exportedAt ? ' / exported ' + importPreview.exportedAt : ''}</p></div><CheckCircle2 className="size-4 text-success" /></header>
                <dl><div><dt>Releases</dt><dd>{importPreview.counts.releases.toLocaleString()}</dd></div><div><dt>Observations</dt><dd>{importPreview.counts.observations.toLocaleString()}</dd></div><div><dt>Milestones</dt><dd>{importPreview.counts.milestones.toLocaleString()}</dd></div><div><dt>Notes</dt><dd>{importPreview.counts.notes.toLocaleString()}</dd></div></dl>
                <p>Current data will be downloaded as a backup before this validated file replaces it.</p>
                <div><Button type="button" size="sm" variant="ghost" onClick={() => setImportPreview(null)} disabled={busyAction === 'import'}>Cancel</Button><Button type="button" size="sm" onClick={confirmImport} disabled={busyAction === 'import'}>{busyAction === 'import' ? 'Backing up and importing...' : 'Back up current data and replace'}</Button></div>
              </div>}
              <div className="settings-danger-zone">
                <div><strong>Clear all local data</strong><p>Permanently delete every release, observation, target, note, event, and setting.</p></div>
                {!clearArmed ? <Button type="button" size="sm" variant="destructive" onClick={() => { setClearArmed(true); setClearPhrase('') }}><Trash2 className="size-4" />Begin reset</Button> : <div className="danger-confirmation">
                  <Label htmlFor="clear-confirmation">Type CLEAR to confirm</Label>
                  <Input id="clear-confirmation" value={clearPhrase} onChange={event => setClearPhrase(event.target.value)} placeholder="CLEAR" autoComplete="off" />
                  <div><Button type="button" size="sm" variant="ghost" onClick={() => { setClearArmed(false); setClearPhrase('') }}>Cancel</Button><Button type="button" size="sm" variant="destructive" disabled={clearPhrase !== 'CLEAR'} onClick={clear}>Delete everything</Button></div>
                </div>}
              </div>
            </>}

            {section === 'activity' && <>
              <SectionHeading title="Polling activity" description="Recent worker decisions, successes, and failures." aside={<span className="settings-connection metric">{pollEvents.length} recent</span>} />
              <div className="poll-event-list">{pollEvents.length ? pollEvents.map(event => <PollEventRow key={event.id ?? event.timestamp + '-' + event.type} event={event} />) : <div className="operator-empty-state"><strong>No polling events</strong><p>Worker events will appear after tracking begins.</p></div>}</div>
            </>}
          </div>
        </ScrollArea>
      </div>

      <SheetFooter className="settings-footer"><span className="metric">Velocity Desk v1.0 / Local-first</span><Button onClick={save}>Save settings</Button></SheetFooter>
    </SheetContent>
  </Sheet>
}