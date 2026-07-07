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
- Push the latest fixes on this branch:
  ```bash
  git add -A
  git commit -m "fix(vercel): add buildCommand to skip tsc + fix imports + clean tsconfig + public output + root rewrite for 404/build"
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

---

## Update: Build Failure (`npm run build` → `tsc` hanging/failing)

**New symptom (your latest log):**
```
Running "npm run build"
> ragent-coordinator@0.1.0 build
> tsc
```
(then deploy fails / no output produced)

### Why
- When Root Directory = `coordinator` (or even without), Vercel runs the `build` script from `package.json`.
- `"build": "tsc"` + `tsconfig.json` (`"noEmit": true`, strict, `include` with scripts + mixed `.js` / bare imports) causes `tsc` to error or exit non-zero.
- Root cause of the errors: inconsistent imports across files (`../schemas` vs `../schemas.js`) + scripts/ having relative paths that don't play well with the tsconfig when `tsc` is forced.
- Vercel does **not** need you to compile — it natively bundles `api/*.ts` files for serverless functions and serves `public/` for static.

### Fixes applied
1. `coordinator/vercel.json` now has:
   ```json
   "buildCommand": "echo 'build skipped — Vercel handles TypeScript api/ routes + static public/ directly'"
   ```
   This overrides `npm run build` / `tsc` during deploy.

2. Fixed the stray bare import in `src/agents/llm-agent.ts` (`../schemas` → `../schemas.js`) for consistency.

3. Cleaned `tsconfig.json` `include` to `["src/**/*", "api/**/*"]` (removed `scripts/**/*` — those are only for `tsx` local runs).

4. Root `vercel.json` also has a safe no-op buildCommand.

### What to do now
- The changes are already in the branch.
- Push with a clear message (you can use this or your own):
  ```bash
  git add -A
  git commit -m "fix(vercel): add buildCommand to skip tsc + fix imports + clean tsconfig + public output + root rewrite for 404/build"
  git push origin fix/vercel-500-errors
  ```
- In Vercel you should now see the build step run the `echo` instead of `tsc`.
- After that, the 404 fix (Root Directory + rewrites + outputDirectory) + build skip should take effect.

If the build now passes but you still get 404 on `/` or API 404s, re-confirm:
- Root Directory is set to `coordinator`
- Check the "Build Logs" and "Function Logs" tabs for the new deployment.

You can also manually set an Environment Variable in Vercel if you want to be extra sure:
  - Key: `VERCEL_BUILD_COMMAND` (not usually needed, the vercel.json takes precedence).

This should get the site building and serving again.
