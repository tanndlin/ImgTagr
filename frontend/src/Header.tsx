import { useState } from 'react'
import { signOut, type Profile } from './api'
import { useErrors } from './context/errors'
import { useStats } from './context/stats'
import { formatBytes } from './format'
import { InfoDialog } from './InfoDialog'

type Props = {
  profile: Profile
  onSignOut: () => void
}

export function Header({ profile, onSignOut }: Props) {
  const { stats } = useStats()
  const { reportError } = useErrors()
  const [showInfo, setShowInfo] = useState(false)

  async function switchProfile() {
    try {
      await signOut()
      onSignOut()
    } catch (err) {
      reportError("Couldn't sign out", err)
    }
  }

  return (
    <header>
      <h1>ImgTagr</h1>
      {stats && (
        <button
          type="button"
          className="stats"
          title="Storage info"
          onClick={() => setShowInfo(true)}
        >
          {stats.image_count.toLocaleString()} {stats.image_count === 1 ? 'image' : 'images'} ·{' '}
          {formatBytes(stats.total_bytes)}
        </button>
      )}
      <button
        type="button"
        className="switch-profile"
        title="Switch profile"
        onClick={switchProfile}
      >
        {profile.name}
      </button>
      {showInfo && <InfoDialog onClose={() => setShowInfo(false)} />}
    </header>
  )
}
