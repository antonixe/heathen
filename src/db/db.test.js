import { describe, expect, it } from 'vitest'
import { normalizeDatabaseImport, settingsForExport } from './db.js'

const validExport = {
  videos: [{ videoId: 'abcdefghijk', status: 'active', addedAt: 1 }],
  datapoints: [{ videoId: 'abcdefghijk', timestamp: 1, viewCount: 100 }],
  milestones: [{ id: 1, videoId: 'abcdefghijk', targetCount: 1000, createdAt: 1 }],
  notes: [{ videoId: 'abcdefghijk', timestamp: 1, body: 'started' }],
  settings: [{ key: 'pollingPaused', value: false }],
}

describe('database import validation', () => {
  it('accepts older exports without poll events or prediction snapshots', () => {
    const normalized = normalizeDatabaseImport(validExport)
    expect(normalized.pollEvents).toEqual([])
    expect(normalized.predictionSnapshots).toEqual([])
  })

  it('rejects duplicate videos before import clears local data', () => {
    expect(() => normalizeDatabaseImport({ ...validExport, videos: [...validExport.videos, { videoId: 'abcdefghijk' }] })).toThrow(/Duplicate video id/)
  })

  it('rejects malformed datapoints', () => {
    expect(() => normalizeDatabaseImport({ ...validExport, datapoints: [{ videoId: 'abcdefghijk', timestamp: 'bad', viewCount: 100 }] })).toThrow(/Invalid datapoint/)
  })

  it('accepts prediction snapshots in newer exports', () => {
    const normalized = normalizeDatabaseImport({ ...validExport, predictionSnapshots: [{ videoId: 'abcdefghijk', milestoneId: 1, createdAt: 1, probability: 0.5 }] })
    expect(normalized.predictionSnapshots).toHaveLength(1)
  })

  it('rejects orphaned imported rows and unsupported schemas', () => {
    expect(() => normalizeDatabaseImport({ ...validExport, datapoints: [{ videoId: 'zzzzzzzzzzz', timestamp: 1, viewCount: 1 }] })).toThrow(/Orphaned datapoint/)
    expect(() => normalizeDatabaseImport({ ...validExport, schemaVersion: 99 })).toThrow(/newer unsupported schema/)
  })

  it('rejects duplicate primary ids before any tables are cleared', () => {
    expect(() => normalizeDatabaseImport({
      ...validExport,
      datapoints: [
        { id: 1, videoId: 'abcdefghijk', timestamp: 1, viewCount: 100 },
        { id: 1, videoId: 'abcdefghijk', timestamp: 2, viewCount: 120 },
      ],
    })).toThrow(/Duplicate datapoint id/)
  })
  it('redacts API credentials from backups unless explicitly requested', () => {
    const settings = [{ key: 'apiKey', value: 'secret' }, { key: 'githubToken', value: 'secret' }, { key: 'pollingPaused', value: false }]
    expect(settingsForExport(settings)).toEqual([{ key: 'pollingPaused', value: false }])
    expect(settingsForExport(settings, true)).toEqual(settings)
  })})
