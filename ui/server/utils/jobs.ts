import type { CheckerStatus, ProductState, ProductView, RunState, RunView } from '#shared/types'
import type { GhCheckRun, GhRun } from './github'

/** GitHub run statuses that mean "not finished". */
export const ACTIVE_STATUSES = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested'])

/** `run-name` of the workflow: "Cdiscount checker · <label>". Older runs had the bare workflow name. */
const TITLE_PREFIX = 'Cdiscount checker · '
/** Name of the check run published by check_cdiscount.js: "Cdiscount status · <label>". */
export const STATUS_CHECK_PREFIX = 'Cdiscount status · '
export const DEFAULT_LABEL = 'default'

export function labelFromTitle(title: string): string {
  return title.startsWith(TITLE_PREFIX) ? title.slice(TITLE_PREFIX.length).trim() || DEFAULT_LABEL : DEFAULT_LABEL
}

/** Map of run id → status JSON, out of the check runs of a commit. Non-checker check runs are ignored. */
export function parseStatuses(checkRuns: GhCheckRun[], into = new Map<number, CheckerStatus>()) {
  for (const checkRun of checkRuns) {
    if (!checkRun.name.startsWith(STATUS_CHECK_PREFIX) || !checkRun.output?.text || !checkRun.external_id) continue
    try {
      const parsed = JSON.parse(checkRun.output.text) as CheckerStatus
      if (parsed && typeof parsed === 'object' && parsed.v === 1) into.set(Number(checkRun.external_id), parsed)
    }
    catch {
      // Not ours, or truncated: the run just shows without a live status
    }
  }
  return into
}

export function runState(run: GhRun, checker: CheckerStatus | null): RunState {
  if (ACTIVE_STATUSES.has(run.status)) {
    if (checker) return checker.state
    return run.status === 'in_progress' ? 'starting' : 'queued'
  }
  if (checker?.found) return 'found'
  if (run.conclusion === 'cancelled') return 'cancelled'
  if (run.conclusion === 'failure' || run.conclusion === 'timed_out') return 'crashed'
  if (checker?.state === 'restarting' || checker?.state === 'crashed') return checker.state
  return 'ended'
}

export function toRunView(run: GhRun, checker: CheckerStatus | null): RunView {
  return {
    id: run.id,
    number: run.run_number,
    url: run.html_url,
    label: checker?.label || labelFromTitle(run.display_title),
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    createdAt: run.created_at,
    startedAt: run.run_started_at,
    updatedAt: run.updated_at,
    active: ACTIVE_STATUSES.has(run.status),
    state: runState(run, checker),
    checker,
  }
}

/** Group runs by product label; one card per product. */
export function groupProducts(runs: RunView[]): ProductView[] {
  const byKey = new Map<string, RunView[]>()
  for (const run of runs) {
    const key = run.label.toLowerCase()
    byKey.set(key, [...(byKey.get(key) ?? []), run])
  }

  const products = [...byKey.entries()].map(([key, productRuns]): ProductView => {
    productRuns.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const activeRun = productRuns.find(r => r.status === 'in_progress') ?? productRuns.find(r => r.active) ?? null
    const lastRun = activeRun ?? productRuns[0]!
    const latestChecker = (activeRun ?? lastRun).checker ?? productRuns.find(r => r.checker)?.checker ?? null
    const named = productRuns.find(r => r.checker?.productName)?.checker ?? null
    const withUrl = productRuns.find(r => r.checker?.productUrl)?.checker ?? null

    let state: ProductState = 'inactive'
    if (activeRun) state = activeRun.state
    else if (lastRun.state === 'found') state = 'found'

    return {
      key,
      label: lastRun.label,
      isDefault: key === DEFAULT_LABEL,
      productUrl: withUrl?.productUrl ?? null,
      productName: named?.productName ?? null,
      state,
      activeRun,
      lastRun,
      runs: productRuns,
      checks: latestChecker?.checks ?? 0,
      iterations: latestChecker?.iterations ?? 0,
      lastCheckAt: latestChecker?.lastCheckAt ?? null,
      consecutiveErrors: latestChecker?.consecutiveErrors ?? 0,
      lastError: latestChecker?.lastError ?? null,
    }
  })

  // Running products first, then the default one, then alphabetically
  return products.sort((a, b) =>
    Number(Boolean(b.activeRun)) - Number(Boolean(a.activeRun))
    || Number(b.isDefault) - Number(a.isDefault)
    || a.label.localeCompare(b.label),
  )
}
