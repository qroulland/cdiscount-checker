const MAX_LABEL = 40

/** Fallback label out of a Cdiscount URL: last path segment, without the ".html" and the "f-<id>-" prefix. */
function labelFromUrl(url: URL): string {
  const segment = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
  return segment.replace(/\.html?$/i, '').replace(/^f-\d+-/i, '').replace(/[-_]+/g, ' ').trim() || url.hostname
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^\p{L}\p{N} ._-]/gu, '-').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
}

export default defineEventHandler(async (event) => {
  const gh = github(event)
  const body = await readBody<{ productUrl?: string; label?: string }>(event)
  const productUrl = (body?.productUrl ?? '').trim()
  let label = sanitizeLabel(body?.label ?? '')

  if (productUrl) {
    let url: URL
    try {
      url = new URL(productUrl)
    }
    catch {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'The product URL is not a valid URL.' })
    }
    if (!/(^|\.)cdiscount\.com$/i.test(url.hostname)) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: 'Only cdiscount.com product pages are supported.' })
    }
    if (!label) label = sanitizeLabel(labelFromUrl(url))
    if (label.toLowerCase() === DEFAULT_LABEL) {
      throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: `"${DEFAULT_LABEL}" is reserved for the PRODUCT_URL product of the repo.` })
    }
  }
  else {
    // No URL: (re)start the default product, whose URL lives in the repo variables/secrets; let the cron watch over it again
    label = ''
    await setDefaultPaused(event, false)
  }

  try {
    await gh.request(`/repos/${gh.repo}/actions/workflows/${gh.workflowFile}/dispatches`, {
      method: 'POST',
      body: { ref: gh.ref, inputs: { product_url: productUrl, label, ban_restarts: '0' } },
    })
  }
  catch (error) {
    const message = (error as { message?: string }).message ?? ''
    if (/unexpected inputs/i.test(message)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Workflow out of date',
        message: `The workflow on "${gh.ref}" does not accept the product_url and label inputs yet: push the updated .github/workflows/${gh.workflowFile} first.`,
      })
    }
    throw error
  }

  return { ok: true, label: label || DEFAULT_LABEL }
})
