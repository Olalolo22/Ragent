# Vercel 404 Fix for Ragent (fix/vercel-500-errors)

## Current State
The site builds successfully but returns 404 on `/`.

### Root Cause
- The app lives in the `coordinator/` subdirectory.
- Vercel deploys from the repo root by default.
- Without setting **Root Directory = `coordinator`** in Vercel, neither `public/index.html` nor the `coordinator/vercel.json` are used.
- Routing the root to static files has been unreliable due to previous experiments.

## Current Fix
We now serve the full dashboard through the Hono API handler (more reliable than static-only):

- `coordinator/vercel.json`:
  - Rewrites `/` and `/api/*` to the handler.
  - Skips the `tsc` build step.
  - Includes `public/index.html` in the function bundle.

- `src/server.ts`:
  - Loads `public/index.html` at runtime.
  - Serves it from `app.get('/')` (the Hono root under `basePath('/api')`).

- `api/index.ts`: Standard `export default handle(app)`.

This means hitting `/` routes to the function, which returns the complete styled dashboard. `/api/demo/run` etc. continue to work.

## Required Vercel Setting (Critical)
1. Go to your project → **Settings → General → Root Directory**
2. Set it to exactly: `coordinator`
3. Save

This is required. Without it you will get 404s on root and API.

## Deploy Steps
```bash
git add -A
git commit -m "fix(vercel): serve dashboard from Hono + clean rewrites + skip tsc"
git push origin fix/vercel-500-errors
```

- Go to the Vercel dashboard for the branch preview.
- Click "Redeploy" if needed.
- Use incognito or hard refresh (old cookies like `__vercel_jwt` can cause issues).

## Verify
- Root URL should show the full "AI agents hiring AI agents" dashboard.
- "Run Negotiation" should work and call `/api/demo/run`.

## If Still 404
- Confirm Root Directory is set to `coordinator` (may need another deploy after changing it).
- Check the latest deployment logs for the rewrite + function output.
- Paste the full build log + the exact URL here.

## Key Files
- `coordinator/vercel.json`
- `coordinator/api/index.ts`
- `coordinator/src/server.ts`
- `coordinator/public/index.html`

Keep this doc focused on the current working setup.