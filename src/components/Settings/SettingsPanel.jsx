import { useEffect, useRef, useState } from 'react'
import { db, exportDatabase, importDatabase, POLL_INTERVALS, setSetting } from '../../db/db.js'
import { downloadFile } from '../../utils/export.js'
import Ask from '../shared/Ask.jsx'
import QuotaBar from '../QuotaBar/QuotaBar.jsx'

const SHORTCUTS = [['A', 'Add video'], ['R', 'Refresh all'], ['P', 'Pause all'], ['S', 'Settings'], ['W', 'Watchlist'], ['1–9', 'Focus track'], ['ESC', 'Close panel']]

export default function SettingsPanel({ settings, onClose, onToast }) {
  const [apiKey, setApiKey] = useState(settings.apiKey || ''), [visible, setVisible] = useState(false)
  const [interval, setIntervalValue] = useState(settings.defaultPollInterval || 60), [clearing, setClearing] = useState(false)
  const [syncUrl, setSyncUrl] = useState(settings.syncUrl || ''), [syncToken, setSyncToken] = useState(settings.syncToken || '')
  const importRef = useRef()
  useEffect(() => {
    setApiKey(settings.apiKey || ''); setIntervalValue(settings.defaultPollInterval || 60)
    setSyncUrl(settings.syncUrl || ''); setSyncToken(settings.syncToken || '')
  }, [settings])
  const save = async () => {
    await Promise.all([setSetting('apiKey', apiKey.trim()), setSetting('defaultPollInterval', Number(interval)),
      setSetting('syncUrl', syncUrl.trim()), setSetting('syncToken', syncToken.trim())])
    onToast('Settings saved', 'Polling configuration has been updated.'); onClose()
  }
  const exportAll = async () => downloadFile(`velocity-desk-${Date.now()}.json`, JSON.stringify(await exportDatabase(), null, 2), 'application/json')
  const importAll = async event => {
    try { await importDatabase(JSON.parse(await event.target.files[0].text())); onToast('Import complete', 'Local database restored.') }
    catch (error) { onToast('Import failed', error.message, 'down') }
    event.target.value = ''
  }
  const clear = async () => { await db.delete(); location.reload() }
  // the key drives whether anything polls at all, so say so instead of leaving the field bare
  const status = apiKey.trim() !== (settings.apiKey || '') ? { tone: 'paused', text: 'Unsaved change' }
    : settings.apiKey ? { tone: 'polling', text: 'Key saved' }
    : { tone: 'error', text: 'No key — polling is stopped' }
  const syncDirty = syncUrl.trim() !== (settings.syncUrl || '') || syncToken.trim() !== (settings.syncToken || '')
  const sync = syncDirty ? { tone: 'paused', text: 'Unsaved change' }
    : settings.syncUrl && settings.syncToken ? { tone: 'polling', text: 'Pushing tracks to the poller' }
    : { tone: 'idle', text: 'Not configured — tracking stops when this tab closes' }
  return <div className="overlay panel-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <aside className="settings-panel">
      <header><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>Settings</h2></div><button className="plain close" onClick={onClose}>ESC</button></header>
      <section>
        <h3>YOUTUBE API</h3>
        <label>API KEY<div className="input-action"><input type={visible ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Stored only in IndexedDB" /><button type="button" onClick={() => setVisible(value => !value)}>{visible ? 'HIDE' : 'SHOW'}</button></div></label>
        <p className="key-status"><span className={`status-dot ${status.tone}`} />{status.text}</p>
        <QuotaBar />
        <p className="help">The browser sends this key directly to the YouTube Data API.</p>
      </section>
      <section>
        <h3>SCHEDULED POLLER</h3>
        <label>WORKER URL<input value={syncUrl} onChange={event => setSyncUrl(event.target.value)} placeholder="https://…workers.dev" /></label>
        <label>SYNC TOKEN<input type={visible ? 'text' : 'password'} value={syncToken} onChange={event => setSyncToken(event.target.value)} placeholder="Bearer token" /></label>
        <p className="key-status"><span className={`status-dot ${sync.tone}`} />{sync.text}</p>
        <p className="help">Tracks are pushed here automatically so polling continues while every browser is closed.</p>
      </section>
      <section>
        <h3>POLLING</h3>
        <div className="segmented spread" role="group" aria-label="Default poll interval">
          {POLL_INTERVALS.map(([value, label]) => <button key={value} type="button" aria-pressed={Number(interval) === value}
            className={Number(interval) === value ? 'active' : ''} onClick={() => setIntervalValue(value)}>{label}</button>)}
        </div>
        <p className="help">Default for newly tracked videos. Existing tracks keep their own interval.</p>
      </section>
      <section>
        <h3>DATA MANAGEMENT</h3>
        <div className="button-row"><button onClick={exportAll}>EXPORT JSON</button><button onClick={() => importRef.current.click()}>IMPORT JSON</button></div>
        <input ref={importRef} type="file" accept="application/json" hidden onChange={importAll} />
        <div className="danger-zone">
          <p>Deletes every video, datapoint, milestone and note held in this browser.</p>
          <button className="danger-button" onClick={() => setClearing(true)}>CLEAR ALL LOCAL DATA</button>
        </div>
      </section>
      <section><h3>KEYBOARD</h3><dl className="shortcut-list">{SHORTCUTS.map(([key, action]) => <div key={key}><dt>{key}</dt><dd>{action}</dd></div>)}</dl></section>
      <footer><span>Velocity Desk v1.0</span><button className="primary" onClick={save}>SAVE SETTINGS</button></footer>
      {clearing && <Ask title="Clear all local data?" danger confirmLabel="Clear everything"
        body="Every video, datapoint, milestone, note and setting is deleted. This cannot be undone."
        onDone={value => { setClearing(false); if (value) clear() }} />}
    </aside>
  </div>
}
