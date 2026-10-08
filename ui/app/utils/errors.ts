/** Readable message out of a $fetch / h3 error. */
export function errorMessage(error: unknown): string {
  const e = error as { data?: { message?: string, statusMessage?: string }, message?: string } | undefined
  return e?.data?.message || e?.data?.statusMessage || e?.message || 'Unknown error'
}
