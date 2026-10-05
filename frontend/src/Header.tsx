import { signOut, type Profile } from './api'
import { useErrors } from './context/errors'
import { useStats } from './context/stats'

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exp = Math.min(Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${value.toFixed(exp && value < 10 ? 1 : 0)} ${units[exp]}`
}

type Props = {
  profile: Profile
  onSignOut: () => void
}

export function Header({ profile, onSignOut }: Props) {
  const { stats } = useStats()
  const { reportError } = useErrors()

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
        <span className="stats">
          {stats.image_count.toLocaleString()} {stats.image_count === 1 ? 'image' : 'images'} ·{' '}
          {formatBytes(stats.total_bytes)}
        </span>
      )}
      <button
        type="button"
        className="switch-profile"
        title="Switch profile"
        onClick={switchProfile}
      >
        {profile.name}
      </button>
    </header>
  )
}
