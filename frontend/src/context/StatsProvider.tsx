import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getStats, type Stats } from '../api'
import { useErrors } from './errors'
import { StatsContext } from './stats'

export function StatsProvider({ children }: { children: ReactNode }) {
  const { reportError } = useErrors()
  const [stats, setStats] = useState<Stats>()

  const refreshStats = useCallback(async () => {
    try {
      setStats(await getStats())
    } catch (err) {
      reportError("Couldn't load storage usage", err)
    }
  }, [reportError])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- stats are set after the await
    refreshStats()
  }, [refreshStats])

  const value = useMemo(() => ({ stats, refreshStats }), [stats, refreshStats])
  return <StatsContext value={value}>{children}</StatsContext>
}
