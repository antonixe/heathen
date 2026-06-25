import { useEffect, useRef, useState } from 'react'
import { db, exportDatabase, importDatabase, setSetting } from '../../db/db.js'
import { downloadFile } from '../../utils/export.js'

export default function SettingsPanel({ settings, onClose, onToast }) {
  const [apiKey, setApiKey] = useState(settings.apiKey || ''), [visible, setVisible] = useState(false)
  const [interval, setIntervalValue] = useState(settings.defaultPollInterval || 60)
  const importRef = useRef()
  useEffect(() => { setApiKey(settings.apiKey || ''); setIntervalValue(settings.defaultPollInterval || 60) }, [settings])
  const save = async () => {
    await Promise.all([setSetting('apiKey', apiKey.trim()), setSetting('defaultPollInterval', Number(interval))])
    onToast('Settings saved', 'Polling configuration has been updated.'); onClose()
  }
  const exportAll = async () => downloadFile(`velocity-desk-${Date.now()}.json`, JSON.stringify(await exportDatabase(), null, 2), 'application/json')
  const importAll = async event => {
    try { await importDatabase(JSON.parse(await event.target.files[0].text())); onToast('Import complete', 'Local database restored.') }
    catch (error) { onToast('Import failed', error.message) }
    event.target.value = ''
  }
  const clear = async () => {
    if (!confirm('Clear every video, datapoint, milestone, note, and setting? This cannot be undone.')) return
    await db.delete(); location.reload()
  }
  return <div className="overlay panel-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <aside className="settings-panel">
      <header><div><span className="eyebrow">LOCAL CONFIGURATION</span><h2>Settings</h2></div><button className="plain close" onClick={onClose}>ESC</button></header>
      <section><h3>YOUTUBE API</h3><label>API KEY<div className="input-action"><input type={visible ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Stored only in IndexedDB" /><button onClick={() => setVisible(value => !value)}>{visible ? 'HIDE' : 'SHOW'}</button></div></label><p className="help">The browser sends this key directly to the YouTube Data API.</p></section>
      <section><h3>POLLING</h3><label>DEFAULT INTERVAL<select value={interval} onChange={event => setIntervalValue(event.target.value)}><option value="30">30 seconds</option><option value="60">1 minute</option><option value="120">2 minutes</option><option value="300">5 minutes</option></select></label></section>
      <section><h3>DATA MANAGEMENT</h3><div className="button-stack"><button onClick={exportAll}>EXPORT FULL DATABASE (JSON)</button><button onClick={() => importRef.current.click()}>IMPORT DATABASE</button><input ref={importRef} type="file" accept="application/json" hidden onChange={importAll} /><button className="danger-button" onClick={clear}>CLEAR ALL LOCAL DATA</button></div></section>
      <section><h3>KEYBOARD</h3><dl className="shortcut-list"><div><dt>A</dt><dd>Add video</dd></div><div><dt>P</dt><dd>Pause all</dd></div><div><dt>S</dt><dd>Settings</dd></div><div><dt>W</dt><dd>Watchlist</dd></div><div><dt>1–9</dt><dd>Focus track</dd></div><div><dt>ESC</dt><dd>Close panel</dd></div></dl></section>
      <footer><span>Velocity Desk v1.0</span><button className="primary" onClick={save}>SAVE SETTINGS</button></footer>
    </aside>
  </div>
}
