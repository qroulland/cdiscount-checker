import type { ProductState } from '#shared/types'

export type StateColor = 'primary' | 'success' | 'info' | 'warning' | 'error' | 'neutral'

export interface StateMeta {
  label: string
  color: StateColor
  icon: string
  /** Animated indicator: the job is alive and checking */
  live?: boolean
  description: string
}

export const STATE_META: Record<ProductState, StateMeta> = {
  queued: { label: 'Queued', color: 'neutral', icon: 'i-lucide-clock', description: 'The GitHub job is waiting for a runner.' },
  starting: { label: 'Starting', color: 'info', icon: 'i-lucide-loader-circle', live: true, description: 'Installing the browser, first check coming.' },
  unavailable: { label: 'Watching', color: 'primary', icon: 'i-lucide-eye', live: true, description: 'Product still sold out, checked every minute.' },
  error: { label: 'Check errors', color: 'warning', icon: 'i-lucide-triangle-alert', live: true, description: 'Recent checks failed; the job keeps trying.' },
  found: { label: 'In the cart!', color: 'success', icon: 'i-lucide-shopping-cart', description: 'Added to the cart, session sent on Telegram.' },
  restarting: { label: 'Restarting', color: 'warning', icon: 'i-lucide-rotate-cw', live: true, description: 'Moving to a fresh VM (new IP) after errors.' },
  ended: { label: 'Handed over', color: 'neutral', icon: 'i-lucide-arrow-right', description: 'This run finished its checks and dispatched the next one.' },
  crashed: { label: 'Crashed', color: 'error', icon: 'i-lucide-bug', description: 'The job failed; see the run logs.' },
  cancelled: { label: 'Cancelled', color: 'neutral', icon: 'i-lucide-ban', description: 'Stopped manually or by the concurrency group.' },
  inactive: { label: 'Not running', color: 'neutral', icon: 'i-lucide-pause', description: 'No active job for this product.' },
}
