<script setup lang="ts">
const emit = defineEmits<{ submitted: [label: string] }>()
const toast = useToast()

const productUrl = ref('')
const label = ref('')
const loading = ref(false)

async function submit() {
  loading.value = true
  try {
    const result = await $fetch<{ ok: boolean, label: string }>('/api/jobs', {
      method: 'POST',
      body: { productUrl: productUrl.value, label: label.value },
    })
    toast.add({
      title: `Job dispatched for "${result.label}"`,
      description: 'It shows up as queued within a few seconds, then checks every minute.',
      color: 'success',
      icon: 'i-lucide-rocket',
    })
    productUrl.value = ''
    label.value = ''
    emit('submitted', result.label)
  }
  catch (error) {
    toast.add({ title: 'Dispatch failed', description: errorMessage(error), color: 'error', icon: 'i-lucide-triangle-alert' })
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-plus-circle" class="size-5 text-primary" />
        <h2 class="font-semibold text-highlighted">
          Watch another product
        </h2>
      </div>
    </template>

    <form class="grid gap-4 md:grid-cols-[1fr_240px_auto] md:items-start" @submit.prevent="submit">
      <UFormField label="Product URL" required help="A cdiscount.com product page. Each product runs as its own job chain.">
        <UInput
          v-model="productUrl"
          type="url"
          required
          placeholder="https://www.cdiscount.com/…/f-….html"
          icon="i-lucide-link"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Label" help="Shown here and on Telegram. Defaults to the URL slug.">
        <UInput v-model="label" placeholder="e.g. ETB Prismatic" maxlength="40" icon="i-lucide-tag" class="w-full" />
      </UFormField>
      <UButton type="submit" :loading="loading" icon="i-lucide-play" label="Start watching" class="justify-center md:mt-6" />
    </form>
  </UCard>
</template>
