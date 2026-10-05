import { createContext, use } from 'react'

type Errors = {
  error?: string
  reportError: (action: string, err: unknown) => void
}

export const ErrorContext = createContext<Errors | null>(null)

export function useErrors() {
  const errors = use(ErrorContext)
  if (!errors) {
    throw new Error('useErrors must be used inside ErrorProvider')
  }

  return errors
}
