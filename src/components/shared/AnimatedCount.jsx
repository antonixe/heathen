import { useEffect, useRef, useState } from 'react'

export default function AnimatedCount({ value }) {
  const [display, setDisplay] = useState(value ?? 0)
  const previous = useRef(value ?? 0)
  const mounted = useRef(value ?? 0)

  useEffect(() => {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const startValue = previous.current
    let frame

    if (reducedMotion) {
      setDisplay(value)
      previous.current = value
      return undefined
    }

    const started = performance.now()
    const tick = now => {
      const progress = Math.min(1, (now - started) / 1200)
      const eased = 1 - Math.pow(2, -10 * progress)
      setDisplay(Math.round(startValue + (value - startValue) * (progress === 1 ? 1 : eased)))
      if (progress < 1) frame = requestAnimationFrame(tick)
      else previous.current = value
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value])

  // remounting on a new value restarts the CSS ring animation; no timers needed
  return <span className="animated-count">{value !== mounted.current && <i className="pulse-ring" key={value} aria-hidden="true" />}{Number(display || 0).toLocaleString()}</span>
}
