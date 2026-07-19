import { Plus, Video } from 'lucide-react'
import { useLiveQuery } from 'dexie-react-hooks'
import VideoTile from '../VideoTile/VideoTile.jsx'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '../../utils/time.js'
import { hasReleaseError, isReleaseFresh, isReleaseStale, isReleaseSurging } from '../../utils/releaseState.js'
import { getPollingGap } from '../../utils/pollingGap.js'
import { db } from '../../db/db.js'

const compact = value => value === null || value === undefined ? '-' : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
const metric = value => value === null || value === undefined ? '-' : Number(value).toFixed(1)
const bestVelocity = video => Math.max(0, Number(video.velocity5m || 0), Number(video.velocity30m || 0), Number(video.velocity1h || 0), Number(video.sessionAvg || 0))

const filterDefinitions = [
  { key: 'all', label: 'All' },
  { key: 'fresh', label: 'Fresh' },
  { key: 'surging', label: 'Surging' },
  { key: 'stale', label: 'Stale' },
  { key: 'attention', label: 'Attention' },
  { key: 'paused', label: 'Paused' },
  { key: 'gaps', label: 'Gaps' },
]

function filterVideos(videos, filter, now) {
  if (filter === 'fresh') return videos.filter(video => isReleaseFresh(video, now))
  if (filter === 'surging') return videos.filter(isReleaseSurging)
  if (filter === 'stale') return videos.filter(video => isReleaseStale(video, now))
  if (filter === 'attention') return videos.filter(hasReleaseError)
  if (filter === 'paused') return videos.filter(video => video.pollState === 'paused')
  if (filter === 'gaps') return videos.filter(video => getPollingGap(video, now))
  return videos
}

function searchVideos(videos, query) {
  const needle = String(query || '').trim().toLowerCase()
  if (!needle) return videos
  return videos.filter(video => [video.title, video.customLabel, video.channelName, video.videoId, ...(video.tags || [])].some(value => String(value || '').toLowerCase().includes(needle)))
}

function EmptyWorkbench({ onAdd }) {
  return <main id="rundown-main" tabIndex={-1} className="rundown-workspace flex-1 overflow-y-auto">
    <header className="rundown-masthead">
      <div>
        <p className="workspace-context">Local workspace / live monitor</p>
        <h1>Release rundown</h1>
      </div>
      <dl className="rundown-summary" aria-label="Rundown summary">
        <div><dt>Tracked</dt><dd>0</dd></div>
        <div><dt>Fresh</dt><dd>0</dd></div>
        <div><dt>Session gain</dt><dd>-</dd></div>
        <div><dt>Attention</dt><dd>0</dd></div>
      </dl>
    </header>

    <section className="rundown-board min-h-[420px]" aria-label="Tracked releases">
      <div className="rundown-toolbar">
        <div className="rundown-tabs" role="tablist" aria-label="Release filters">
          <button type="button" role="tab" aria-selected="true" data-active="true">All <Badge variant="secondary" className="metric">0</Badge></button>
        </div>
      </div>
      <div className="grid min-h-[340px] place-items-center px-5 py-10">
        <div className="empty-panel max-w-md">
          <div className="mb-3 grid size-10 place-items-center rounded-lg bg-primary/10 text-primary"><Video className="size-5" /></div>
          <div className="text-sm font-semibold">No releases on the rundown</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">Track a YouTube release to start collecting local observations, velocity windows, and milestone evidence.</p>
          <Button className="mt-5" onClick={onAdd}><Plus className="size-4" />Track release</Button>
        </div>
      </div>
    </section>
  </main>
}

export default function Dashboard({ videos, filter = 'all', searchQuery = '', onFilterChange, calibration, onAdd, onOpen, onCompare }) {
  const milestones = useLiveQuery(() => db.milestones.toArray(), [], [])
  const now = Date.now()
  const stateVisible = filterVideos(videos, filter, now)
  const visible = searchVideos(stateVisible, searchQuery)
  const fresh = videos.filter(video => isReleaseFresh(video, now)).length
  const staleCount = videos.filter(video => isReleaseStale(video, now)).length
  const surging = videos.filter(isReleaseSurging).length
  const errored = videos.filter(hasReleaseError).length
  const paused = videos.filter(video => video.pollState === 'paused').length
  const gaps = videos.filter(video => getPollingGap(video, now)).length
  const sessionGain = videos.reduce((sum, video) => sum + Number(video.sessionGain || 0), 0)
  const fastest = [...videos].sort((a, b) => bestVelocity(b) - bestVelocity(a))[0]
  const stalest = [...videos].filter(video => isReleaseStale(video, now)).sort((a, b) => Number(a.lastPolledAt || 0) - Number(b.lastPolledAt || 0))[0]
  const activeVideoIds = new Set(videos.map(video => video.videoId))
  const targetCount = new Set(milestones.filter(row => activeVideoIds.has(row.videoId) && !row.hitAt && (!row.deadlineTimestamp || row.deadlineTimestamp > now)).map(row => row.videoId)).size
  const counts = {
    all: videos.length,
    fresh,
    surging,
    stale: staleCount,
    attention: errored,
    paused,
    gaps,
  }

  if (!videos.length) return <EmptyWorkbench onAdd={onAdd} />

  return <main id="rundown-main" tabIndex={-1} className="rundown-workspace flex-1 overflow-y-auto">
    <header className="rundown-masthead">
      <div>
        <p className="workspace-context">Local workspace / live monitor</p>
        <h1>Release rundown</h1>
      </div>
      <dl className="rundown-summary" aria-label="Rundown summary">
        <div><dt>Tracked</dt><dd>{videos.length}</dd></div>
        <div><dt>Fresh</dt><dd className={fresh === videos.length ? 'text-success' : ''}>{fresh}</dd></div>
        <div><dt>Session gain</dt><dd className={sessionGain > 0 ? 'text-success' : ''}>{sessionGain > 0 ? '+' : ''}{compact(sessionGain)}</dd></div>
        <div><dt>Attention</dt><dd className={errored ? 'text-destructive' : ''}>{errored}</dd></div>
      </dl>
    </header>

    <section className="rundown-board" aria-label="Tracked releases">
      <div className="rundown-toolbar">
        <div className="rundown-tabs" role="tablist" aria-label="Release filters">
          {filterDefinitions.map(item => <button key={item.key} id={'filter-tab-' + item.key} type="button" role="tab" aria-selected={filter === item.key} aria-controls="release-register" data-active={filter === item.key || undefined} onClick={() => onFilterChange(item.key)}>
            {item.label} <Badge variant={filter === item.key ? 'default' : 'secondary'} className="metric">{counts[item.key]}</Badge>
          </button>)}
        </div>
        <p className="rundown-freshness">{fresh} of {videos.length} observations are under 10 minutes old</p>
      </div>

      <div className="release-board-head hidden lg:grid" aria-hidden="true">
        <span>#</span>
        <span>Release</span>
        <span>Views</span>
        <span>5m</span>
        <span>30m</span>
        <span>Trend</span>
        <span>Target</span>
        <span>Next poll</span>
        <span></span>
      </div>

      <div id="release-register" role="tabpanel" aria-labelledby={'filter-tab-' + filter}>
        {visible.length ? <div className="release-list">
          {visible.map((video, index) => <VideoTile key={video.videoId} video={video} index={index} calibration={calibration} onOpen={onOpen} onCompare={onCompare} />)}
        </div> : <div className="grid min-h-72 place-items-center p-6"><div className="empty-panel"><div className="metric text-2xl">0</div><p className="mt-2 text-sm text-muted-foreground">{searchQuery ? 'No releases match "' + searchQuery + '".' : 'No releases match this state.'}</p></div></div>}
      </div>

      <footer className="rundown-notes" aria-label="Rundown notes">
        <span><strong>Fastest</strong> {fastest ? `${metric(bestVelocity(fastest))} v/min / ${fastest.customLabel || fastest.title || fastest.videoId}` : 'Waiting for velocity data'}</span>
        <span><strong>Targets</strong> {targetCount} open</span>
        <span><strong>Oldest observation</strong> {stalest ? formatRelativeTime(stalest.lastPolledAt) : 'All current'}</span>
      </footer>
    </section>
  </main>
}