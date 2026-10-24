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

  it('closes up the line where a cue was: a cue and the spaces around it are one space', () => {
    expect(stripToneCues('[sad][sighs] Hello')).toBe('Hello'); // adjacent cues at the start
    expect(stripToneCues('a [sad] [sighs] b')).toBe('a b'); // a run of cues mid-line is one
    expect(stripToneCues('Hello[sad]there')).toBe('Hello there'); // no space to start with: one is put there
    expect(stripToneCues('See [Figure 2] [sad] now')).toBe('See [Figure 2] now'); // another bracket stays
    expect(stripToneCues('The end [sad]')).toBe('The end'); // at the end
    expect(stripToneCues('  [Excited]   Great news  ')).toBe('Great news'); // letter case is free; the ends are trimmed
  });

  it('puts nothing where a cue sat in front of punctuation', () => {
    expect(stripToneCues('Done [laughs].')).toBe('Done.');
    expect(stripToneCues('sorry [sad].')).toBe('sorry.'); // a cue before a full stop at the end
    expect(stripToneCues('Well [sighs] ... okay')).toBe('Well... okay');
    for (const mark of [',', '.', ';', ':', '!', '?']) expect(stripToneCues(`Yes [sad] ${mark} no`)).toBe(`Yes${mark} no`);
    // The space in front of the cue goes too, which French would have kept: one space is lost at the cue's site.
    expect(stripToneCues('Merci [laughs] !')).toBe('Merci!');
  });

  it('cleans up only where a cue was: every other space stays exactly as it was', () => {
    // No cue, no change at all: not trimmed, not collapsed, not closed up against punctuation.
    expect(stripToneCues('  Bonjour !  Ça va ?  ')).toBe('  Bonjour !  Ça va ?  ');
    // French sets a space before ! ? ; and : and the clean-up does not touch those away from a cue.
    expect(stripToneCues('[excited] Bonjour ! Ça va ?')).toBe('Bonjour ! Ça va ?');
    expect(stripToneCues('Oui , merci [sad] . Non ;')).toBe('Oui , merci. Non ;');
    expect(stripToneCues('a  b [sad] c   d')).toBe('a  b c   d'); // runs of spaces elsewhere are not collapsed
    expect(stripToneCues('  [Excited]   Great  news  ')).toBe('Great  news'); // only the cue's own spaces are absorbed; the ends are trimmed
  });

  it('stays fast on a very long run of spaces', () => {
    // A pattern that looks for the spaces before a cue from every position inside a run of spaces is quadratic:
    // 100 000 spaces would take seconds. The pattern is anchored on the character before the run to avoid that.
    const spaces = ' '.repeat(100_000);
    const start = performance.now();
    expect(stripToneCues(`${spaces}x`)).toBe(`${spaces}x`);
    expect(stripToneCues(`${spaces}x[sad]`)).toBe(`${spaces}x`.trim());
    expect(stripToneCues(`Hi${spaces}[sad]${spaces}there`)).toBe('Hi there');
    expect(performance.now() - start).toBeLessThan(1000);
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
