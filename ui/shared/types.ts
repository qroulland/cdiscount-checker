/** Status JSON published by check_cdiscount.js in the check run output (`status` object of the script). */
export interface CheckerStatus {
  v: number
  runId: string | null
  label: string
  productUrl: string | null
  productName: string | null
  state: 'starting' | 'unavailable' | 'error' | 'found' | 'restarting' | 'ended' | 'crashed'
  checks: number
  lastCheckAt: string | null
  startedAt: string
  updatedAt: string | null
  intervalMs: number
  iterations: number
  consecutiveErrors: number
  lastError: { kind: string; message: string } | null
  found: boolean
  banRestarts: number
}

export type RunState = CheckerStatus['state'] | 'queued' | 'cancelled'

export type ProductState = RunState | 'inactive'

export interface RunView {
  id: number
  number: number
  url: string
  label: string
  event: string
  /** GitHub run status: queued | in_progress | completed | ... */
  status: string
  conclusion: string | null
  createdAt: string
  startedAt: string | null
  updatedAt: string
  active: boolean
  state: RunState
  checker: CheckerStatus | null
}

export interface ProductView {
  key: string
  label: string
  isDefault: boolean
  productUrl: string | null
  productName: string | null
  state: ProductState
  activeRun: RunView | null
  lastRun: RunView
  runs: RunView[]
  checks: number
  iterations: number
  lastCheckAt: string | null
  consecutiveErrors: number
  lastError: { kind: string; message: string } | null
}

export interface JobsResponse {
  generatedAt: string
  repoUrl: string
  products: ProductView[]
  runs: RunView[]
}
