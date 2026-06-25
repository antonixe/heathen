import { useEffect, useRef, useState } from 'react'

export default function AnimatedCount({ value }) {
  const [display, setDisplay] = useState(value ?? 0)
  const [pulsing, setPulsing] = useState(false)
  const previous = useRef(value ?? 0)

  useEffect(() => {
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
    const startValue = previous.current
    let frame, pulseFrame, pulseTimer

    if (startValue !== value && !reducedMotion) {
      setPulsing(false)
      pulseFrame = requestAnimationFrame(() => setPulsing(true))
      pulseTimer = setTimeout(() => setPulsing(false), 800)
    }

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
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(pulseFrame)
      clearTimeout(pulseTimer)
    }
  }, [value])

  return <span className={`animated-count${pulsing ? ' is-pulsing' : ''}`}>{Number(display || 0).toLocaleString()}</span>
}
