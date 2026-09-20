import {
  groupModelsByProvider,
  providerTitle,
  UNKNOWN_PROVIDER_KEY,
} from '../../src/ui/utils';
import type { Model } from '../../src/types';

// Fake sample data — fixtures used only to assert the grouping logic. The real
// model list always comes from the engine (t2v.listModels()); nothing here ships.
function model(id: string, ownedBy: string | undefined): Model {
  return { id, object: 'model', created: 0, owned_by: ownedBy as string };
}

describe('groupModelsByProvider', () => {
  it('buckets models by provider in first-appearance order', () => {
    const groups = groupModelsByProvider([
      model('gpt-5.5', 'openai'),
      model('gpt-4.1', 'openai'),
      model('claude-opus-4-7', 'anthropic'),
      model('openrouter/qwen/qwen3-max', 'openrouter'),
    ]);

    expect(groups.map((g) => g.title)).toEqual(['OpenAI', 'Anthropic', 'OpenRouter']);
    expect(groups[0].models.map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-4.1']);
    expect(groups[1].models.map((m) => m.id)).toEqual(['claude-opus-4-7']);
    expect(groups[2].models.map((m) => m.id)).toEqual(['openrouter/qwen/qwen3-max']);
  });

  it('groups by owned_by, not by parsing the id (openrouter/anthropic stays under OpenRouter)', () => {
    const groups = groupModelsByProvider([
      model('anthropic/claude-opus-4-7', 'anthropic'),
      model('openrouter/anthropic/claude-opus-4-7', 'openrouter'),
    ]);

    expect(groups.map((g) => g.title)).toEqual(['Anthropic', 'OpenRouter']);
    expect(groups[0].models.map((m) => m.id)).toEqual(['anthropic/claude-opus-4-7']);
    expect(groups[1].models.map((m) => m.id)).toEqual(['openrouter/anthropic/claude-opus-4-7']);
  });

  it('preserves the full model id as-is (does not strip openrouter/)', () => {
    const groups = groupModelsByProvider([model('openrouter/google/gemini-2.5-pro', 'openrouter')]);
    expect(groups[0].models[0].id).toBe('openrouter/google/gemini-2.5-pro');
  });

  it('falls back to the Other group when owned_by is missing', () => {
    const groups = groupModelsByProvider([
      model('gpt-5.5', 'openai'),
      model('mystery-model', undefined),
      model('blank-owner', ''),
    ]);

    expect(groups.map((g) => g.title)).toEqual(['OpenAI', 'Other']);
    expect(groups[1].key).toBe(UNKNOWN_PROVIDER_KEY);
    expect(groups[1].models.map((m) => m.id)).toEqual(['mystery-model', 'blank-owner']);
  });

  it('maps gemini/vertex_ai/google providers to a single Google group', () => {
    const groups = groupModelsByProvider([
      model('gemini-2.5-pro', 'gemini'),
      model('gemini-2.5-flash', 'vertex_ai'),
      model('gemini-1.5', 'google'),
    ]);

    expect(groups.map((g) => g.title)).toEqual(['Google']);
    expect(groups[0].models.map((m) => m.id)).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-1.5',
    ]);
  });

  it('returns an empty array for no models', () => {
    expect(groupModelsByProvider([])).toEqual([]);
  });
});

describe('providerTitle', () => {
  it('maps known provider keys to friendly names', () => {
    expect(providerTitle('openai')).toBe('OpenAI');
    expect(providerTitle('anthropic')).toBe('Anthropic');
    expect(providerTitle('openrouter')).toBe('OpenRouter');
    expect(providerTitle('talk2view')).toBe('Talk2View');
    expect(providerTitle('gemini')).toBe('Google');
    expect(providerTitle(UNKNOWN_PROVIDER_KEY)).toBe('Other');
  });

  it('capitalizes unknown provider keys as a fallback', () => {
    expect(providerTitle('mistral')).toBe('Mistral');
    expect(providerTitle('deepseek')).toBe('Deepseek');
  });
});
