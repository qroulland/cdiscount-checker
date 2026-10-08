import type { H3Event } from 'h3'
import { createError } from 'h3'
import { FetchError } from 'ofetch'

export interface GhRun {
  id: number
  name: string
  display_title: string
  status: string
  conclusion: string | null
  event: string
  head_sha: string
  created_at: string
  run_started_at: string | null
  updated_at: string
  html_url: string
  run_number: number
}

export interface GhCheckRun {
  id: number
  name: string
  external_id: string | null
  status: string
  conclusion: string | null
  output: { title: string | null; summary: string | null; text: string | null }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  query?: Record<string, string | number>
}

/** Thin GitHub REST client bound to the configured repo. GitHub errors become h3 errors with a readable message. */
export function github(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.githubToken) {
    throw createError({ statusCode: 500, statusMessage: 'Misconfigured', message: 'NUXT_GITHUB_TOKEN is not set.' })
  }
  const repo = config.githubRepo

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    try {
      const data = await $fetch(`https://api.github.com${path}`, {
        method: options.method ?? 'GET',
        body: options.body as Record<string, unknown> | undefined,
        query: options.query,
        headers: {
          'Authorization': `Bearer ${config.githubToken}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'cdiscount-checker-ui',
        },
      })
      return data as T
    }
    catch (error) {
      if (error instanceof FetchError) {
        const detail = (error.data as { message?: string } | undefined)?.message ?? error.message
        throw createError({
          statusCode: error.statusCode ?? 502,
          statusMessage: 'GitHub error',
          message: `GitHub ${options.method ?? 'GET'} ${path} failed: ${detail}`,
        })
      }
      throw error
    }
  }

  return {
    repo,
    repoUrl: `https://github.com/${repo}`,
    ref: config.githubRef,
    workflowFile: config.workflowFile,
    request,
  }
}
