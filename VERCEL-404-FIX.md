# Vercel 404 Fix for Ragent (fix/vercel-500-errors)

## Root Cause
- The coordinator (the thing deployed to Vercel) lives in a subdirectory.
- Vercel deploys from the **repo root** by default.
- No top-level `api/` or `public/` → no API functions + no landing page → 404 on `/`.
- Previous routing experiments (catch-all `[...route].ts`, rewrites being added/removed, no explicit `outputDirectory`) made static serving + API registration unreliable.
- The latest change (switch to catch-all + removal of rewrite) left the root path without guaranteed static content or a fallback.

The browser request you showed (plain GET `/` → 404 from Vercel, no content) confirms static assets were never mounted at the site root.

## What I Changed (no builds/tests run)
1. Restored the standard, proven Vercel Hono pattern:
   - `coordinator/api/index.ts` (default export + `handle(app)`)
   - `coordinator/vercel.json` now has the classic rewrite for `/api/*` + explicit `"outputDirectory": "public"`

2. Added a top-level `vercel.json` (at Ragent root) with a rewrite that forces `/` → the dashboard HTML file inside `coordinator/public/`. This makes the landing page appear **even if** Root Directory is still set to the repo root.

3. Left `coordinator/api/[...route].ts` in place (harmless; `index.ts` takes precedence for the classic handler).

These changes are purely config + the standard entry file. No code logic, no new deps, no compilation.

## What YOU Must Do (critical)

### 1. Set Root Directory in Vercel (most important)
- Go to your Vercel project: **olalolo22s-projects / ragent**
- Settings → General → **Root Directory**
- Set it to exactly: `coordinator`
- Save.

This makes:
- `coordinator/public/` → your site root (`/`)
- `coordinator/api/` → `/api/*` functions
- `coordinator/vercel.json` → active

Without this, only the top-level rewrite hack works for the HTML; the `/api/demo/run` calls will still 404.

### 2. Redeploy
- Push this branch (or the changes):
  ```bash
  git add -A
  git commit -m "fix(vercel): restore standard api/index + explicit public output + root fallback rewrite"
  git push origin fix/vercel-500-errors
  ```
- In Vercel dashboard, find the latest preview for this branch (or click "Redeploy" on the current preview).
- Or create a new preview by pushing again.

### 3. Verify
- Hard refresh the preview URL (or use incognito / clear the `__vercel_jwt` + toolbar cookies you had).
- You should see the full "AI agents hiring AI agents" hero + styled dashboard.
- Click "Run Negotiation" → it should hit `/api/demo/run`, show steps, agents, scores, etc. (no more 404 on the document root).

### 4. If still 404 on `/` after setting Root Directory
- Check the specific deployment logs in Vercel (the one for this commit).
- Look under the "Functions" tab — you should see an `api` function.
- If the function shows build/runtime errors, note the message (often missing env vars like PRIVATE_KEY, or import resolution).
- The top-level `vercel.json` rewrite is only a band-aid; the `coordinator` root dir setting is required for full API + static.

### 5. Recommended extra (optional but helps)
In Vercel project settings:
- Environment Variables: make sure any needed ones (USE_TESTNET, etc.) are present for previews (or mark them as "Preview" + "Production").
- If you previously had "Output Directory" manually set at project level, clear it (let `vercel.json` control it).

## Files touched
- `coordinator/api/index.ts` (new - standard entry)
- `coordinator/vercel.json` (added rewrites + outputDirectory)
- `vercel.json` (new at repo root - fallback for `/`)
- This doc: `VERCEL-404-FIX.md`

After the Root Directory change + redeploy, the 404 on the root should be gone and the demo UI should load.

If you still get errors (500/404 on the API calls inside the demo), paste the new Vercel function logs here.
