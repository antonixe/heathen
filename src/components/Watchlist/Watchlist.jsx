import { useState } from 'react'
import { Archive, RotateCcw, Search, SearchX, Trash2 } from 'lucide-react'
import { db, deleteVideoData } from '../../db/db.js'
import { deriveReleaseState } from '../../utils/releaseState.js'
import { formatRelativeTime } from '../../utils/time.js'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'

const stateLabels = {
  sampling: 'Sampling',
  tracking: 'Tracking',
  polling: 'Polling',
  surging: 'Surging',
  stale: 'Stale',
  paused: 'Paused',
  quota: 'Quota stopped',
  error: 'Polling error',
  unavailable: 'Unavailable',
}

export default function Watchlist({ videos, onClose, onOpen }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('active')
  const [pendingRemoveId, setPendingRemoveId] = useState(null)
  const filtered = videos.filter(video => video.status === tab && [video.title, video.customLabel, video.channelName, ...(video.tags || [])].join(' ').toLowerCase().includes(query.toLowerCase()))

  const remove = async video => {
    await deleteVideoData(video.videoId)
    setPendingRemoveId(null)
  }

  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="watchlist-dialog">
      <DialogHeader className="operator-dialog-header">
        <DialogTitle>Watchlist</DialogTitle>
        <DialogDescription>{videos.length} releases stored in this browser.</DialogDescription>
      </DialogHeader>

      <div className="watchlist-commandbar">
        <div className="operator-tabs" role="tablist" aria-label="Watchlist state">
          {['active', 'archived'].map(item => <button type="button" role="tab" id={'watchlist-tab-' + item} aria-controls="watchlist-rows" aria-selected={tab === item} data-active={tab === item || undefined} onClick={() => { setTab(item); setPendingRemoveId(null) }} key={item}>{item[0].toUpperCase() + item.slice(1)} <span className="metric">{videos.filter(video => video.status === item).length}</span></button>)}
        </div>
        <div className="watchlist-search"><Search className="size-4" aria-hidden="true" /><Input aria-label="Search watchlist" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search release, artist, channel, or tag" /></div>
      </div>

      <div className="watchlist-head" aria-hidden="true"><span>Release</span><span>Channel</span><span>Last observation</span><span>Status</span><span>Actions</span></div>

      <ScrollArea className="watchlist-scroll">
        <div className="watchlist-rows" id="watchlist-rows" role="tabpanel" aria-labelledby={'watchlist-tab-' + tab}>
          {filtered.map(video => {
            const releaseState = deriveReleaseState(video)
            const isPending = pendingRemoveId === video.videoId
            return <article className="watchlist-row" data-state={tab === 'archived' ? 'archived' : releaseState} key={video.videoId}>
              <button type="button" className="watchlist-release" onClick={() => onOpen(video)}>
                <span className="watchlist-thumb">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : null}</span>
                <span className="min-w-0"><strong>{video.customLabel || video.title || video.videoId}</strong><small>{video.title && video.customLabel ? video.title : (video.tags || []).slice(0, 2).join(' / ') || 'No tags'}</small></span>
              </button>
              <div className="watchlist-channel"><strong>{video.channelName || 'Unknown channel'}</strong><small>{video.videoId}</small></div>
              <div className="watchlist-observation metric"><span>{video.lastPolledAt ? formatRelativeTime(video.lastPolledAt) : 'Never'}</span><small>{video.lastViewCount?.toLocaleString() || 'No views'} views</small></div>
              <span className="watchlist-state" data-state={tab === 'archived' ? 'archived' : releaseState}>{tab === 'archived' ? 'Archived' : stateLabels[releaseState]}</span>
              <div className="watchlist-actions"><Button size="icon-sm" variant="ghost" onClick={() => db.videos.update(video.id, { status: tab === 'active' ? 'archived' : 'active' })} aria-label={tab === 'active' ? 'Archive release' : 'Restore release'}>{tab === 'active' ? <Archive className="size-4" /> : <RotateCcw className="size-4" />}</Button><Button size="icon-sm" variant="ghost" className="text-destructive" onClick={() => setPendingRemoveId(video.videoId)} aria-label="Stage release removal"><Trash2 className="size-4" /></Button></div>
              {isPending && <div className="watchlist-removal" role="group" aria-label={`Confirm removal of ${video.customLabel || video.title}`}><span><strong>Remove this release?</strong> Local observations, targets, and notes will be deleted.</span><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setPendingRemoveId(null)}>Keep</Button><Button size="sm" variant="destructive" onClick={() => remove(video)}>Remove</Button></div></div>}
            </article>
          })}
          {!filtered.length && <div className="operator-empty-state"><SearchX className="size-5" /><strong>No releases found</strong><p>{query ? 'Try a different search term.' : `No ${tab} releases are stored.`}</p></div>}
        </div>
      </ScrollArea>
    </DialogContent>
  </Dialog>
}