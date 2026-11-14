/**
 * Every rule about a (model, reasoning effort) pair lives in model-choice.ts:
 * which pair a turn sends, how a stored pick maps onto the /v1/models
 * catalogue, and what to store after the engine refuses an effort.
 */
import { describe, expect, it } from 'vitest';
import {
  modelPickerState,
  partnerDefaultChoice,
  preferencesAfterEffortRefusal,
  reasoningEffortLabel,
  resolveModelChoice,
  splitLegacyModelId,
  turnChoice,
} from '../../src/model-choice';
import type { Model } from '../../src/types';

const base = { object: 'model', created: 0, owned_by: 'gemini' };
const hydrogen: Model = { ...base, id: 'gemini-4-hydrogen', name: 'Google: Gemini 4 Hydrogen',
  reasoning_efforts: ['low', 'medium', 'high'], default_reasoning_effort: 'low', gated_reasoning_efforts: ['medium', 'high'] };
const hydrogenPrivate: Model = { ...hydrogen, id: 'gemini-4-hydrogen-private', gated_reasoning_efforts: [] };
const sol: Model = { ...base, id: 'gpt-6-sol', reasoning_efforts: null, default_reasoning_effort: null, gated_reasoning_efforts: null };
const oldEngineRow: Model = { ...base, id: 'gemini-4-hydrogen-thinking' }; // none of the three keys
const CATALOGUE = [hydrogen, hydrogenPrivate, sol];

it('labels the three efforts and capitalises an unknown one', () => {
  expect(['low', 'medium', 'high', 'xhigh'].map(reasoningEffortLabel)).toEqual(['Low', 'Medium', 'High', 'Xhigh']);
});

it('splits an old variant id into its base model and effort', () => {
  expect(splitLegacyModelId('gemini-4-hydrogen-thinking')).toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: 'medium' });
  expect(splitLegacyModelId('gemini-4-hydrogen-thinking-high')).toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
  expect(splitLegacyModelId('gemini-4-hydrogen-thinking-private')).toEqual({ model: 'gemini-4-hydrogen-private', reasoningEffort: 'medium' });
  expect(splitLegacyModelId('gemini-4-hydrogen-thinking-high-private')).toEqual({ model: 'gemini-4-hydrogen-private', reasoningEffort: 'high' });
  for (const id of ['gemini-4-hydrogen', 'gemini-4-hydrogen-private', 'deep-thinking-model', '-thinking', '']) {
    expect(splitLegacyModelId(id)).toBeNull();
  }
});

it('takes the partner default as a pair only when /v1/config gives both halves', () => {
  const cfg = (extra: object) => ({ default_llm_model: 'gemini-4-hydrogen-thinking', default_stt_model: null, default_image_model: null, system_prompt: null, ...extra });
  expect(partnerDefaultChoice(cfg({ default_llm_base_model: 'gemini-4-hydrogen', default_llm_reasoning_effort: 'medium' })))
    .toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: 'medium' });
  expect(partnerDefaultChoice(cfg({ default_llm_base_model: null, default_llm_reasoning_effort: null }))).toEqual({ model: 'gemini-4-hydrogen-thinking' });
  expect(partnerDefaultChoice(cfg({ default_llm_base_model: 'gemini-4-hydrogen', default_llm_reasoning_effort: null }))).toEqual({ model: 'gemini-4-hydrogen-thinking' });
  expect(partnerDefaultChoice(cfg({}))).toEqual({ model: 'gemini-4-hydrogen-thinking' }); // old engine
  expect(partnerDefaultChoice({ ...cfg({}), default_llm_model: null })).toEqual({});
  expect(partnerDefaultChoice(null)).toEqual({});
});

it('resolves stored pick, then client config, then partner default, without mixing sources', () => {
  const partner = { default_llm_model: 'p', default_stt_model: null, default_image_model: null, system_prompt: null,
    default_llm_base_model: 'p', default_llm_reasoning_effort: 'medium' };
  expect(resolveModelChoice({ model: 'a' }, { model: 'b', reasoningEffort: 'high' }, partner)).toEqual({ model: 'a' });
  expect(resolveModelChoice({ model: 'a', reasoningEffort: 'low' }, { model: 'b' }, partner)).toEqual({ model: 'a', reasoningEffort: 'low' });
  expect(resolveModelChoice({}, { model: 'b', reasoningEffort: 'high' }, partner)).toEqual({ model: 'b', reasoningEffort: 'high' });
  expect(resolveModelChoice({ reasoningEffort: 'high' }, {}, partner)).toEqual({ model: 'p', reasoningEffort: 'medium' });
  expect(resolveModelChoice({}, {}, null)).toEqual({});
});

it('builds what one turn sends', () => {
  const config = { model: 'a', reasoningEffort: 'high' };
  expect(turnChoice(undefined, config)).toEqual({ model: 'a', reasoningEffort: 'high' });
  expect(turnChoice({ model: 'b' }, config)).toEqual({ model: 'b', reasoningEffort: undefined });
  expect(turnChoice({ reasoningEffort: 'low' }, config)).toEqual({ model: 'a', reasoningEffort: 'low' });
  expect(turnChoice({ model: 'b', reasoningEffort: '' }, config)).toEqual({ model: 'b', reasoningEffort: undefined });
  expect(turnChoice(undefined, undefined)).toEqual({ model: undefined, reasoningEffort: undefined });
  const once = turnChoice({ model: 'b' }, config);
  expect(turnChoice(once, config)).toEqual(once); // applying it twice changes nothing
});

describe('modelPickerState', () => {
  it('shows no effort control for a model the engine gives no efforts for', () => {
    expect(modelPickerState([oldEngineRow], { model: 'gemini-4-hydrogen-thinking' }))
      .toEqual({ modelId: 'gemini-4-hydrogen-thinking', legacy: false, orphan: false, efforts: [], effort: undefined, gated: [], staleEffort: false });
    expect(modelPickerState(CATALOGUE, { model: 'gpt-6-sol' }).efforts).toEqual([]);
  });
  it('selects the model default when no effort is stored', () => {
    expect(modelPickerState(CATALOGUE, { model: 'gemini-4-hydrogen' }))
      .toEqual({ modelId: 'gemini-4-hydrogen', legacy: false, orphan: false, efforts: ['low', 'medium', 'high'], effort: 'low', gated: ['medium', 'high'], staleEffort: false });
  });
  it('selects a stored effort the model lists', () => {
    expect(modelPickerState(CATALOGUE, { model: 'gemini-4-hydrogen', reasoningEffort: 'high' }).effort).toBe('high');
  });
  it('flags a stored effort the model no longer lists and falls back to the default', () => {
    const narrowed = [{ ...hydrogen, reasoning_efforts: ['low'], gated_reasoning_efforts: [] }];
    const state = modelPickerState(narrowed, { model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
    expect([state.effort, state.staleEffort]).toEqual(['low', true]);
  });
  it('flags an effort stored for a model with no efforts', () => {
    expect(modelPickerState(CATALOGUE, { model: 'gpt-6-sol', reasoningEffort: 'high' }).staleEffort).toBe(true);
  });
  it('shows a stored old id as its base row at the effort the id implies', () => {
    const state = modelPickerState(CATALOGUE, { model: 'gemini-4-hydrogen-thinking-high-private' });
    expect([state.modelId, state.legacy, state.orphan, state.effort]).toEqual(['gemini-4-hydrogen-private', true, false, 'high']);
  });
  it('leaves an old id alone when its base does not list the implied effort', () => {
    const lowOnly = [{ ...hydrogen, reasoning_efforts: ['low'] }];
    const state = modelPickerState(lowOnly, { model: 'gemini-4-hydrogen-thinking' });
    expect([state.modelId, state.orphan, state.efforts]).toEqual(['gemini-4-hydrogen-thinking', true, []]);
  });
  it('keeps an unknown id as an orphan and an empty pick empty', () => {
    expect(modelPickerState(CATALOGUE, { model: 'retired-model', reasoningEffort: 'high' }))
      .toEqual({ modelId: 'retired-model', legacy: false, orphan: true, efforts: [], effort: undefined, gated: [], staleEffort: false });
    expect(modelPickerState(CATALOGUE, {}).modelId).toBe('');
  });
  it('offers an effort the SDK does not know', () => {
    const wider = [{ ...hydrogen, reasoning_efforts: ['low', 'xhigh'] }];
    expect(modelPickerState(wider, { model: 'gemini-4-hydrogen', reasoningEffort: 'xhigh' }).effort).toBe('xhigh');
  });
  it('falls back to the first listed effort when the default is missing', () => {
    const noDefault = [{ ...hydrogen, default_reasoning_effort: null }];
    expect(modelPickerState(noDefault, { model: 'gemini-4-hydrogen' }).effort).toBe('low');
  });
});

it('says what to store after a refused effort', () => {
  const refusal = { model: 'gemini-4-hydrogen', reasoningEffort: 'high' };
  expect(preferencesAfterEffortRefusal({ model: 'gemini-4-hydrogen', reasoningEffort: 'high' }, refusal)).toEqual({ reasoningEffort: undefined });
  expect(preferencesAfterEffortRefusal({ model: 'gemini-4-hydrogen-thinking-high' }, refusal)).toEqual({ model: 'gemini-4-hydrogen', reasoningEffort: undefined });
  expect(preferencesAfterEffortRefusal({ model: 'gemini-4-hydrogen-thinking-high' }, { model: null, reasoningEffort: 'high' })).toBeNull();
  expect(preferencesAfterEffortRefusal({ model: 'gemini-4-hydrogen' }, refusal)).toBeNull();
  expect(preferencesAfterEffortRefusal({}, refusal)).toBeNull();
});
