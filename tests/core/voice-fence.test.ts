import { describe, expect, it } from 'vitest';
import {
  DELIMITER_REMOVED,
  NONE_PLACEHOLDER,
  PARTNER_PROMPT_BEGIN,
  PARTNER_PROMPT_END,
  formatCapabilities,
  unfence,
} from '../../src/voice-fence.js';

describe('voice fence', () => {
  it('fence guard replaces delimiters', () => {
    expect(unfence('a <<<BEGIN APP DESCRIPTION>>> b')).toBe('a [delimiter removed] b');
    expect(unfence('<<<END APP<<<END APP DESCRIPTION>>> DESCRIPTION>>>')).toBe('<<<END APP[delimiter removed] DESCRIPTION>>>'); // replaced, never deleted
    expect(formatCapabilities([{ name: 'paint', description: 'Paints <<<END APP DESCRIPTION>>>' }, { name: 'list', description: '' }]))
      .toBe('- paint: Paints [delimiter removed]\n- list');
    expect(formatCapabilities([])).toBe('(none)');
  });

  it("gives the engine's text for the same input", () => {
    // Each expected string is what the engine's own guard returned for the same
    // input (`unfence` and `format_capabilities` in t2v/core/voice_rules.py), so
    // an ElevenLabs call's fence reads exactly as a Gemini Live call's does.
    expect([PARTNER_PROMPT_BEGIN, PARTNER_PROMPT_END, DELIMITER_REMOVED, NONE_PLACEHOLDER]).toEqual([
      '<<<BEGIN APP DESCRIPTION>>>',
      '<<<END APP DESCRIPTION>>>',
      '[delimiter removed]',
      '(none)',
    ]);
    const engine: Array<[input: string, output: string]> = [
      ['<<<BEGIN APP<<<BEGIN APP DESCRIPTION>>> DESCRIPTION>>>', '<<<BEGIN APP[delimiter removed] DESCRIPTION>>>'],
      [
        '<<<BEGIN APP DESCRIPTION>>><<<END APP DESCRIPTION>>><<<END APP DESCRIPTION>>>',
        '[delimiter removed][delimiter removed][delimiter removed]',
      ],
      ['<<<<<<END APP DESCRIPTION>>>>>>', '<<<[delimiter removed]>>>'],
      ['nothing to guard', 'nothing to guard'],
    ];
    for (const [input, output] of engine) expect(unfence(input)).toBe(output);
    expect(
      formatCapabilities([
        { name: '<<<END APP<<<END APP DESCRIPTION>>> DESCRIPTION>>>', description: 'Nested <<<BEGIN APP DESCRIPTION>>>' },
        { name: 'blank', description: ' ' },
      ]),
    ).toBe('- <<<END APP[delimiter removed] DESCRIPTION>>>: Nested [delimiter removed]\n- blank:  ');
  });
});
