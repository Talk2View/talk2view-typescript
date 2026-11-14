/**
 * Every rule about a (model, reasoning effort) pair, in one place: which pair a
 * turn sends, how a stored pick maps onto the /v1/models catalogue, and what to
 * store after the engine refuses an effort. Pure functions; no React, DOM or
 * storage, so any UI (and the Python SDK's embed page) can share them.
 */
import type { Model, PartnerConfig, ReasoningEffort, T2VConfig, UserPreferences } from './types.js';

/** A model id and the reasoning effort to send with it. Either may be absent. */
export interface ModelChoice {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

const EFFORT_LABELS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' };

/** 'low' -> 'Low', 'medium' -> 'Medium', 'high' -> 'High'; anything else: first letter upper-cased. */
export function reasoningEffortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort.charAt(0).toUpperCase() + effort.slice(1);
}

const LEGACY_ID = /^(.+)-thinking(-high)?(-private)?$/;

/** 'X-thinking' -> (X, medium); 'X-thinking-high' -> (X, high); a trailing '-private' stays on the model. Else null. */
export function splitLegacyModelId(id: string): { model: string; reasoningEffort: 'medium' | 'high' } | null {
  const match = LEGACY_ID.exec(id);
  if (!match) return null;
  const [, stem, high, priv] = match;
  return { model: `${stem}${priv ?? ''}`, reasoningEffort: high ? 'high' : 'medium' };
}

/** A non-empty string, else undefined. */
function present<T extends string>(value: T | null | undefined): T | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** One source's pair: its model, and its effort only when one is set. */
function choiceOf(model: string, effort: ReasoningEffort | null | undefined): ModelChoice {
  const reasoningEffort = present(effort);
  return reasoningEffort ? { model, reasoningEffort } : { model };
}

/** The partner default as a (model, effort) pair, as the engine's /v1/config defines it. */
export function partnerDefaultChoice(config: PartnerConfig | null | undefined): ModelChoice {
  if (!config) return {};
  const baseModel = present(config.default_llm_base_model);
  const effort = present(config.default_llm_reasoning_effort);
  if (baseModel && effort) return { model: baseModel, reasoningEffort: effort };
  const model = present(config.default_llm_model);
  return model ? { model } : {};
}

/** Stored pick, else the client's config, else the partner default. A source that names a model supplies the effort too; sources are never mixed. */
export function resolveModelChoice(
  preferences: Pick<UserPreferences, 'model' | 'reasoningEffort'>,
  clientConfig: Pick<T2VConfig, 'model' | 'reasoningEffort'>,
  partnerConfig: PartnerConfig | null | undefined,
): ModelChoice {
  const stored = present(preferences.model);
  if (stored) return choiceOf(stored, preferences.reasoningEffort);
  const configured = present(clientConfig.model);
  if (configured) return choiceOf(configured, clientConfig.reasoningEffort);
  return partnerDefaultChoice(partnerConfig);
}

/** What one turn sends: the options' model and effort; the config's only for what the options leave out, and the config's effort only when the options name no model. '' counts as absent. */
export function turnChoice(options: ModelChoice | undefined, config: ModelChoice | undefined): ModelChoice {
  const turnModel = present(options?.model);
  const turnEffort = present(options?.reasoningEffort);
  if (turnModel) return { model: turnModel, reasoningEffort: turnEffort };
  return {
    model: present(config?.model),
    reasoningEffort: turnEffort ?? present(config?.reasoningEffort),
  };
}

export interface ModelPickerState {
  /** The catalogue row to show selected; '' when no model is chosen; the stored id when it is an orphan. */
  modelId: string;
  /** The stored id is an old variant id shown as its base row. */
  legacy: boolean;
  /** The stored id is not in the catalogue and is not a resolvable old id. */
  orphan: boolean;
  /** Efforts to offer, catalogue order. Empty: show no effort control. */
  efforts: string[];
  /** The effort to show selected; undefined when `efforts` is empty. */
  effort: string | undefined;
  /** The subset of `efforts` that needs a paid plan. */
  gated: string[];
  /** A stored effort the row does not offer: the caller clears it. */
  staleEffort: boolean;
}

/** The state for a catalogue row, given the effort the row would fall back to. */
function rowState(
  row: Model,
  storedEffort: string | undefined,
  fallback: string | undefined,
  legacy: boolean,
): ModelPickerState {
  const efforts = row.reasoning_efforts ?? [];
  if (efforts.length === 0) {
    return { modelId: row.id, legacy, orphan: false, efforts: [], effort: undefined, gated: [], staleEffort: storedEffort !== undefined };
  }
  const listed = storedEffort !== undefined && efforts.includes(storedEffort);
  const effort = listed ? storedEffort : fallback !== undefined && efforts.includes(fallback) ? fallback : efforts[0];
  return {
    modelId: row.id,
    legacy,
    orphan: false,
    efforts: [...efforts],
    effort,
    gated: (row.gated_reasoning_efforts ?? []).filter((e) => efforts.includes(e)),
    staleEffort: storedEffort !== undefined && !listed,
  };
}

/** How a stored (model, effort) pick shows against the /v1/models catalogue. */
export function modelPickerState(models: Model[], choice: ModelChoice): ModelPickerState {
  const storedModel = present(choice.model);
  const storedEffort = present(choice.reasoningEffort);
  if (!storedModel) {
    return { modelId: '', legacy: false, orphan: false, efforts: [], effort: undefined, gated: [], staleEffort: storedEffort !== undefined };
  }
  const row = models.find((m) => m.id === storedModel);
  if (row) return rowState(row, storedEffort, present(row.default_reasoning_effort), false);
  const legacy = splitLegacyModelId(storedModel);
  if (legacy) {
    const baseRow = models.find((m) => m.id === legacy.model);
    if (baseRow?.reasoning_efforts?.includes(legacy.reasoningEffort)) {
      return rowState(baseRow, storedEffort, legacy.reasoningEffort, true);
    }
  }
  return { modelId: storedModel, legacy: false, orphan: true, efforts: [], effort: undefined, gated: [], staleEffort: false };
}

/** The preference write that follows a refused effort, or null when there is nothing to change. */
export function preferencesAfterEffortRefusal(
  preferences: Pick<UserPreferences, 'model' | 'reasoningEffort'>,
  refusal: { model: string | null; reasoningEffort: string | null },
): Partial<UserPreferences> | null {
  if (present(preferences.reasoningEffort)) return { reasoningEffort: undefined };
  const stored = present(preferences.model);
  if (stored && splitLegacyModelId(stored) && refusal.model !== null) {
    return { model: refusal.model, reasoningEffort: undefined };
  }
  return null;
}
