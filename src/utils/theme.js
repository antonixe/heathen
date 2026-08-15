// recharts sets SVG presentation attributes from JS, so the chart layer cannot use var() directly.
// Reading the same custom properties keeps :root the single source of truth rather than
// duplicating the palette as hex in two components.
const cache = new Map()

export function token(name) {
  if (!cache.has(name)) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (!value) return undefined          // stylesheet not applied yet; do not cache a miss
    cache.set(name, value)
  }
  return cache.get(name)
}

export const chart = () => ({
  amber: token('--amber'),
  green: token('--green'),
  blue: token('--blue'),
  coral: token('--coral'),
  grid: token('--chart-grid'),
  label: token('--text-4'),
  panel: token('--panel-raised'),
  border: token('--border'),
  text: token('--text'),
})
