const EAT_OFFSET_MS = 3 * 60 * 60 * 1000

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const pad = value => String(value).padStart(2, '0')
const eatDate = timestampMs => new Date(Number(timestampMs) + EAT_OFFSET_MS)

export function nowEAT() {
  return new Date().getTime()
}

export function formatTimeEAT(timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) return '-'
  const eat = eatDate(timestampMs)
  return `${pad(eat.getUTCHours())}:${pad(eat.getUTCMinutes())}`
}

export function formatDateTimeEAT(timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) return '-'
  const eat = eatDate(timestampMs)
  return `${MONTHS_SHORT[eat.getUTCMonth()]} ${eat.getUTCDate()}, ${formatTimeEAT(timestampMs)}`
}

export function formatDateEAT(timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) return '-'
  const eat = eatDate(timestampMs)
  return `${MONTHS_SHORT[eat.getUTCMonth()]} ${eat.getUTCDate()}`
}

export function formatDateFullEAT(timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) return '-'
  const eat = eatDate(timestampMs)
  return `${WEEKDAYS_LONG[eat.getUTCDay()]}, ${MONTHS_LONG[eat.getUTCMonth()]} ${eat.getUTCDate()}`
}

export function formatRelativeTime(timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) return 'Never updated'
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestampMs)) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function formatCountdown(futureTimestampMs) {
  const totalSeconds = Math.floor((Number(futureTimestampMs) - Date.now()) / 1000)
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '-'
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function getMidnightEAT(date = new Date()) {
  const shifted = new Date(date.getTime() + EAT_OFFSET_MS)
  return Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1, 0, 0, 0, 0) - EAT_OFFSET_MS
}
