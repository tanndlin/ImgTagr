import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { message } from '../message'
import { ErrorContext } from './errors'

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [error, setError] = useState<string>()

  const reportError = useCallback(
    (action: string, err: unknown) => setError(`${action}: ${message(err)}`),
    [],
  )

  useEffect(() => {
    const show = (e: ErrorEvent | PromiseRejectionEvent) =>
      setError(String('reason' in e ? e.reason : e.message))
    window.addEventListener('error', show)
    window.addEventListener('unhandledrejection', show)
    return () => {
      window.removeEventListener('error', show)
      window.removeEventListener('unhandledrejection', show)
    }
  }, [])

  const value = useMemo(() => ({ error, reportError }), [error, reportError])
  return <ErrorContext value={value}>{children}</ErrorContext>
}
