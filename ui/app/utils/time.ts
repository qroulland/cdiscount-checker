const UNITS: [label: string, ms: number][] = [
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['min', 60_000],
  ['s', 1_000],
]

/** "3 min ago", "just now"… `now` is passed in so the text re-renders on a ticking clock. */
export function timeAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return '–'
  const diff = now - new Date(iso).getTime()
  if (diff < 15_000) return 'just now'
  return `${duration(diff)} ago`
}

/** "2h 05min", "45 s"… */
export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '–'
  const [first, second] = UNITS.filter(([, unit]) => ms >= unit).slice(0, 2)
  if (!first) return '0 s'
  const firstValue = Math.floor(ms / first[1])
  if (!second || first[0] === 's') return `${firstValue} ${first[0]}`
  const secondValue = Math.floor((ms - firstValue * first[1]) / second[1])
  return secondValue ? `${firstValue} ${first[0]} ${secondValue} ${second[0]}` : `${firstValue} ${first[0]}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}
