import Dexie from 'dexie'

export const db = new Dexie('youtubeVelocityDesk')

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

export const POLL_INTERVALS = [[30, '30s'], [60, '1m'], [120, '2m'], [300, '5m']]

export const DEFAULT_SETTINGS = {
  apiKey: '', defaultPollInterval: 60, quotaUsedToday: 0,
  quotaResetDate: '', pollingPaused: false,
  // scheduled poller: when both are set the roster is pushed to it automatically
  syncUrl: '', syncToken: '',
}

export async function setSetting(key, value) {
  await db.settings.put({ key, value })
  return value
}

export async function getAllSettings() {
  const rows = await db.settings.toArray()
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map(row => [row.key, row.value])) }
}

export async function addObservation(videoId, viewCount, timestamp = Date.now()) {
  return db.transaction('rw', db.datapoints, db.videos, db.milestones, async () => {
    const previous = await db.datapoints.where('[videoId+timestamp]')
      .between([videoId, Dexie.minKey], [videoId, Dexie.maxKey]).last()
    const minutes = previous ? (timestamp - previous.timestamp) / 60000 : 0
    const delta = previous ? viewCount - previous.viewCount : 0
    const velocityPerMin = minutes > 0 ? delta / minutes : null
    const point = { videoId, timestamp, viewCount, delta, velocityPerMin }
    await db.datapoints.add(point)
    await db.videos.where('videoId').equals(videoId).modify({
      lastPolledAt: timestamp, lastViewCount: viewCount, pollState: 'polling', errorCode: null,
    })
    const crossed = await db.milestones.where('videoId').equals(videoId)
      .and(row => !row.hitAt && viewCount >= row.targetCount).toArray()
    if (crossed.length) await db.milestones.bulkUpdate(crossed.map(row => ({ key: row.id, changes: { hitAt: timestamp } })))
    return { point, crossed }
  })
}

export async function removeVideo({ id, videoId }) {
  return db.transaction('rw', db.videos, db.datapoints, db.notes, db.milestones, async () => {
    await db.videos.delete(id)
    await Promise.all([db.datapoints, db.notes, db.milestones].map(table => table.where('videoId').equals(videoId).delete()))
  })
}

export async function exportDatabase() {
  const [videos, datapoints, milestones, notes, settings] = await Promise.all([
    db.videos.toArray(), db.datapoints.toArray(), db.milestones.toArray(), db.notes.toArray(), db.settings.toArray(),
  ])
  return { schemaVersion: 2, exportedAt: new Date().toISOString(), videos, datapoints, milestones, notes, settings }
}

export async function importDatabase(payload) {
  const names = ['videos', 'datapoints', 'milestones', 'notes', 'settings']
  if (!payload || !names.every(name => Array.isArray(payload[name]))) throw new Error('Invalid Velocity Desk export.')
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map(table => table.clear()))
    for (const name of names) await db.table(name).bulkPut(payload[name])
  })
}
