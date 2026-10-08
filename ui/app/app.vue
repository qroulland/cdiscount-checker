<script setup lang="ts">
import type { JobsResponse } from '#shared/types'

const REFRESH_EVERY_MS = 20_000

const { data, status, error, refresh } = await useFetch<JobsResponse>('/api/jobs')

// Same initial value on server and client (no hydration mismatch), then ticks on the client for relative times
const now = useState('now', () => Date.now())
let clock: ReturnType<typeof setInterval> | undefined
let poll: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  now.value = Date.now()
  clock = setInterval(() => { now.value = Date.now() }, 5_000)
  poll = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, REFRESH_EVERY_MS)
})
onUnmounted(() => {
  clearInterval(clock)
  clearInterval(poll)
})

// A dispatched run takes a few seconds to appear in the API: refresh twice
function refreshSoon() {
  setTimeout(() => refresh(), 2_500)
  setTimeout(() => refresh(), 8_000)
}

const activeCount = computed(() => data.value?.products.filter(p => p.activeRun).length ?? 0)
</script>

<template>
  <UApp>
    <div class="min-h-screen bg-default text-default">
      <UContainer class="py-8 space-y-8">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold text-highlighted flex items-center gap-2">
              <UIcon name="i-lucide-shopping-cart" class="size-6 text-primary" />
              Cdiscount checker
            </h1>
            <p class="text-sm text-muted">
              {{ activeCount }} job{{ activeCount === 1 ? '' : 's' }} running on GitHub Actions
              <template v-if="data">
                · <ULink :to="`${data.repoUrl}/actions`" target="_blank">open Actions</ULink>
              </template>
            </p>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="data" class="text-xs text-dimmed">updated {{ timeAgo(data.generatedAt, now) }}</span>
            <UButton icon="i-lucide-refresh-cw" color="neutral" variant="soft" :loading="status === 'pending'" aria-label="Refresh" @click="refresh()" />
            <UColorModeButton />
          </div>
        </header>

        <UAlert
          v-if="error"
          title="Could not load the jobs"
          :description="errorMessage(error)"
          color="error"
          variant="soft"
          icon="i-lucide-cloud-off"
        />

        <NewJobForm @submitted="refreshSoon" />

        <section class="space-y-3">
          <h2 class="font-semibold text-highlighted">
            Products
          </h2>
          <div v-if="!data && status === 'pending'" class="grid gap-4 md:grid-cols-2">
            <USkeleton class="h-56" />
            <USkeleton class="h-56" />
          </div>
          <p v-else-if="data && data.products.length === 0" class="text-sm text-muted">
            No run in the last 24 hours. Start one with the form above.
          </p>
          <div v-else-if="data" class="grid gap-4 md:grid-cols-2">
            <ProductCard v-for="product in data.products" :key="product.key" :product="product" :now="now" @changed="refreshSoon" />
          </div>
        </section>

        <section v-if="data && data.runs.length" class="space-y-3">
          <h2 class="font-semibold text-highlighted">
            Recent runs <span class="text-muted font-normal text-sm">(last 24 h)</span>
          </h2>
          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <RunsTable :runs="data.runs" :now="now" />
          </UCard>
        </section>
      </UContainer>
    </div>
  </UApp>
</template>
