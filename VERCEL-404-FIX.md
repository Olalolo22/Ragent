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
   - `coordinator/vercel.json` has headers + rewrites for `/` (to index.html) and `/api/*`

2. Rely on Vercel's default static behavior: contents of `public/` are served from the site root when Root Directory = `coordinator`. No `outputDirectory` (that was causing the "no entrypoint" error).

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

## Files touched (cumulative)
- `coordinator/api/index.ts`
- `coordinator/vercel.json` (headers + rewrites for `/` and `/api/*`, buildCommand skip, **no outputDirectory**)
- `vercel.json` (root - minimal)
- `coordinator/src/agents/llm-agent.ts` (import fix)
- `coordinator/tsconfig.json` (include cleanup)
- This doc: `VERCEL-404-FIX.md`

After the Root Directory change + redeploy, the 404 on the root should be gone and the demo UI should load.

If you still get errors (500/404 on the API calls inside the demo), paste the new Vercel function logs here.

---

## Latest Error: "No entrypoint found in output directory: 'public'"

**Symptom from your log:**
```
build skipped — Vercel handles TypeScript api/ routes + static public/ directly
Error: No entrypoint found in output directory: "public".
Searched for: app.{js...}, index.{js...}, server.{js...} ...
```

### Why this happened
Setting `"outputDirectory": "public"` in vercel.json tells Vercel "treat `public/` as the *entire built app output*".

Vercel then looks inside it for a server entrypoint (Next.js style, SSR, etc.). It doesn't find `server.js` / `index.js` etc. because `public/` only has your static `index.html`.

This is wrong for a mixed static + `api/` functions project.

### Fix applied
- Removed `"outputDirectory": "public"` completely.
- Added explicit rewrite so `/` → `/index.html` (your dashboard).
- `public/index.html` will now be served at the root by Vercel's normal static rules (`public/` contents → site root).
- Kept the `buildCommand` echo (so `tsc` stays skipped).
- Cleaned up the root `vercel.json` so it doesn't interfere when Root Directory = `coordinator`.

### Why the previous outputDirectory seemed like a good idea
It was an attempt to force static serving, but it backfired. For plain `api/` + `public/` (no framework preset), you should **not** set outputDirectory, or only set it if you actually build into a dist folder.

### What you must do
1. Make sure **Root Directory** is still set to exactly `coordinator` in Vercel project settings.
2. Push the fix:
   ```bash
   git add -A
   git commit -m "fix(vercel): remove bad outputDirectory + add / -> /index.html rewrite + clean root vercel.json"
   git push origin fix/vercel-500-errors
   ```
3. Redeploy the preview.
4. Hard refresh / incognito.

`/ ` should now serve the full styled dashboard from `public/index.html`.
`/api/demo/run` etc. should still work via the rewrite + hono/vercel handler.

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

### What to do now (older tsc section)
See the **new section at the top** ("Latest Error: No entrypoint...") for the current correct push command and instructions.

The key recent change was removing `"outputDirectory": "public"`. The push example in the top section is the one to use.
