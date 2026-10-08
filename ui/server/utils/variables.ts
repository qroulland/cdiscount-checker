import type { H3Event } from 'h3'

/** Repository variable read by the workflow: "true" = the hourly cron does not restart the default product. */
export const PAUSE_VARIABLE = 'DEFAULT_PAUSED'

export async function isDefaultPaused(event: H3Event): Promise<boolean> {
  const gh = github(event)
  try {
    const variable = await gh.request<{ value: string }>(`/repos/${gh.repo}/actions/variables/${PAUSE_VARIABLE}`)
    return variable.value === 'true'
  }
  catch (error) {
    // 404: never paused. 403: the token lacks "Variables: read" — the UI still works, Stop just cannot pause the cron.
    const code = (error as { statusCode?: number }).statusCode
    if (code === 404 || code === 403) return false
    throw error
  }
}

/** Create or update the pause variable. Needs "Variables: read and write" on the token. */
export async function setDefaultPaused(event: H3Event, paused: boolean): Promise<void> {
  const gh = github(event)
  const body = { name: PAUSE_VARIABLE, value: String(paused) }
  try {
    await gh.request(`/repos/${gh.repo}/actions/variables/${PAUSE_VARIABLE}`, { method: 'PATCH', body })
  }
  catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error
    await gh.request(`/repos/${gh.repo}/actions/variables`, { method: 'POST', body })
  }
}
