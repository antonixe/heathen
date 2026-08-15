import { metric } from '../../utils/format.js'

export default function TopBar({ roster, paused, live, onAdd, onRefresh, canRefresh, onWatchlist, onSettings }) {
  // One number, not four. The second slot changes meaning instead of adding an item: it reports the
  // roster size normally and switches to the at-risk count when there is one, which is what you'd
  // rather know. Quota moved to Settings; a countdown in the chrome was just motion in the corner.
  const atRisk = roster.risk > 0
  const tone = paused ? 'paused' : atRisk ? 'risk' : live ? 'live' : ''

  return <header className="topbar">
    <div className="topbar-inner">
      <div className="brand"><b>VELOCITY</b></div>

      <div className="vitals">
        {roster.count > 0 && <>
          <i className={`pulse ${tone}`} aria-hidden="true" />
          <b>{metric(roster.velocity)}</b>
          <span>v/min</span>
          <em className={atRisk ? 'risk' : ''}>
            {atRisk ? `${roster.risk} at risk` : `${roster.count} track${roster.count === 1 ? '' : 's'}`}
          </em>
        </>}
      </div>

      <nav>
        <button className="track-button primary" onClick={onAdd}>+ Track <kbd>A</kbd></button>
        <button className="top-icon" onClick={onRefresh} disabled={!canRefresh} aria-label="Refresh all tracks now"><span>R</span></button>
        <button className="top-icon" onClick={onWatchlist} aria-label="Open watchlist"><span>W</span></button>
        <button className="top-icon" onClick={onSettings} aria-label="Open settings"><span>S</span></button>
      </nav>
    </div>
  </header>
}
