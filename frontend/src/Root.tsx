import { useEffect, useState } from 'react'
import App from './App.tsx'
import { getSession, SIGNED_OUT, type Profile } from './api'
import { ProfilePicker } from './ProfilePicker'

export function Root() {
  const [profile, setProfile] = useState<Profile | null>()

  useEffect(() => {
    async function loadSession() {
      try {
        setProfile(await getSession())
      } catch {
        setProfile(null)
      }
    }

    loadSession()
    const signedOut = () => setProfile(null)
    window.addEventListener(SIGNED_OUT, signedOut)
    return () => window.removeEventListener(SIGNED_OUT, signedOut)
  }, [])

  if (profile === undefined) {
    return null
  }

  if (!profile) {
    return <ProfilePicker onSignIn={setProfile} />
  }

  return <App key={profile.id} profile={profile} onSignOut={() => setProfile(null)} />
}
