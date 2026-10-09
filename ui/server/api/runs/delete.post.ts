const MAX_RUNS = 50

/**
 * Delete finished workflow runs from GitHub: this is the "Delete" button of a product card. The dashboard reads
 * GitHub only, so removing a product's runs removes the product. Active runs are never deleted.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ids?: unknown }>(event)
  const ids = Array.isArray(body?.ids) ? body.ids : []
  if (!ids.length || ids.length > MAX_RUNS || !ids.every(id => Number.isInteger(id) && id > 0)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `Expected 1 to ${MAX_RUNS} run ids.` })
  }
  const gh = github(event)

  const deleted: number[] = []
  const skipped: number[] = []
  for (const id of ids as number[]) {
    const run = await gh.request<{ status: string }>(`/repos/${gh.repo}/actions/runs/${id}`)
    if (run.status !== 'completed') {
      skipped.push(id)
      continue
    }
    await gh.request(`/repos/${gh.repo}/actions/runs/${id}`, { method: 'DELETE' })
    deleted.push(id)
  }
  return { ok: true, deleted, skipped }
})
