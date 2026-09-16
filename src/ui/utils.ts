import type { Model } from '../types.js';

/**
 * Group the engine's flat model list into provider sections for the settings
 * picker. Grouping is driven entirely by the server-provided `owned_by` field —
 * we never parse the model id. This keeps `openrouter/anthropic/claude-...`
 * (proxied via OpenRouter) distinct from a direct `anthropic/claude-...`, since
 * the two carry different `owned_by` values.
 *
 * Model ids are surfaced verbatim by callers (no `openrouter/` stripping) so
 * direct-API and OpenRouter-proxied models stay unambiguous.
 */

/** Bucket key for models whose `owned_by` is absent. */
export const UNKNOWN_PROVIDER_KEY = 'other';

export interface ModelGroup {
  /** Canonical provider bucket key (or the unknown sentinel). */
  key: string;
  /** Human-friendly section header. */
  title: string;
  models: Model[];
}

// Provider keys that refer to the same vendor are folded into one canonical key
// so we render a single section header (e.g. no three separate "Google" groups).
const PROVIDER_ALIASES: Record<string, string> = {
  gemini: 'google',
  vertex_ai: 'google',
};

const PROVIDER_TITLES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
  talk2view: 'Talk2View',
  [UNKNOWN_PROVIDER_KEY]: 'Other',
};

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Fold a raw `owned_by` value into its canonical provider bucket key. */
function canonicalProvider(ownedBy: string | undefined): string {
  const key = ownedBy || UNKNOWN_PROVIDER_KEY;
  return PROVIDER_ALIASES[key] ?? key;
}

/** Map a provider key to its display title, capitalizing unknown keys. */
export function providerTitle(ownedBy: string): string {
  const key = canonicalProvider(ownedBy);
  return PROVIDER_TITLES[key] ?? capitalize(key);
}

/**
 * Bucket models by provider, preserving first-appearance order for both the
 * groups and the models within each group.
 */
export function groupModelsByProvider(models: Model[]): ModelGroup[] {
  const order: string[] = [];
  const buckets = new Map<string, Model[]>();

  for (const model of models) {
    const key = canonicalProvider(model.owned_by);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(model);
  }

  return order.map((key) => ({
    key,
    title: providerTitle(key),
    models: buckets.get(key) ?? [],
  }));
}
