import type { CheckerStatus, JobsResponse } from '#shared/types'
import type { GhCheckRun, GhRun } from '../utils/github'

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000
const CHECK_RUN_PAGES = 3 // 100 check runs per page: a chain on one commit produces ~5 per product and per day

export default defineEventHandler(async (event): Promise<JobsResponse> => {
  const gh = github(event)

  const { workflow_runs: allRuns } = await gh.request<{ workflow_runs: GhRun[] }>(
    `/repos/${gh.repo}/actions/workflows/${gh.workflowFile}/runs`,
    { query: { per_page: 50 } },
  )
  const since = Date.now() - HISTORY_WINDOW_MS
  const runs = allRuns.filter(run => run.conclusion !== 'skipped' && (ACTIVE_STATUSES.has(run.status) || new Date(run.updated_at).getTime() > since))

  // The checker publishes its status as a check run on the commit it runs from (usually a single sha for all runs)
  const statuses = new Map<number, CheckerStatus>()
  const shas = [...new Set(runs.map(run => run.head_sha))]
  await Promise.all(shas.map(async (sha) => {
    for (let page = 1; page <= CHECK_RUN_PAGES; page++) {
      const { check_runs: checkRuns } = await gh.request<{ check_runs: GhCheckRun[] }>(
        `/repos/${gh.repo}/commits/${sha}/check-runs`,
        { query: { per_page: 100, page, filter: 'all' } },
      )
      parseStatuses(checkRuns, statuses)
      if (checkRuns.length < 100) break
    }
  }))

  const views = runs
    .map(run => toRunView(run, statuses.get(run.id) ?? null))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return {
    generatedAt: new Date().toISOString(),
    repoUrl: gh.repoUrl,
    products: groupProducts(views),
    runs: views,
  }
})
