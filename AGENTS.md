# AGENTS.md

Guidance for coding agents working on this repo.

## What this is

Single-file TypeScript extension (`index.ts`) registering the `surplus`
provider for Pi and Oh My Pi (OMP). No build step, no test suite, no
dependencies at runtime — hosts load `index.ts` directly (Bun required).

Two host paths in `registerProvider` (both required):
- **OMP**: ignores `models`, calls `fetchDynamicModels` per refresh; the
  host caches discovery in `models.db` for **24 h**.
- **Pi (upstream)**: needs a populated `models` array at load, refreshed
  via `refreshModels`.

Catalog: OpenRouter-compatible `GET /v1/models`. Pricing: `GET /api/markets`
(cheapest live seller offer, microdollars/1M), falling back to catalog
reference price. Every consumed field is typeof-guarded — keep it that way.

## Per-model API routing

`SurplusModel.api` is per-row. The chat surface (`/v1/chat/completions`) is
not uniform across the catalog: some ids reject `reasoning_effort` combined
with function tools there, while `/v1/responses` serves both. Known case:
`gpt-6.1-sol` (400; Surplus request id 01M3Y13BNPRMR45HHC4RS6E51P, 2026-10-02).
`toModel()` stamps `RESPONSES_API` for that exact id. Do not widen the
ternary without a live probe of the id in question — sibling ids
(`gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-luna`, `gpt-5.5`) all
accept tools+effort on chat.

**Open follow-up:** probe `gpt-6.1-sol-pro` (tools + `reasoning_effort` on
`/v1/chat/completions`) when it has healthy sellers; if it 400s the same
way, add it to the routing set and release.

## Verification (no test suite)

1. `bun build --no-bundle index.ts --outdir /tmp/x` — parse check (a bare
   `tsc` run fails on missing host type declarations; that is expected in a
   checkout without `node_modules`).
2. Local end-to-end: install the modified file into
   `~/.omp/plugins/node_modules/pi-surplus/index.ts`, then **clear the OMP
   discovery cache or the 24 h TTL will keep serving pre-patch rows**:
   ```sql
   DELETE FROM model_cache WHERE provider_id='surplus';
   DELETE FROM model_cache_refresh WHERE provider_id='surplus';
   ```
   (`~/.omp/agent/models.db`). Then `omp models surplus/<id> --json` and
   check the cache row's `api` via `json_each(model_cache.models)`.
3. Live behavior: Surplus 400 dumps land in `~/.omp/logs/http-400-requests/`
   on OMP — read them before guessing at gateway contracts.

## Release

Semver-ish: patch for routing/metadata fixes, minor for new host features.

```bash
# bump "version" in package.json, commit "vX.Y.Z", then:
git tag vX.Y.Z && git push origin main vX.Y.Z
gh release create vX.Y.Z --title "pi-surplus vX.Y.Z" --notes "..."
npm publish --access public        # from a clean checkout of the tag
```

Verify: `npm view pi-surplus dist-tags` — registry propagation can lag
a minute or two after publish ("may take a few minutes"); do not conclude
failure from one early 404. `npm publish` is immutable per version — never
republish the same version, release a bump instead.
