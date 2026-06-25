import { useEffect } from 'react'

export function useKeyboard(handlers) {
  useEffect(() => {
    const listener = event => {
      if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
      const key = event.key.toLowerCase()
      if (handlers[key]) { event.preventDefault(); handlers[key]() }
      if (/^[1-9]$/.test(key)) document.querySelector(`[data-tile-index="${Number(key) - 1}"]`)?.focus()
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [handlers])
}
