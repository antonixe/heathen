import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'velocityDesk.theme'

const readStoredTheme = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

const systemPrefersDark = () => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

const resolve = theme => theme === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : theme

const apply = resolved => {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export function useTheme() {
  const [theme, setThemeState] = useState(readStoredTheme)
  const [resolved, setResolved] = useState(() => resolve(readStoredTheme()))

  useEffect(() => {
    if (theme !== 'system') return undefined
    let media
    try { media = window.matchMedia('(prefers-color-scheme: dark)') } catch { return undefined }
    const onChange = event => {
      const next = event.matches ? 'dark' : 'light'
      setResolved(next)
      apply(next)
    }
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [theme])

  const setTheme = useCallback(next => {
    setThemeState(next)
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, next)
    } catch {}
    const nextResolved = resolve(next)
    setResolved(nextResolved)
    apply(nextResolved)
  }, [])

  return { theme, resolved, setTheme }
}
