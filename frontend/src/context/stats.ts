import { createContext, use } from 'react'
import type { Stats } from '../api'

type StatsState = {
  stats?: Stats
  refreshStats: () => Promise<void>
}

export const StatsContext = createContext<StatsState | null>(null)

export function useStats() {
  const stats = use(StatsContext)
  if (!stats) {
    throw new Error('useStats must be used inside StatsProvider')
  }

  return stats
}
