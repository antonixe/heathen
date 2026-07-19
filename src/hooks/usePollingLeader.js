import { useEffect, useMemo, useRef, useState } from 'react'

const LOCK_KEY = 'velocityDesk.pollingOwner'
const HEARTBEAT_MS = 4000
const TTL_MS = 12000

function readOwner() {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeOwner(owner) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(owner))
    return true
  } catch {
    return false
  }
}

function removeOwner(ownerId) {
  try {
    const owner = readOwner()
    if (owner?.id === ownerId) localStorage.removeItem(LOCK_KEY)
  } catch {}
}

export function usePollingLeader(enabled) {
  const ownerId = useMemo(() => crypto.randomUUID(), [])
  const [isLeader, setIsLeader] = useState(false)
  const isLeaderRef = useRef(false)

  useEffect(() => {
    isLeaderRef.current = isLeader
  }, [isLeader])

  useEffect(() => {
    if (!enabled) {
      removeOwner(ownerId)
      setIsLeader(false)
      return undefined
    }

    const claim = () => {
      const now = Date.now()
      const owner = readOwner()
      const canClaim = !owner || owner.id === ownerId || Number(owner.expiresAt || 0) < now
      if (!canClaim) {
        setIsLeader(false)
        return false
      }
      const nextOwner = { id: ownerId, updatedAt: now, expiresAt: now + TTL_MS }
      if (!writeOwner(nextOwner)) {
        setIsLeader(true)
        return true
      }
      const confirmed = readOwner()
      const owns = confirmed?.id === ownerId
      setIsLeader(owns)
      return owns
    }

    const heartbeat = () => {
      if (document.visibilityState === 'hidden' && !isLeaderRef.current) return
      claim()
    }

    claim()
    const timer = setInterval(heartbeat, HEARTBEAT_MS)
    const onStorage = event => { if (event.key === LOCK_KEY) claim() }
    const onVisibility = () => claim()
    const onUnload = () => removeOwner(ownerId)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onUnload)

    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onUnload)
      removeOwner(ownerId)
    }
  }, [enabled, ownerId])

  return isLeader
}
