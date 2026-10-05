export const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
