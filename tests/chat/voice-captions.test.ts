/**
 * Call captions' list: the rules `<VoiceButton>` keeps a call's captions by,
 * one `transcript` line at a time (src/chat/voice-captions.ts).
 */
import { describe, expect, it } from 'vitest';
import type { VoiceTranscript } from '../../src/types';
import {
  MAX_CAPTIONS,
  appendCaption,
  captionText,
  captionsEnabled,
  type Caption,
} from '../../src/chat/voice-captions';

const u = (text: string, final: boolean): VoiceTranscript => ({ role: 'user', text, final });
const b = (text: string, final: boolean): VoiceTranscript => ({ role: 'bot', text, final });
/** An ElevenLabs agent line cut short by the end-user: only the words the agent said. */
const cut = (text: string): VoiceTranscript => ({ role: 'bot', text, final: true, replaces: true });
const shown = (list: Caption[]) => list.map((c) => [c.role, captionText(c)]);

describe('appendCaption', () => {
  it('updates a partial line in place, settles it, and joins a side that goes on', () => {
    let l = appendCaption([], u('hel', false)); expect(l.map(captionText)).toEqual(['hel']);
    l = appendCaption(l, u('hello there', false)); expect(l.map(captionText)).toEqual(['hello there']);
    l = appendCaption(l, u('hello there.', true)); expect(l.map(captionText)).toEqual(['hello there.']);
    l = appendCaption(l, u('how', false)); expect(l.map(captionText)).toEqual(['hello there. how']);
    l = appendCaption(l, b('Hi.', true)); l = appendCaption(l, b('How are you?', true));
    expect(l.map((c) => [c.role, captionText(c)])).toEqual([['user', 'hello there.'], ['bot', 'Hi. How are you?']]);   // the user's open partial is dropped when the other side speaks
  });

  it('a replacing line rewrites the same side, blank lines are ignored, and the list is capped', () => {
    let l = appendCaption([{ role: 'bot', settled: 'I can help with pricing and plans', live: '' }], { role: 'bot', text: 'I can help with', final: true, replaces: true });
    expect(l.map(captionText)).toEqual(['I can help with']);
    expect(appendCaption(l, u('   ', false))).toBe(l);
    for (let i = 0; i < 50; i++) l = appendCaption(l, (i % 2 ? u : b)(`line ${i}`, true)); expect(l.length).toBe(MAX_CAPTIONS);
  });

  it('removes a caption the other side leaves with no words', () => {
    let l = appendCaption([], u('hel', false));
    l = appendCaption(l, b('Hi.', true));
    expect(shown(l)).toEqual([['bot', 'Hi.']]);
  });

  it('ignores a blank line of either kind, from either side', () => {
    const l = appendCaption([], u('hi', true));
    for (const line of [b('', true), b('  ', true), u('', true), b(' ', false)]) {
      expect(appendCaption(l, line)).toBe(l);
    }
  });

  it("a replacing line rewrites only the last line of the agent's caption", () => {
    let l = appendCaption([], b('Let me check.', true));
    l = appendCaption(l, b('The Pro plan costs $20 a month and includes…', true));
    expect(shown(l)).toEqual([['bot', 'Let me check. The Pro plan costs $20 a month and includes…']]);
    l = appendCaption(l, cut('The Pro plan costs $20'));
    expect(shown(l)).toEqual([['bot', 'Let me check. The Pro plan costs $20']]);
    // A line that joins after the rewritten one is the last line from then on.
    l = appendCaption(l, b('Anything else?', true));
    l = appendCaption(l, cut('Anything'));
    expect(shown(l)).toEqual([['bot', 'Let me check. The Pro plan costs $20 Anything']]);
  });

  it("rewrites the agent's most recent caption when the end-user has spoken since", () => {
    let l = appendCaption([], b('Hello.', true));
    l = appendCaption(l, u('pricing please', true));
    l = appendCaption(l, b('I can help with pricing and plans', true));
    l = appendCaption(l, u('wait', true));
    l = appendCaption(l, cut('I can help with'));
    expect(shown(l)).toEqual([
      ['bot', 'Hello.'],
      ['user', 'pricing please'],
      ['bot', 'I can help with'],
      ['user', 'wait'],
    ]);
  });

  it('a blank replacing line removes that last line, and a caption it leaves with no words', () => {
    let l = appendCaption([], b('Let me check.', true));
    l = appendCaption(l, b('The Pro plan costs $20 a month', true));
    l = appendCaption(l, cut(''));
    expect(shown(l)).toEqual([['bot', 'Let me check.']]);

    let m = appendCaption([], u('hi', true));
    m = appendCaption(m, b('Sure, let me', true));
    m = appendCaption(m, cut('   '));
    expect(shown(m)).toEqual([['user', 'hi']]);
  });

  it('with no agent caption, a replacing line is a final line of its own, and a blank one is nothing', () => {
    const l = appendCaption([], u('hi', true));
    expect(shown(appendCaption(l, cut('Sorry')))).toEqual([['user', 'hi'], ['bot', 'Sorry']]);
    expect(appendCaption(l, cut(''))).toBe(l);
    expect(shown(appendCaption([], cut('Sorry')))).toEqual([['bot', 'Sorry']]);
    const none: Caption[] = [];
    expect(appendCaption(none, cut(''))).toBe(none);
  });

  it('drops the oldest captions first', () => {
    let l: Caption[] = [];
    for (let i = 0; i < MAX_CAPTIONS + 5; i++) l = appendCaption(l, (i % 2 ? u : b)(`line ${i}`, true));
    expect(l).toHaveLength(MAX_CAPTIONS);
    expect(captionText(l[0]!)).toBe('line 5');
    expect(captionText(l[MAX_CAPTIONS - 1]!)).toBe(`line ${MAX_CAPTIONS + 4}`);
  });
});

describe('captionsEnabled', () => {
  it('captionsEnabled: the prop wins, then the feature, then on', () => {
    expect(captionsEnabled(undefined, undefined)).toBe(true); expect(captionsEnabled(undefined, { callCaptions: false })).toBe(false);
    expect(captionsEnabled(true, { callCaptions: false })).toBe(true); expect(captionsEnabled(false, undefined)).toBe(false);
  });
});
