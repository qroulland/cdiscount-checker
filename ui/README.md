# Cdiscount checker UI

Single-page Nuxt 4 + Nuxt UI dashboard for the checker jobs running on GitHub Actions.

- One card per watched product: state, last check, checks done, errors in a row, current run.
- "Watch another product": dispatches a new job chain for a Cdiscount product URL.
- "Stop" cancels the current run; the chain stops and the product leaves the dashboard.
- "Watch again" re-dispatches a product whose chain died (crash, hand-over failure).
- Recent runs of the last 24 hours, auto-refreshed every 20 s.

## How it works

The UI only talks to the GitHub REST API, there is no database:

- jobs = workflow runs of `check-cdiscount.yml` (`run-name` carries the product label);
- live status = a check run named `Cdiscount status · <label>` that `check_cdiscount.js` creates on its commit
  and updates after every check (JSON in the check run output), using the job's own `GITHUB_TOKEN`.

## Setup

```bash
cd ui
npm install
cp .env.example .env   # set NUXT_GITHUB_TOKEN
npm run dev            # http://localhost:3000
```

`NUXT_GITHUB_TOKEN`: fine-grained personal access token on the checker repo with
**Actions: read and write** (list, dispatch, cancel runs). The live status (check runs) is readable without
any permission because the repo is public; a private repo would need a classic token with the `repo` scope.

Optional: `NUXT_UI_PASSWORD` protects the whole UI with HTTP basic auth (any user name), for a deployed instance.
`npm run build` produces a Nitro server (`.output/`) deployable on Vercel, Netlify or any Node host.
