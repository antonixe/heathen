import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, RefreshCw, X } from 'lucide-react'
import { db, addObservation, recordPollEvent } from '../../db/db.js'
import { fetchYouTubeVideo, parseVideoLines } from '../../utils/youtube.js'
import { incrementQuota } from '../../hooks/useQuota.js'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export default function AddVideoModal({ apiKey, defaultInterval, draft, onDraftChange, onClose, onSettings, onToast }) {
  const [rowStates, setRowStates] = useState({})
  const text = draft?.text || ''
  const label = draft?.label || ''
  const tags = draft?.tags || ''
  const interval = draft?.interval || String(defaultInterval || 60)
  const parsed = useMemo(() => parseVideoLines(text), [text])
  const valid = [...new Map(parsed.filter(row => row.valid).map(row => [row.videoId, row])).values()]
  const enteredCount = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).length
  const pendingRows = valid.filter(row => rowStates[row.videoId]?.status !== 'success')
  const failedCount = valid.filter(row => rowStates[row.videoId]?.status === 'error').length
  const successCount = valid.filter(row => rowStates[row.videoId]?.status === 'success').length
  const busy = Object.values(rowStates).some(row => row.status === 'loading')
  const allAdded = valid.length > 0 && successCount === valid.length
  const updateDraft = patch => onDraftChange(patch)

  const setRowState = (videoId, next) => setRowStates(current => ({ ...current, [videoId]: next }))

  const addRelease = async row => {
    setRowState(row.videoId, { status: 'loading', message: 'Fetching metadata...' })
    try {
      const data = await fetchYouTubeVideo(row.videoId, apiKey)
      await incrementQuota()
      await recordPollEvent({ type: 'metadata_success', videoId: row.videoId, message: 'Metadata fetched while adding release.', quotaUnits: 1 }).catch(() => {})
      const existing = await db.videos.where('videoId').equals(row.videoId).first()
      await db.videos.put({
        ...existing,
        videoId: row.videoId,
        title: data.title,
        channelName: data.channelName,
        thumbnailUrl: data.thumbnailUrl,
        publishedAt: data.publishedAt,
        lastLikeCount: data.likeCount,
        lastCommentCount: data.commentCount,
        customLabel: valid.length === 1 ? label.trim() : '',
        tags: tags.split(',').map(tag => tag.trim()).filter(Boolean),
        status: 'active',
        addedAt: existing?.addedAt || Date.now(),
        pollInterval: Number(interval),
        pollState: 'idle',
      })
      await addObservation(row.videoId, data.viewCount, Date.now(), { likeCount: data.likeCount, commentCount: data.commentCount, publishedAt: data.publishedAt })
      setRowState(row.videoId, { status: 'success', message: 'Added to the release rundown.', title: data.title })
      return { ok: true, row }
    } catch (error) {
      const quotaUnits = Number(error.quotaUnits || 0)
      if (quotaUnits > 0) await incrementQuota(quotaUnits)
      await recordPollEvent({ type: 'metadata_error', videoId: row.videoId, code: error.code, message: error.message, quotaUnits }).catch(() => {})
      setRowState(row.videoId, { status: 'error', message: error.message || 'YouTube request failed.' })
      return { ok: false, row, error }
    }
  }

  const runRows = async (rows, closeWhenComplete = false) => {
    if (!apiKey) {
      onSettings()
      return
    }
    if (!rows.length || busy) return
    const results = await Promise.all(rows.map(addRelease))
    const failures = results.filter(result => !result.ok)
    const added = results.length - failures.length

    if (failures.length) {
      onToast('Some releases need attention', added ? added + ' added; ' + failures.length + ' failed. Review the rows and retry.' : failures.length + ' releases failed. Review the rows and retry.')
      return
    }

    onToast('Tracking started', added + ' release' + (added === 1 ? '' : 's') + ' added.')
    if (closeWhenComplete) onClose()
  }

  const submit = event => {
    event.preventDefault()
    runRows(pendingRows, true)
  }

  const seenIds = new Set()

  return <Dialog open onOpenChange={open => !open && onClose()}>
    <DialogContent className="track-dialog">
      <form onSubmit={submit} className="track-dialog-form">
        <DialogHeader className="operator-dialog-header">
          <DialogTitle>Track releases</DialogTitle>
          <DialogDescription>Paste YouTube URLs or 11-character video IDs. Up to ten releases can be processed at once.</DialogDescription>
        </DialogHeader>

        <div className="track-dialog-body">
          <div className="track-paste-field">
            <Label htmlFor="video-lines">YouTube URLs or video IDs</Label>
            <Textarea id="video-lines" autoFocus rows={8} value={text} onChange={event => updateDraft({ text: event.target.value })} placeholder={"https://youtu.be/VIDEO_ID\nVIDEO_ID"} />
            {enteredCount > 10 && <p className="track-limit-warning"><AlertTriangle className="size-3.5" />Only the first 10 entries will be processed.</p>}
          </div>

          {parsed.length > 0 && <ScrollArea className="track-parse-list">
            <div>
              {parsed.map((row, index) => {
                const duplicate = row.valid && seenIds.has(row.videoId)
                if (row.valid) seenIds.add(row.videoId)
                const result = row.valid && !duplicate ? rowStates[row.videoId] : null
                const state = !row.valid ? 'invalid' : duplicate ? 'duplicate' : result?.status || 'valid'
                const message = state === 'invalid'
                  ? 'Use an 11-character video ID or supported YouTube URL.'
                  : state === 'duplicate'
                    ? 'Duplicate; this release will be added once.'
                    : state === 'loading'
                      ? 'Fetching metadata...'
                      : state === 'success'
                        ? result.message
                        : state === 'error'
                          ? result.message
                          : 'Ready to fetch metadata.'
                return <div className="track-parse-row" data-state={state} key={row.value + '-' + index}>
                  <span className="track-parse-icon">{state === 'loading' ? <RefreshCw className="size-3.5 animate-spin" /> : state === 'success' || state === 'valid' ? <Check className="size-3.5" /> : state === 'duplicate' ? <Copy className="size-3.5" /> : <X className="size-3.5" />}</span>
                  <code>{row.videoId || row.value}</code>
                  <span>{message}</span>
                  {state === 'error' && <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => runRows([row])}><RefreshCw className="size-3" />Retry</Button>}
                </div>
              })}
            </div>
          </ScrollArea>}

          <div className="track-fields">
            <div className="space-y-2"><Label htmlFor="track-label">Custom label</Label><Input id="track-label" value={label} onChange={event => updateDraft({ label: event.target.value })} disabled={valid.length > 1} placeholder={valid.length > 1 ? 'Available for a single release' : 'Optional'} /></div>
            <div className="space-y-2"><Label htmlFor="track-tags">Tags</Label><Input id="track-tags" value={tags} onChange={event => updateDraft({ tags: event.target.value })} placeholder="artist, region, campaign" /></div>
            <div className="space-y-2"><Label htmlFor="track-interval">Poll interval</Label><Select value={interval} onValueChange={value => updateDraft({ interval: value })}><SelectTrigger id="track-interval" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="30">30 seconds</SelectItem><SelectItem value="60">1 minute</SelectItem><SelectItem value="120">2 minutes</SelectItem><SelectItem value="300">5 minutes</SelectItem></SelectContent></Select></div>
          </div>

          {!apiKey && <div className="track-api-notice"><AlertTriangle className="size-4" /><div><strong>API key required</strong><span>Your pasted releases will remain here while you configure and test the key.</span></div><Button type="button" size="sm" variant="outline" onClick={onSettings}>Configure</Button></div>}
        </div>

        <footer className="track-dialog-footer">
          <span className="metric">{successCount ? successCount + ' added / ' : ''}{valid.length} valid / {Math.min(enteredCount, 10)} entered</span>
          <div>
            <Button type="button" variant="ghost" onClick={onClose}>{successCount ? 'Close' : 'Cancel'}</Button>
            {allAdded
              ? <Button type="button" onClick={onClose}>Done</Button>
              : <Button disabled={!pendingRows.length || busy}>{busy ? 'Processing...' : failedCount ? 'Retry ' + failedCount + ' failed' : 'Track ' + (pendingRows.length || '') + ' release' + (pendingRows.length === 1 ? '' : 's')}</Button>}
          </div>
        </footer>
      </form>
    </DialogContent>
  </Dialog>
}