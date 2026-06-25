import { useLiveQuery } from 'dexie-react-hooks'
import { db, getAllSettings, setSetting } from '../db/db.js'

export const pacificDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date)

export async function incrementQuota(units = 1) {
  const today = pacificDate()
  return db.transaction('rw', db.settings, async () => {
    const savedDate = (await db.settings.get('quotaResetDate'))?.value
    const used = savedDate === today ? Number((await db.settings.get('quotaUsedToday'))?.value || 0) : 0
    await db.settings.bulkPut([{ key: 'quotaResetDate', value: today }, { key: 'quotaUsedToday', value: used + units }])
    return used + units
  })
}

export function useQuota() {
  const settings = useLiveQuery(() => getAllSettings(), [], null)
  const today = pacificDate()
  const used = settings?.quotaResetDate === today ? Number(settings.quotaUsedToday || 0) : 0
  if (settings && settings.quotaResetDate !== today) {
    setSetting('quotaResetDate', today); setSetting('quotaUsedToday', 0)
  }
  return { used, limit: 10000, ratio: used / 10000 }
}
