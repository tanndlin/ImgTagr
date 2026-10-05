import { useEffect, useState, type FormEvent } from 'react'
import { createProfile, listProfiles, signIn, type Profile } from './api'
import { message } from './message'

type Props = {
  onSignIn: (profile: Profile) => void
}

export function ProfilePicker({ onSignIn }: Props) {
  const [profiles, setProfiles] = useState<Profile[]>()
  const [chosen, setChosen] = useState<Profile | 'new'>()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const creating = chosen === 'new' || profiles?.length === 0

  useEffect(() => {
    async function loadProfiles() {
      try {
        setProfiles(await listProfiles())
      } catch (err) {
        setError(`Couldn't load profiles: ${message(err)}`)
      }
    }

    loadProfiles()
  }, [])

  function choose(next: Profile | 'new' | undefined) {
    setChosen(next)
    setPassword('')
    setError(undefined)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      onSignIn(
        creating
          ? await createProfile(name, password)
          : await signIn((chosen as Profile).id, password),
      )
    } catch (err) {
      setError(message(err))
      setBusy(false)
    }
  }

  if (!profiles) {
    return <main className="profiles">{error && <p className="error">{error}</p>}</main>
  }

  return (
    <main className="profiles">
      <h1>ImgTagr</h1>
      {!chosen && !creating ? (
        <>
          <h2>Who's looking?</h2>
          <ul className="profile-list">
            {profiles.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => choose(p)}>
                  <span className="avatar">{p.name[0].toUpperCase()}</span>
                  {p.name}
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="new" onClick={() => choose('new')}>
                <span className="avatar">+</span>
                New profile
              </button>
            </li>
          </ul>
        </>
      ) : (
        <form className="profile-form" onSubmit={submit}>
          <h2>{creating ? 'New profile' : chosen?.name}</h2>
          {creating && (
            <input
              aria-label="Profile name"
              placeholder="Name"
              autoComplete="username"
              autoFocus
              required
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            type="password"
            aria-label="Password"
            placeholder="Password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            autoFocus={!creating}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p className="error">{error}</p>}
          <div className="actions">
            {profiles.length > 0 && (
              <button type="button" onClick={() => choose(undefined)}>
                Back
              </button>
            )}
            <button type="submit" className="primary" disabled={busy}>
              {creating ? 'Create' : 'Sign in'}
            </button>
          </div>
        </form>
      )}
    </main>
  )
}
