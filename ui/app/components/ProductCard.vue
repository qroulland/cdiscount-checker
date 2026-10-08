<script setup lang="ts">
import type { ProductView } from '#shared/types'

const props = defineProps<{ product: ProductView, now: number }>()
const emit = defineEmits<{ changed: [] }>()
const toast = useToast()

const meta = computed(() => STATE_META[props.product.state])
const run = computed(() => props.product.activeRun ?? props.product.lastRun)
const progress = computed(() => props.product.iterations ? Math.min(100, Math.round((props.product.checks / props.product.iterations) * 100)) : 0)
const canRelaunch = computed(() => !props.product.activeRun && (props.product.isDefault || Boolean(props.product.productUrl)))

const stopOpen = ref(false)
const stopping = ref(false)
const relaunching = ref(false)

async function stop() {
  if (!props.product.activeRun) return
  stopping.value = true
  try {
    await $fetch(`/api/runs/${props.product.activeRun.id}/cancel`, { method: 'POST', body: { pauseDefault: props.product.isDefault } })
    toast.add({
      title: `Stopping "${props.product.label}"`,
      description: props.product.isDefault
        ? 'The run is being cancelled and the hourly cron is paused until you watch again.'
        : 'The run is being cancelled and will not chain a successor.',
      color: 'neutral',
      icon: 'i-lucide-octagon-x',
    })
    stopOpen.value = false
    emit('changed')
  }
  catch (error) {
    toast.add({ title: 'Cancel failed', description: errorMessage(error), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    stopping.value = false
  }
}

async function relaunch() {
  relaunching.value = true
  try {
    await $fetch('/api/jobs', {
      method: 'POST',
      body: { productUrl: props.product.isDefault ? '' : props.product.productUrl, label: props.product.isDefault ? '' : props.product.label },
    })
    toast.add({ title: `Job dispatched for "${props.product.label}"`, color: 'success', icon: 'i-lucide-rocket' })
    emit('changed')
  }
  catch (error) {
    toast.add({ title: 'Dispatch failed', description: errorMessage(error), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    relaunching.value = false
  }
}
</script>

<template>
  <UCard :ui="{ body: 'space-y-4' }">
    <template #header>
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h3 class="font-semibold text-highlighted truncate">
              {{ product.label }}
            </h3>
            <UBadge v-if="product.isDefault" label="PRODUCT_URL" color="neutral" variant="subtle" size="sm" />
          </div>
          <p class="text-sm text-muted truncate">
            <template v-if="product.productName">{{ product.productName }}</template>
            <template v-else-if="product.productUrl">{{ product.productUrl }}</template>
            <template v-else>Product name not fetched yet</template>
          </p>
        </div>
        <UTooltip :text="meta.description">
          <UBadge :label="meta.label" :color="meta.color" :icon="meta.icon" variant="subtle" class="shrink-0" :class="{ 'animate-pulse': meta.live }" />
        </UTooltip>
      </div>
    </template>

    <dl class="grid grid-cols-3 gap-3 text-sm">
      <div>
        <dt class="text-xs uppercase tracking-wide text-dimmed">
          Last check
        </dt>
        <dd class="font-medium text-highlighted" :title="formatDate(product.lastCheckAt)">
          {{ timeAgo(product.lastCheckAt, now) }}
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-dimmed">
          Checks
        </dt>
        <dd class="font-medium text-highlighted">
          {{ product.checks }}<span v-if="product.iterations" class="text-muted font-normal"> / {{ product.iterations }}</span>
        </dd>
      </div>
      <div>
        <dt class="text-xs uppercase tracking-wide text-dimmed">
          Errors in a row
        </dt>
        <dd class="font-medium" :class="product.consecutiveErrors ? 'text-warning' : 'text-highlighted'">
          {{ product.consecutiveErrors }}
        </dd>
      </div>
    </dl>

    <UProgress v-if="product.activeRun && product.iterations" :model-value="progress" size="xs" :color="meta.color" />

    <UAlert
      v-if="product.lastError"
      :title="`Last error [${product.lastError.kind}]`"
      :description="product.lastError.message"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
    />

    <p class="text-sm text-muted flex flex-wrap items-center gap-x-1">
      <UIcon name="i-lucide-github" class="size-4" />
      <ULink :to="run.url" target="_blank" class="font-medium">
        Run #{{ run.number }}
      </ULink>
      <span>· {{ run.event === 'schedule' ? 'cron' : 'dispatch' }}</span>
      <span v-if="run.active && run.startedAt">· running for {{ duration(now - new Date(run.startedAt).getTime()) }}</span>
      <span v-else>· {{ STATE_META[run.state].label.toLowerCase() }} {{ timeAgo(run.updatedAt, now) }}</span>
    </p>

    <template #footer>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <UButton
          v-if="product.productUrl"
          :to="product.productUrl"
          target="_blank"
          icon="i-lucide-external-link"
          label="Product page"
          color="neutral"
          variant="ghost"
          size="sm"
        />
        <span v-else />
        <div class="flex items-center gap-2">
          <UButton
            v-if="canRelaunch"
            icon="i-lucide-play"
            label="Watch again"
            size="sm"
            :loading="relaunching"
            @click="relaunch"
          />
          <UModal
            v-if="product.activeRun"
            v-model:open="stopOpen"
            :title="`Stop watching “${product.label}”?`"
            :description="product.isDefault
              ? 'Cancels the current run and pauses the hourly cron (DEFAULT_PAUSED repository variable). “Watch again” resumes it.'
              : 'Cancels the current run. The chain stops: use “Watch again” or the form to restart it.'"
          >
            <UButton icon="i-lucide-octagon-x" label="Stop" color="error" variant="soft" size="sm" />
            <template #footer>
              <div class="flex justify-end gap-2 w-full">
                <UButton label="Keep watching" color="neutral" variant="ghost" @click="stopOpen = false" />
                <UButton label="Stop the run" color="error" :loading="stopping" @click="stop" />
              </div>
            </template>
          </UModal>
        </div>
      </div>
    </template>
  </UCard>
</template>
