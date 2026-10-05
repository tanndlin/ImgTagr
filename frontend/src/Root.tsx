import { useEffect, useState } from 'react'
import App from './App.tsx'
import { getSession, SIGNED_OUT, type Profile } from './api'
import { ProfilePicker } from './ProfilePicker'

export function Root() {
  const [profile, setProfile] = useState<Profile | null>()

  useEffect(() => {
    getSession()
      .then(setProfile)
      .catch(() => setProfile(null))
    const signedOut = () => setProfile(null)
    window.addEventListener(SIGNED_OUT, signedOut)
    return () => window.removeEventListener(SIGNED_OUT, signedOut)
  }, [])

  if (profile === undefined) return null
  if (!profile) return <ProfilePicker onSignIn={setProfile} />
  return <App key={profile.id} profile={profile} onSignOut={() => setProfile(null)} />
}
