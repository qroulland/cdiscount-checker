export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Cdiscount checker',
      htmlAttrs: { lang: 'en' },
    },
  },
  runtimeConfig: {
    // Fine-grained PAT on the checker repo: Actions read/write (check runs are readable without permission on a public repo). Env: NUXT_GITHUB_TOKEN
    githubToken: '',
    // owner/name of the checker repo. Env: NUXT_GITHUB_REPO
    githubRepo: 'qroulland/cdiscount-checker',
    // Branch holding the workflow that gets dispatched. Env: NUXT_GITHUB_REF
    githubRef: 'main',
    // Workflow file name. Env: NUXT_WORKFLOW_FILE
    workflowFile: 'check-cdiscount.yml',
    // Optional HTTP basic auth password protecting the whole UI (any user name). Env: NUXT_UI_PASSWORD
    uiPassword: '',
  },
})
