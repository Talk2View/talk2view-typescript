import { describe, expect, it } from 'vitest';
import {
  DELIMITER_REMOVED,
  NONE_PLACEHOLDER,
  PARTNER_PROMPT_BEGIN,
  PARTNER_PROMPT_END,
  TONE_CUE,
  formatCapabilities,
  stripToneCues,
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

describe('tone cues', () => {
  it('removes tone cues and keeps every other bracket', () => {
    expect(stripToneCues('[sad] I understand. [sighs] Let me check.')).toBe('I understand. Let me check.');
    expect(stripToneCues('Hello[laughs softly] there')).toBe('Hello there');
    expect(stripToneCues('Hello [sad], there')).toBe('Hello, there');
    expect(stripToneCues('[clears-throat] Right')).toBe('Right');
    expect(stripToneCues('[sighs]')).toBe('');
    for (const kept of [
      'See [Figure 2] and [1]',
      '[this is not a tone cue at all] ok',
      'Prices: [see talk2view.com/pricing]',
      'Plain words',
    ])
      expect(stripToneCues(kept)).toBe(kept);
    // French sets a space before ! and ?: a line with no cue is left exactly as it is, so the
    // greeting the engine sends (and the call's echo of it) still match word for word.
    expect(stripToneCues('Bonjour ! Comment puis-je vous aider ?')).toBe('Bonjour ! Comment puis-je vous aider ?');
  });

  it('closes up the line where a cue was, and nowhere else', () => {
    expect(stripToneCues('[sad][sighs] Hello')).toBe('Hello'); // adjacent cues
    expect(stripToneCues('Done [laughs].')).toBe('Done.');
    expect(stripToneCues('Well [sighs] ... okay')).toBe('Well... okay');
    expect(stripToneCues('See [Figure 2] [sad] now')).toBe('See [Figure 2] now'); // another bracket stays
    expect(stripToneCues('  [Excited]   Great  news  ')).toBe('Great news'); // letter case is free; spaces are closed up
  });

  it('takes one to three words of letters, joined by a space or a hyphen', () => {
    expect(stripToneCues('[a] x')).toBe('x');
    expect(stripToneCues('[laughs very softly] x')).toBe('x'); // three words
    expect(stripToneCues('[laughs very very softly] x')).toBe('[laughs very very softly] x'); // four
    expect(stripToneCues('[clears throat now] x')).toBe('x');
    expect(stripToneCues('[]')).toBe('[]');
    expect(stripToneCues('[sad!] x')).toBe('[sad!] x');
    expect(stripToneCues('[sad  now] x')).toBe('[sad  now] x'); // two spaces are not a separator
  });

  it("is the same on every call: the pattern's lastIndex never carries over", () => {
    // TONE_CUE has the g flag, so a test() or exec() on it would start where the last one stopped.
    expect(TONE_CUE.global).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(stripToneCues('[sad] one')).toBe('one');
      expect(stripToneCues('Plain words')).toBe('Plain words');
      expect(stripToneCues('Hi [sighs] there [laughs]')).toBe('Hi there');
      expect(TONE_CUE.lastIndex).toBe(0);
    }
  });
});
