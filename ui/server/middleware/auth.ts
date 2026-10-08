import { timingSafeEqual } from 'node:crypto'

/** Optional HTTP basic auth on everything, enabled by NUXT_UI_PASSWORD (for a deployed UI). */
export default defineEventHandler((event) => {
  const { uiPassword } = useRuntimeConfig(event)
  if (!uiPassword) return

  const header = getRequestHeader(event, 'authorization') ?? ''
  const [scheme, encoded] = header.split(' ')
  const credentials = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''
  const password = credentials.slice(credentials.indexOf(':') + 1)
  const expected = Buffer.from(uiPassword)
  const given = Buffer.from(password)
  if (given.length === expected.length && timingSafeEqual(given, expected)) return

  setResponseHeader(event, 'WWW-Authenticate', 'Basic realm="cdiscount-checker", charset="UTF-8"')
  throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
})
