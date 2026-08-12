// 3 significant digits, else a 7-figure range collapses to "1M–1M"
export const compact = value => Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 }).format(value)

// a decimal is false precision past a few hundred views/min, and separators make 11236 scannable
export const metric = value => value === null || value === undefined ? '—'
  : Math.abs(value) >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1)

export const age = timestamp => {
  if (!timestamp) return 'Never updated'
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  return seconds < 60 ? `Updated ${seconds}s ago` : `Updated ${Math.floor(seconds / 60)}m ago`
}
