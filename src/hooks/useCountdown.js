import { useEffect, useState } from 'react'
import { formatCountdown } from '../utils/time.js'

const EMPTY_COUNTDOWN = '\u2014'
const PASSED_COUNTDOWN = 'DEADLINE PASSED'

const getCountdown = deadlineMs => {
  if (deadlineMs === null || deadlineMs === undefined) return EMPTY_COUNTDOWN
  const timestamp = Number(deadlineMs)
  if (!Number.isFinite(timestamp)) return EMPTY_COUNTDOWN
  if (timestamp <= Date.now()) return PASSED_COUNTDOWN
  return formatCountdown(timestamp)
}

export default function useCountdown(deadlineMs) {
  const [countdown, setCountdown] = useState(() => getCountdown(deadlineMs))

  useEffect(() => {
    setCountdown(getCountdown(deadlineMs))

    const timestamp = Number(deadlineMs)
    if (!Number.isFinite(timestamp) || timestamp <= Date.now()) return undefined

    const timer = setInterval(() => {
      if (timestamp <= Date.now()) {
        setCountdown(PASSED_COUNTDOWN)
        clearInterval(timer)
        return
      }
      setCountdown(formatCountdown(timestamp))
    }, 1000)

    return () => clearInterval(timer)
  }, [deadlineMs])

  return countdown
}
