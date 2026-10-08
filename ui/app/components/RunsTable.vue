<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { RunView } from '#shared/types'

const props = defineProps<{ runs: RunView[], now: number }>()

interface Row extends RunView {
  durationMs: number
}

const rows = computed<Row[]>(() => props.runs.map(run => ({
  ...run,
  durationMs: run.startedAt
    ? (run.active ? props.now : new Date(run.updatedAt).getTime()) - new Date(run.startedAt).getTime()
    : 0,
})))

const columns: TableColumn<Row>[] = [
  { accessorKey: 'number', header: 'Run' },
  { accessorKey: 'label', header: 'Product' },
  { accessorKey: 'event', header: 'Trigger' },
  { accessorKey: 'state', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Started' },
  { accessorKey: 'durationMs', header: 'Duration' },
  { accessorKey: 'checker', header: 'Checks' },
]
</script>

<template>
  <UTable :data="rows" :columns="columns" :ui="{ td: 'py-2' }">
    <template #number-cell="{ row }">
      <ULink :to="row.original.url" target="_blank" class="font-medium">
        #{{ row.original.number }}
      </ULink>
    </template>
    <template #label-cell="{ row }">
      <span class="text-highlighted">{{ row.original.label }}</span>
    </template>
    <template #event-cell="{ row }">
      {{ row.original.event === 'schedule' ? 'cron' : 'dispatch' }}
    </template>
    <template #state-cell="{ row }">
      <UBadge
        :label="STATE_META[row.original.state].label"
        :color="STATE_META[row.original.state].color"
        :icon="STATE_META[row.original.state].icon"
        variant="subtle"
        size="sm"
      />
    </template>
    <template #createdAt-cell="{ row }">
      <span :title="formatDate(row.original.createdAt)">{{ timeAgo(row.original.createdAt, now) }}</span>
    </template>
    <template #durationMs-cell="{ row }">
      {{ row.original.durationMs ? duration(row.original.durationMs) : '–' }}
    </template>
    <template #checker-cell="{ row }">
      <template v-if="row.original.checker">
        {{ row.original.checker.checks }}
        <span v-if="row.original.checker.consecutiveErrors" class="text-warning">({{ row.original.checker.consecutiveErrors }} err)</span>
      </template>
      <span v-else class="text-dimmed">–</span>
    </template>
  </UTable>
</template>
