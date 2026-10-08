export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  if (!/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Invalid run id.' })
  }
  const gh = github(event)
  await gh.request(`/repos/${gh.repo}/actions/runs/${id}/cancel`, { method: 'POST' })
  return { ok: true }
})
