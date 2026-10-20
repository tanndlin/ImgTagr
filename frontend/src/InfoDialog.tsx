import { useEffect, useRef, useState } from 'react'
import { getInstanceStats, type InstanceStats } from './api'
import { formatBytes } from './format'

type Props = {
  onClose: () => void
}

export function InfoDialog({ onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [stats, setStats] = useState<InstanceStats>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    dialog.current?.showModal()

    async function load() {
      try {
        setStats(await getInstanceStats())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    }

    load()
  }, [])

  const largest = Math.max(1, ...(stats?.profiles.map((p) => p.total_bytes) ?? []))

  return (
    <dialog
      ref={dialog}
      className="info"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          dialog.current?.close()
        }
      }}
    >
      <div className="info-head">
        <h2>Storage</h2>
        <button type="button" aria-label="Close" onClick={() => dialog.current?.close()}>
          ×
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      {!stats && !error && <p className="hint">Loading…</p>}
      {stats && (
        <>
          <dl className="info-tiles">
            <div>
              <dt>Bucket total</dt>
              <dd>
                {formatBytes(
                  stats.bucket.original_bytes +
                    stats.bucket.thumbnail_bytes +
                    stats.bucket.orphan_bytes,
                )}
              </dd>
            </div>
            <div>
              <dt>Images</dt>
              <dd>{stats.image_count.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Profiles</dt>
              <dd>{stats.profile_count.toLocaleString()}</dd>
            </div>
          </dl>

          <table className="info-table">
            <tbody>
              <tr>
                <th>Originals</th>
                <td>{formatBytes(stats.bucket.original_bytes)}</td>
              </tr>
              <tr>
                <th>Thumbnails</th>
                <td>{formatBytes(stats.bucket.thumbnail_bytes)}</td>
              </tr>
              <tr>
                <th>Saved by sharing files</th>
                <td>
                  {formatBytes(stats.logical_bytes - stats.stored_bytes)} (
                  {(stats.image_count - stats.unique_image_count).toLocaleString()} shared)
                </td>
              </tr>
              {stats.bucket.orphan_count > 0 && (
                <tr>
                  <th>Leftover files</th>
                  <td>
                    {formatBytes(stats.bucket.orphan_bytes)} (
                    {stats.bucket.orphan_count.toLocaleString()} files)
                  </td>
                </tr>
              )}
              <tr>
                <th>Files in bucket</th>
                <td>{stats.bucket.object_count.toLocaleString()}</td>
              </tr>
              <tr>
                <th>Active sessions</th>
                <td>{stats.active_session_count.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>

          <h3>By profile</h3>
          <ul className="info-profiles">
            {stats.profiles.map((p) => (
              <li key={p.name}>
                <div className="info-profile-row">
                  <span>{p.name}</span>
                  <span className="hint">
                    {p.image_count.toLocaleString()} images · {p.tag_count.toLocaleString()} tags ·{' '}
                    {formatBytes(p.total_bytes)}
                  </span>
                </div>
                <div className="info-bar">
                  <span style={{ width: `${(p.total_bytes / largest) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </dialog>
  )
}
