# pi-surplus

Surplus Intelligence gateway provider for [Pi](https://pi.dev) and [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi).

Surplus Intelligence is an open market for AI inference — [surplusintelligence.ai](https://www.surplusintelligence.ai/). This extension registers a `surplus` provider backed by its live catalog and marketplace:

- **Live catalog** — `GET /v1/models` (OpenRouter-compatible): context length, input modalities, supported parameters.
- **Live marketplace pricing** — `GET /api/markets`: the cheapest currently-available seller offer per model (`best_*_per_1m`, microdollars), falling back to the catalog reference price. What the router actually picks.
- **Dynamic-only by design** — a static model entry would shadow the live one and freeze its price at a snapshot. OMP caches the list (24 h TTL) and keeps the last snapshot if a refresh fails; `omp models refresh` forces a re-fetch.
- Prices are **USD**. OMP renders the cost column with a hardcoded `$`.
- Includes the `stream.markupHealingPattern: "dsml"` compat fix for `deepseek-v4.1-flash` (the gateway streams raw DSML tool-call markup for that model).

## Install

Requires [Bun](https://bun.sh/) in PATH (Pi and OMP load TypeScript extensions with Bun).

### Oh My Pi (OMP)

```bash
omp install pi-surplus
```

### Pi

```bash
pi install npm:pi-surplus
```

Then set your key (or run without one, if your endpoint allows):

```bash
export SURPLUS_INTELLIGENCE_API_KEY=...
```

In OMP the provider appears as `surplus/...` in `/model`; `omp models surplus --json` dumps the parsed catalog.

## Files

- `index.ts` — extension entry point (single file, no dependencies)

## License

MIT
