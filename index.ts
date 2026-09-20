/**
 * Surplus Intelligence gateway provider for Pi and Oh My Pi.
 *
 * - Catalog: GET {BASE}/v1/models (OpenRouter-compatible: context length,
 *   input modalities, supported_parameters).
 * - Prices: GET {BASE}/api/markets (public). `best_*_per_1m` is the cheapest
 *   currently-available seller offer in microdollars — what the router picks.
 * - Prices are USD. OMP/Pi render the cost column with a `$` sign.
 *
 * Host support:
 * - OMP: `fetchDynamicModels` fetches the live list on demand (cached 24 h).
 * - Upstream Pi: `registerProvider` only accepts a static `models` array plus
 *   an optional `refreshModels(context)` hook, so the catalog is fetched once
 *   at load and re-fetched via the host's model-refresh flow.
 */

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

const BASE = "https://api.surplusintelligence.ai";
const KEY_ENV = "SURPLUS_INTELLIGENCE_API_KEY";
const CHAT_API = "openai-completions";

/** Consumed subset of a Surplus `/v1/models` row (OpenRouter-compatible). */
type CatalogRow = {
	id?: unknown;
	name?: unknown;
	context_length?: unknown;
	architecture?: { input_modalities?: unknown };
	supported_parameters?: unknown;
	pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
	top_provider?: { max_completion_tokens?: unknown };
};

/** Consumed subset of a Surplus `/api/markets` row; prices are microdollars per 1M. */
type MarketRow = {
	model?: unknown;
	best_input_per_1m?: unknown;
	best_output_per_1m?: unknown;
	best_cache_read_per_1m?: unknown;
	best_cache_write_per_1m?: unknown;
};

/** One model row as consumed by both hosts' provider configs. */
type SurplusModel = {
	id: string;
	name: string;
	api: typeof CHAT_API;
	baseUrl: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
};

/** Positive finite number from JSON, tolerating per-token strings like "0.0000003"; else 0. */
function num(value: unknown): number {
	const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/** USD per 1M: cheapest live offer (microdollars) when present, else the reference price (USD per token). */
function usdPrice(marketValue: unknown, referenceValue: unknown): number {
	return num(marketValue) / 1_000_000 || num(referenceValue) * 1_000_000;
}

function toModel(row: CatalogRow, market: MarketRow | undefined): SurplusModel | undefined {
	const id = row.id;
	if (typeof id !== "string" || id.length === 0) return undefined;
	const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
	const modalities = Array.isArray(row.architecture?.input_modalities) ? row.architecture.input_modalities : [];
	const input = modalities.filter((item): item is "text" | "image" => item === "text" || item === "image");
	const contextWindow = num(row.context_length) || 128_000;
	return {
		id,
		name: typeof row.name === "string" && row.name.length > 0 ? row.name : id,
		api: CHAT_API,
		baseUrl: `${BASE}/v1`,
		reasoning: params.includes("reasoning") || params.includes("include_reasoning"),
		input: input.length > 0 ? input : ["text"],
		cost: {
			input: usdPrice(market?.best_input_per_1m, row.pricing?.prompt),
			output: usdPrice(market?.best_output_per_1m, row.pricing?.completion),
			cacheRead: usdPrice(market?.best_cache_read_per_1m, row.pricing?.input_cache_read),
			cacheWrite: usdPrice(market?.best_cache_write_per_1m, row.pricing?.input_cache_write),
		},
		contextWindow,
		maxTokens: Math.min(num(row.top_provider?.max_completion_tokens) || contextWindow, contextWindow),
	};
}

async function getJson(url: string, apiKey?: string): Promise<unknown> {
	const response = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
	if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
	return response.json();
}

/** Live catalog merged with live marketplace prices. */
async function fetchModels(apiKey?: string): Promise<SurplusModel[]> {
	const [catalogRaw, marketsRaw] = await Promise.all([
		getJson(`${BASE}/v1/models`, apiKey),
		getJson(`${BASE}/api/markets`),
	]);
	// Surplus documents OpenRouter-compatible payloads; every consumed field is typeof-guarded below.
	const catalog = catalogRaw as { data?: CatalogRow[] };
	const markets = marketsRaw as { markets?: MarketRow[] };
	const byModel: Record<string, MarketRow> = Object.create(null);
	for (const market of Array.isArray(markets?.markets) ? markets.markets : []) {
		if (market && typeof market.model === "string") byModel[market.model] = market;
	}
	const rows = Array.isArray(catalog?.data) ? catalog.data : [];
	return rows.flatMap((row): SurplusModel[] => {
		if (!row) return [];
		const model = toModel(row, typeof row.id === "string" ? byModel[row.id] : undefined);
		return model ? [model] : [];
	});
}

export default async function surplus(pi: ExtensionAPI) {
	// Upstream Pi needs a populated `models` array at registration (no dynamic
	// fetch hook); OMP ignores `models` and uses `fetchDynamicModels` instead.
	// The factory is awaited by both hosts, so this ordering works for both.
	let cached = await fetchModels(process.env[KEY_ENV]);

	// Upstream Pi path: refreshModels re-fetches through the host's model-refresh flow.
	// OMP path: fetchDynamicModels fetches on demand (host caches with 24 h TTL).
	pi.registerProvider("surplus", {
		baseUrl: `${BASE}/v1`,
		api: CHAT_API,
		apiKey: KEY_ENV,
		// Upstream Pi: static list from load time, refreshed via refreshModels.
		models: cached,
		async refreshModels(context: { credential?: { apiKey?: string } }) {
			cached = await fetchModels(context?.credential?.apiKey ?? process.env[KEY_ENV]);
			return cached;
		},
		// OMP: fetched on demand, never cached by us.
		async fetchDynamicModels(apiKey?: string) {
			return fetchModels(apiKey);
		},
	});
}
