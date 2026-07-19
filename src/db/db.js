import Dexie from 'dexie'
import { getMilestoneProbability } from '../utils/probability.js'
import { buildVideoSummary } from '../utils/summary.js'

export const db = new Dexie('youtubeVelocityDesk')

const finite = value => Number.isFinite(Number(value))
const numberOrNull = value => finite(value) ? Number(value) : null

db.version(1).stores({
  videos: '++id, &videoId, status, addedAt',
  datapoints: '++id, videoId, timestamp, [videoId+timestamp]',
  milestones: '++id, videoId, hitAt, createdAt',
  notes: '++id, videoId, timestamp',
  settings: '&key',
})

db.version(2).stores({
  videos: '++id, &videoId, status, addedAt, lastPolledAt',
  datapoints: '++id, videoId, timestamp, [videoId+timestamp]',
  milestones: '++id, videoId, hitAt, createdAt',
  notes: '++id, videoId, timestamp',
  settings: '&key',
}).upgrade(tx => tx.table('videos').toCollection().modify(video => {
  video.pollState ??= 'idle'
  video.pollInterval ??= 60
  video.tags ??= []
}))

db.version(3).stores({
  videos: '++id, &videoId, status, addedAt, lastPolledAt, poll_mode',
  datapoints: '++id, videoId, timestamp, [videoId+timestamp]',
  milestones: '++id, videoId, hitAt, createdAt',
  notes: '++id, videoId, timestamp',
  settings: '&key',
}).upgrade(tx => tx.table('videos').toCollection().modify(video => {
  video.poll_mode ??= 'adaptive'
  video.fixed_interval_ms ??= null
}))

db.version(4).stores({
  videos: '++id, &videoId, status, addedAt, lastPolledAt, poll_mode, pollState, nextPollAt',
  datapoints: '++id, videoId, timestamp, [videoId+timestamp]',
  milestones: '++id, videoId, hitAt, createdAt',
  notes: '++id, videoId, timestamp',
  settings: '&key',
  pollEvents: '++id, timestamp, videoId, type, code',
}).upgrade(tx => tx.table('videos').toCollection().modify(video => {
  video.firstSampleAt ??= null
  video.firstViewCount ??= null
  video.sampleCount ??= null
  video.sessionGain ??= null
  video.sessionAvg ??= null
  video.peakVelocity ??= null
  video.velocity5m ??= null
  video.velocity30m ??= null
  video.velocity1h ??= null
  video.velocity3h ??= null
  video.velocity6h ??= null
  video.summaryUpdatedAt ??= null
}))

db.version(5).stores({
  videos: '++id, &videoId, status, addedAt, lastPolledAt, poll_mode, pollState, nextPollAt, publishedAt, channelName',
  datapoints: '++id, videoId, timestamp, [videoId+timestamp]',
  milestones: '++id, videoId, hitAt, createdAt, deadlineTimestamp',
  notes: '++id, videoId, timestamp',
  settings: '&key',
  pollEvents: '++id, timestamp, videoId, type, code',
  predictionSnapshots: '++id, videoId, milestoneId, createdAt, deadlineTimestamp, resolvedAt, outcome',
}).upgrade(tx => tx.table('videos').toCollection().modify(video => {
  video.publishedAt ??= null
  video.lastLikeCount ??= null
  video.lastCommentCount ??= null
  video.accelerationScore ??= 0
  video.accelerationLabel ??= 'flat'
  video.engagementLift ??= 0
  video.likeVelocity ??= null
  video.commentVelocity ??= null
}))

export const DEFAULT_SETTINGS = {
  apiKey: '', githubToken: '', defaultPollInterval: 60, quotaUsedToday: 0,
  quotaResetDate: '', pollingPaused: false,
  adaptive_polling_enabled: true,
  threshold_surge: 80,
  threshold_active: 20,
  threshold_slow: 5,
  lastBackupAt: null,
  backupReminderDays: 7,
}

export async function getSetting(key) {
  return (await db.settings.get(key))?.value ?? DEFAULT_SETTINGS[key]
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value })
  return value
}

export async function getAllSettings() {
  const rows = await db.settings.toArray()
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map(row => [row.key, row.value])) }
}

async function getWindowPoints(videoId, timestamp = Date.now(), hours = 6) {
  const cutoff = timestamp - hours * 60 * 60 * 1000
  const previous = await db.datapoints.where('[videoId+timestamp]')
    .between([videoId, Dexie.minKey], [videoId, cutoff], true, false).last()
  const recent = await db.datapoints.where('[videoId+timestamp]')
    .between([videoId, cutoff], [videoId, Dexie.maxKey]).toArray()
  return previous ? [previous, ...recent] : recent
}

export async function refreshVideoVelocitySummary(videoId) {
  const video = await db.videos.where('videoId').equals(videoId).first()
  if (!video?.lastPolledAt) return null
  const points = await getWindowPoints(videoId, video.lastPolledAt)
  const windowSummary = buildVideoSummary(points, video)
  const first = video.firstSampleAt ? null : await db.datapoints.where('[videoId+timestamp]')
    .between([videoId, Dexie.minKey], [videoId, Dexie.maxKey]).first()
  const firstSampleAt = video.firstSampleAt ?? first?.timestamp ?? windowSummary.firstSampleAt
  const firstViewCount = video.firstViewCount ?? first?.viewCount ?? windowSummary.firstViewCount
  const elapsedMinutes = firstSampleAt && video.lastPolledAt ? (video.lastPolledAt - firstSampleAt) / 60000 : 0
  const sessionGain = Number.isFinite(Number(video.lastViewCount)) && Number.isFinite(Number(firstViewCount))
    ? Number(video.lastViewCount) - Number(firstViewCount)
    : windowSummary.sessionGain
  const changes = {
    ...windowSummary,
    firstSampleAt,
    firstViewCount,
    sessionGain,
    sampleCount: Number(video.sampleCount ?? windowSummary.sampleCount),
    sessionAvg: elapsedMinutes > 0 ? sessionGain / elapsedMinutes : null,
    publishedAt: video.publishedAt ?? points.find(point => point.publishedAt)?.publishedAt ?? null,
    summaryUpdatedAt: Date.now(),
  }
  await db.videos.where('videoId').equals(videoId).modify(changes)
  return changes
}

export async function rebuildVideoSummary(videoId) {
  const [video, points] = await Promise.all([
    db.videos.where('videoId').equals(videoId).first(),
    db.datapoints.where('[videoId+timestamp]').between([videoId, Dexie.minKey], [videoId, Dexie.maxKey]).toArray(),
  ])
  if (!video) return null
  const summary = buildVideoSummary(points, video)
  await db.videos.where('videoId').equals(videoId).modify({ ...summary, publishedAt: video.publishedAt ?? points.find(point => point.publishedAt)?.publishedAt ?? null })
  return summary
}

export async function rebuildAllVideoSummaries() {
  const videos = await db.videos.toArray()
  const results = []
  for (const video of videos) results.push(await rebuildVideoSummary(video.videoId))
  return results
}

async function resolvePredictionSnapshots(milestoneId, outcome, timestamp, actualCount) {
  if (!milestoneId) return 0
  const rows = await db.predictionSnapshots.where('milestoneId').equals(milestoneId).and(row => !row.resolvedAt).toArray()
  if (!rows.length) return 0
  await db.predictionSnapshots.bulkUpdate(rows.map(row => ({ key: row.id, changes: { resolvedAt: timestamp, outcome, actualCount } })))
  return rows.length
}

export async function recordPredictionSnapshotsForVideo(videoId, timestamp = Date.now()) {
  const [video, points, milestones, peerVideos] = await Promise.all([
    db.videos.where('videoId').equals(videoId).first(),
    db.datapoints.where('[videoId+timestamp]').between([videoId, Dexie.minKey], [videoId, Dexie.maxKey]).toArray(),
    db.milestones.where('videoId').equals(videoId).toArray(),
    db.videos.toArray(),
  ])
  if (!video || points.length < 2) return []
  const active = milestones.filter(row => row.deadlineTimestamp && !row.hitAt && row.deadlineTimestamp > timestamp)
  const created = []
  for (const milestone of active) {
    const probability = getMilestoneProbability(points, milestone.targetCount, milestone.deadlineTimestamp, { now: timestamp, video, peerVideos })
    if (!probability) continue
    const recent = await db.predictionSnapshots.where('milestoneId').equals(milestone.id).last()
    if (recent && timestamp - recent.createdAt < 30 * 60 * 1000 && Math.abs(Number(recent.probability) - probability.probability) < 0.05) continue
    const row = {
      videoId,
      milestoneId: milestone.id,
      createdAt: timestamp,
      deadlineTimestamp: milestone.deadlineTimestamp,
      targetCount: milestone.targetCount,
      currentViewCount: points.at(-1).viewCount,
      probability: probability.probability,
      confidence: probability.confidence,
      confidenceScore: probability.confidenceScore,
      projectedAtDeadline: probability.projectedAtDeadline,
      projectedLow: probability.projectedRange?.low,
      projectedHigh: probability.projectedRange?.high,
      requiredVelocity: probability.requiredVelocity,
      currentVelocity: probability.currentVelocity,
      reasons: probability.reasons || [],
      resolvedAt: null,
      outcome: null,
    }
    await db.predictionSnapshots.add(row)
    created.push(row)
  }
  return created
}

export async function addObservation(videoId, viewCount, timestamp = Date.now(), metadata = {}) {
  if (typeof videoId !== 'string' || !videoId.trim()) throw new Error('A valid video id is required.')
  if (!finite(viewCount) || Number(viewCount) < 0) throw new Error('View count must be a non-negative number.')
  if (!finite(timestamp) || Number(timestamp) <= 0) throw new Error('Observation timestamp is invalid.')
  viewCount = Number(viewCount)
  timestamp = Number(timestamp)
  const likeCount = numberOrNull(metadata.likeCount)
  const commentCount = numberOrNull(metadata.commentCount)
  const publishedAt = numberOrNull(metadata.publishedAt)
  const result = await db.transaction('rw', db.datapoints, db.videos, db.milestones, async () => {
    const trackedVideo = await db.videos.where('videoId').equals(videoId).first()
    if (!trackedVideo) throw new Error('Cannot add an observation for a removed track.')
    const previous = await db.datapoints.where('[videoId+timestamp]')
      .between([videoId, Dexie.minKey], [videoId, Dexie.maxKey]).last()
    const minutes = previous ? (timestamp - previous.timestamp) / 60000 : 0
    const delta = previous ? viewCount - previous.viewCount : 0
    const likeDelta = previous && likeCount !== null && previous.likeCount !== null && previous.likeCount !== undefined ? likeCount - Number(previous.likeCount) : null
    const commentDelta = previous && commentCount !== null && previous.commentCount !== null && previous.commentCount !== undefined ? commentCount - Number(previous.commentCount) : null
    const velocityPerMin = minutes > 0 ? delta / minutes : null
    const likeVelocityPerMin = minutes > 0 && likeDelta !== null ? likeDelta / minutes : null
    const commentVelocityPerMin = minutes > 0 && commentDelta !== null ? commentDelta / minutes : null
    const point = { videoId, timestamp, viewCount, delta, velocityPerMin, likeCount, commentCount, likeDelta, commentDelta, likeVelocityPerMin, commentVelocityPerMin, publishedAt }
    await db.datapoints.add(point)
    await db.videos.where('videoId').equals(videoId).modify(video => {
      const firstSampleAt = video.firstSampleAt ?? timestamp
      const firstViewCount = video.firstViewCount ?? viewCount
      const elapsedMinutes = (timestamp - firstSampleAt) / 60000
      video.lastPolledAt = timestamp
      video.lastViewCount = viewCount
      video.lastLikeCount = likeCount ?? video.lastLikeCount ?? null
      video.lastCommentCount = commentCount ?? video.lastCommentCount ?? null
      video.publishedAt = publishedAt ?? video.publishedAt ?? null
      video.firstSampleAt = firstSampleAt
      video.firstViewCount = firstViewCount
      video.sampleCount = Number(video.sampleCount || 0) + 1
      video.sessionGain = viewCount - firstViewCount
      video.sessionAvg = elapsedMinutes > 0 ? (viewCount - firstViewCount) / elapsedMinutes : null
      if (velocityPerMin !== null) video.peakVelocity = Math.max(Number(video.peakVelocity ?? velocityPerMin), velocityPerMin)
      video.summaryUpdatedAt = Date.now()
      if (video.pollState !== 'paused') video.pollState = 'polling'
      video.errorCode = null
      video.errorMessage = null
    })
    const crossed = await db.milestones.where('videoId').equals(videoId)
      .and(row => !row.hitAt && viewCount >= row.targetCount).toArray()
    if (crossed.length) await db.milestones.bulkUpdate(crossed.map(row => ({ key: row.id, changes: { hitAt: timestamp, actualCount: viewCount } })))
    const missed = await db.milestones.where('videoId').equals(videoId)
      .and(row => !row.hitAt && row.deadlineTimestamp && row.deadlineTimestamp <= timestamp && viewCount < row.targetCount).toArray()
    if (missed.length) await db.milestones.bulkUpdate(missed.map(row => ({ key: row.id, changes: { actualCount: viewCount } })))
    return { point, crossed, missed }
  })
  await refreshVideoVelocitySummary(videoId).catch(() => {})
  for (const milestone of result.crossed) await resolvePredictionSnapshots(milestone.id, 'hit', timestamp, viewCount).catch(() => {})
  for (const milestone of result.missed) await resolvePredictionSnapshots(milestone.id, 'missed', timestamp, viewCount).catch(() => {})
  await recordPredictionSnapshotsForVideo(videoId, timestamp).catch(() => {})
  return result
}

export async function deleteMilestoneData(milestoneId) {
  if (!finite(milestoneId)) return
  await db.transaction('rw', db.milestones, db.predictionSnapshots, async () => {
    await db.milestones.delete(Number(milestoneId))
    await db.predictionSnapshots.where('milestoneId').equals(Number(milestoneId)).delete()
  })
}

export async function updateMilestoneData(milestoneId, changes = {}) {
  if (!finite(milestoneId)) throw new Error('Milestone id is invalid.')
  const targetCount = numberOrNull(changes.targetCount)
  if (targetCount === null || targetCount <= 0) throw new Error('Target views must be greater than zero.')
  const deadlineTimestamp = changes.deadlineTimestamp === null || changes.deadlineTimestamp === undefined
    ? null
    : numberOrNull(changes.deadlineTimestamp)
  if (changes.deadlineTimestamp !== null && changes.deadlineTimestamp !== undefined && deadlineTimestamp === null) throw new Error('Milestone deadline is invalid.')

  await db.transaction('rw', db.milestones, db.predictionSnapshots, async () => {
    const milestone = await db.milestones.get(Number(milestoneId))
    if (!milestone) throw new Error('Milestone no longer exists.')
    if (milestone.hitAt || (milestone.deadlineTimestamp && Number(milestone.deadlineTimestamp) <= Date.now())) throw new Error('Completed milestone history cannot be edited.')
    await db.milestones.update(Number(milestoneId), { targetCount, deadlineTimestamp })
    await db.predictionSnapshots.where('milestoneId').equals(Number(milestoneId)).delete()
  })
}

export async function deleteVideoData(videoId) {
  if (typeof videoId !== 'string' || !videoId) return
  await db.transaction('rw', db.videos, db.datapoints, db.milestones, db.notes, db.pollEvents, db.predictionSnapshots, async () => {
    await Promise.all([
      db.videos.where('videoId').equals(videoId).delete(),
      db.datapoints.where('videoId').equals(videoId).delete(),
      db.milestones.where('videoId').equals(videoId).delete(),
      db.notes.where('videoId').equals(videoId).delete(),
      db.pollEvents.where('videoId').equals(videoId).delete(),
      db.predictionSnapshots.where('videoId').equals(videoId).delete(),
    ])
  })
}

const SECRET_SETTINGS = new Set(['apiKey', 'githubToken'])

export function settingsForExport(settings, includeSecrets = false) {
  return includeSecrets ? settings : settings.filter(row => !SECRET_SETTINGS.has(row.key))
}

export async function exportDatabase({ includeSecrets = false } = {}) {
  const [videos, datapoints, milestones, notes, settings, pollEvents, predictionSnapshots] = await Promise.all([
    db.videos.toArray(), db.datapoints.toArray(), db.milestones.toArray(), db.notes.toArray(), db.settings.toArray(), db.pollEvents.toArray(), db.predictionSnapshots.toArray(),
  ])
  const exportedSettings = settingsForExport(settings, includeSecrets)
  return {
    schemaVersion: 5,
    exportedAt: new Date().toISOString(),
    secretsIncluded: includeSecrets,
    videos,
    datapoints,
    milestones,
    notes,
    settings: exportedSettings,
    pollEvents,
    predictionSnapshots,
  }
}

const requireArray = (payload, name, optional = false) => {
  if (optional && payload[name] === undefined) return []
  if (!Array.isArray(payload[name])) throw new Error(`Invalid Velocity Desk export: ${name} must be an array.`)
  return payload[name]
}

const assertUniquePrimaryIds = (rows, name) => {
  const ids = new Set()
  rows.forEach((row, index) => {
    if (row.id === undefined || row.id === null) return
    if (!finite(row.id) || Number(row.id) <= 0) throw new Error('Invalid ' + name + ' id at index ' + index + '.')
    const id = Number(row.id)
    if (ids.has(id)) throw new Error('Duplicate ' + name + ' id in import: ' + id + '.')
    ids.add(id)
  })
}

export function normalizeDatabaseImport(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Velocity Desk export.')
  if (payload.schemaVersion !== undefined && (!finite(payload.schemaVersion) || Number(payload.schemaVersion) > 5)) {
    throw new Error('This backup uses a newer unsupported schema version.')
  }

  const videos = requireArray(payload, 'videos')
  const datapoints = requireArray(payload, 'datapoints')
  const milestones = requireArray(payload, 'milestones')
  const notes = requireArray(payload, 'notes')
  const settings = requireArray(payload, 'settings')
  const pollEvents = requireArray(payload, 'pollEvents', true)
  const predictionSnapshots = requireArray(payload, 'predictionSnapshots', true)
  const totalRows = videos.length + datapoints.length + milestones.length + notes.length + settings.length + pollEvents.length + predictionSnapshots.length
  if (totalRows > 2000000) throw new Error('Backup contains too many rows to import safely.')

  ;[
    ['video', videos],
    ['datapoint', datapoints],
    ['milestone', milestones],
    ['note', notes],
    ['poll event', pollEvents],
    ['prediction snapshot', predictionSnapshots],
  ].forEach(([name, rows]) => assertUniquePrimaryIds(rows, name))

  const videoIds = new Set()
  videos.forEach((video, index) => {
    if (!video || typeof video !== 'object' || typeof video.videoId !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(video.videoId)) throw new Error('Invalid video row at index ' + index + '.')
    if (videoIds.has(video.videoId)) throw new Error('Duplicate video id in import: ' + video.videoId + '.')
    videoIds.add(video.videoId)
  })

  const requireVideo = (videoId, type, index) => {
    if (typeof videoId !== 'string' || !videoIds.has(videoId)) throw new Error('Orphaned ' + type + ' row at index ' + index + '.')
  }

  datapoints.forEach((point, index) => {
    requireVideo(point?.videoId, 'datapoint', index)
    if (!point || typeof point !== 'object' || !finite(point.timestamp) || Number(point.timestamp) <= 0 || !finite(point.viewCount) || Number(point.viewCount) < 0) throw new Error('Invalid datapoint row at index ' + index + '.')
  })

  const milestoneIds = new Set()
  milestones.forEach((row, index) => {
    requireVideo(row?.videoId, 'milestone', index)
    if (!row || typeof row !== 'object' || !finite(row.targetCount) || Number(row.targetCount) <= 0) throw new Error('Invalid milestone row at index ' + index + '.')
    if (finite(row.id)) milestoneIds.add(Number(row.id))
  })

  notes.forEach((row, index) => {
    requireVideo(row?.videoId, 'note', index)
    if (!row || typeof row !== 'object' || !finite(row.timestamp) || typeof row.body !== 'string') throw new Error('Invalid note row at index ' + index + '.')
  })

  const settingKeys = new Set()
  settings.forEach((row, index) => {
    if (!row || typeof row !== 'object' || typeof row.key !== 'string' || !row.key) throw new Error('Invalid setting row at index ' + index + '.')
    if (settingKeys.has(row.key)) throw new Error('Duplicate setting key in import: ' + row.key + '.')
    settingKeys.add(row.key)
  })

  pollEvents.forEach((row, index) => {
    if (!row || typeof row !== 'object' || !finite(row.timestamp) || typeof row.type !== 'string') throw new Error('Invalid poll event row at index ' + index + '.')
  })

  predictionSnapshots.forEach((row, index) => {
    requireVideo(row?.videoId, 'prediction snapshot', index)
    if (!row || typeof row !== 'object' || !finite(row.createdAt) || !finite(row.probability) || Number(row.probability) < 0 || Number(row.probability) > 1) throw new Error('Invalid prediction snapshot row at index ' + index + '.')
    if (!finite(row.milestoneId) || !milestoneIds.has(Number(row.milestoneId))) throw new Error('Orphaned prediction milestone at index ' + index + '.')
  })

  return { videos, datapoints, milestones, notes, settings, pollEvents, predictionSnapshots }
}
export async function importDatabase(payload) {
  const normalized = normalizeDatabaseImport(payload)
  const names = ['videos', 'datapoints', 'milestones', 'notes', 'settings', 'pollEvents', 'predictionSnapshots']
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map(table => table.clear()))
    for (const name of names) await db.table(name).bulkPut(normalized[name])
  })
  await rebuildAllVideoSummaries()
}

export async function recordPollEvent(event = {}) {
  const row = {
    timestamp: Date.now(),
    videoId: event.videoId ?? null,
    type: event.type || 'event',
    code: event.code ?? null,
    message: event.message || '',
    quotaUnits: Number(event.quotaUnits || 0),
    details: event.details || null,
  }
  await db.pollEvents.add(row)
  const staleKeys = await db.pollEvents.orderBy('timestamp').reverse().offset(500).primaryKeys()
  if (staleKeys.length) await db.pollEvents.bulkDelete(staleKeys)
  return row
}

export async function markBackupComplete(timestamp = Date.now()) {
  await setSetting('lastBackupAt', timestamp)
  await recordPollEvent({ type: 'backup', message: 'Database export downloaded.' }).catch(() => {})
  return timestamp
}


async function recalculateDerivedPoints(videoId) {
  const points = await db.datapoints.where('[videoId+timestamp]')
    .between([videoId, Dexie.minKey], [videoId, Dexie.maxKey]).toArray()
  const updates = points.map((point, index) => {
    const previous = points[index - 1]
    const minutes = previous ? (Number(point.timestamp) - Number(previous.timestamp)) / 60000 : 0
    const delta = previous ? Number(point.viewCount) - Number(previous.viewCount) : 0
    const likeDelta = previous && finite(point.likeCount) && finite(previous.likeCount) ? Number(point.likeCount) - Number(previous.likeCount) : null
    const commentDelta = previous && finite(point.commentCount) && finite(previous.commentCount) ? Number(point.commentCount) - Number(previous.commentCount) : null
    return {
      ...point,
      delta,
      velocityPerMin: minutes > 0 ? delta / minutes : null,
      likeDelta,
      commentDelta,
      likeVelocityPerMin: minutes > 0 && likeDelta !== null ? likeDelta / minutes : null,
      commentVelocityPerMin: minutes > 0 && commentDelta !== null ? commentDelta / minutes : null,
    }
  })
  if (updates.length) await db.datapoints.bulkPut(updates)
}
export async function compactHistory({ olderThanDays = 14, bucketMinutes = 60 } = {}) {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  const bucketMs = Math.max(5, Number(bucketMinutes) || 60) * 60000
  const videos = await db.videos.toArray()
  let deleted = 0
  let kept = 0

  for (const video of videos) {
    const oldPoints = await db.datapoints.where('[videoId+timestamp]')
      .between([video.videoId, Dexie.minKey], [video.videoId, cutoff], true, false).toArray()
    if (oldPoints.length < 3) continue
    const keepIds = new Set([oldPoints[0].id, oldPoints.at(-1).id])
    const buckets = new Map()
    oldPoints.forEach(point => buckets.set(Math.floor(Number(point.timestamp) / bucketMs), point))
    buckets.forEach(point => keepIds.add(point.id))
    const deleteIds = oldPoints.filter(point => !keepIds.has(point.id)).map(point => point.id)
    if (deleteIds.length) {
      await db.datapoints.bulkDelete(deleteIds)
      deleted += deleteIds.length
    }
    kept += keepIds.size
    await recalculateDerivedPoints(video.videoId)
    await rebuildVideoSummary(video.videoId)
  }

  await recordPollEvent({ type: 'compact', message: `Compacted ${deleted} old samples.`, details: { olderThanDays, bucketMinutes, deleted, kept } }).catch(() => {})
  return { deleted, kept, olderThanDays, bucketMinutes }
}
