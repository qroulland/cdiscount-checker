export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Invalid run id.' })
  }
  const body = await readBody<{ pauseDefault?: boolean } | undefined>(event)
  const gh = github(event)
  // Pause first: the hourly cron must not bring the default product back once the run is cancelled
  if (body?.pauseDefault) await setDefaultPaused(event, true)
  await gh.request(`/repos/${gh.repo}/actions/runs/${id}/cancel`, { method: 'POST' })
  return { ok: true }
})
