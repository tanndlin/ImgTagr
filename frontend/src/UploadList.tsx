import type { Upload } from './hooks/useUploads'

function uploadStatus({ status, progress, error }: Upload) {
  if (status === 'done') {
    return 'Done'
  }

  if (status === 'error') {
    return error
  }

  return progress < 1 ? `${Math.round(progress * 100)}%` : 'Processing…'
}

export function UploadList({ uploads }: { uploads: Upload[] }) {
  if (uploads.length === 0) {
    return null
  }

  return (
    <ul className="uploads">
      {uploads.map((u) => (
        <li key={u.key} className={u.status}>
          <span className="name">{u.name}</span>
          <span className="status">{uploadStatus(u)}</span>
          {u.status === 'uploading' && (
            <span className="bar" style={{ width: `${u.progress * 100}%` }} />
          )}
        </li>
      ))}
    </ul>
  )
}
