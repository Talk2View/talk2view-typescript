/**
 * The fence guard for an ElevenLabs call's instructions.
 *
 * The engine puts the partner prompt, the page prompt and the app's
 * capabilities between two delimiters in the agent's instructions. An
 * ElevenLabs call's page prompt and capabilities reach the agent as dynamic
 * variables inside that fence, so the SDK guards them as the engine does:
 * nothing from the page or a tool can close the fence early. Each function
 * gives the engine's text for the same input (`t2v/core/voice_rules.py`), so
 * the instructions read the same whichever voice model takes the call, with
 * one difference: `formatCapabilities([])` gives `(none)` where the engine's
 * `format_capabilities` gives `""`, because the dynamic variable needs a
 * value and the agent's placeholder is `(none)`.
 *
 * It also holds {@link stripToneCues}, which cleans the agent's lines on
 * either voice model before the SDK emits them.
 */

import type { VoiceCapability } from './types.js';

/** The delimiter that opens the fence. */
export const PARTNER_PROMPT_BEGIN = '<<<BEGIN APP DESCRIPTION>>>';
/** The delimiter that closes the fence. */
export const PARTNER_PROMPT_END = '<<<END APP DESCRIPTION>>>';
/** What a delimiter inside the fenced text is replaced with. */
export const DELIMITER_REMOVED = '[delimiter removed]';
/** What an empty page prompt or capability list reads as: a dynamic variable needs a value. */
export const NONE_PLACEHOLDER = '(none)';

/**
 * `text` with each delimiter replaced by {@link DELIMITER_REMOVED}: every
 * occurrence, left to right, as the engine's `str.replace` does. Replaced,
 * never deleted: deleting lets nested fragments such as
 * `<<<END APP<<<END APP DESCRIPTION>>> DESCRIPTION>>>` rejoin into a real fence.
 */
export function unfence(text: string): string {
  return text.split(PARTNER_PROMPT_BEGIN).join(DELIMITER_REMOVED).split(PARTNER_PROMPT_END).join(DELIMITER_REMOVED);
}

/**
 * The app's capabilities as `- name: description` lines (`- name` when the
 * description is empty), every name and description unfenced; or
 * {@link NONE_PLACEHOLDER} when there are none.
 */
export function formatCapabilities(capabilities: VoiceCapability[]): string {
  if (capabilities.length === 0) return NONE_PLACEHOLDER;
  return capabilities
    .map(({ name, description }) =>
      description ? `- ${unfence(name)}: ${unfence(description)}` : `- ${unfence(name)}`,
    )
    .join('\n');
}

/**
 * A tone cue: a bracketed word or short phrase of letters (one to three words,
 * joined by a space or a hyphen), such as `[sad]`, `[sighs]`, `[excited]`,
 * `[laughs softly]` or `[clears-throat]`. Eleven Realtime's agent writes them
 * into its lines to steer how it speaks; they are not words to show. Any other
 * bracket stays: `[Figure 2]`, `[1]`, `[see talk2view.com/pricing]`.
 *
 * It has the `g` flag, so its `lastIndex` is shared by everyone who holds it:
 * use it through `String.prototype.replace` (which resets it), as
 * {@link stripToneCues} does, never `test()` or `exec()`.
 */
export const TONE_CUE = /\[[A-Za-z]+(?:[ -][A-Za-z]+){0,2}\]/g;

/**
 * `text` without its tone cues ({@link TONE_CUE}). Where a cue was, the line
 * is closed up: runs of spaces become one, a space before `, . ; : ! ?` goes,
 * and the ends are trimmed, so `Hello [sad], there` reads `Hello, there`. A
 * line that was only a cue comes back empty.
 *
 * Text with no cue comes back exactly as it was, even where the clean-up would
 * change it: French sets a space before `!` and `?` ("Bonjour ! Comment
 * puis-je vous aider ?"), and a line with nothing to remove must still equal
 * the engine's greeting word for word.
 */
export function stripToneCues(text: string): string {
  const stripped = text.replace(TONE_CUE, ' ');
  if (stripped === text) return text; // a cue is three characters or more and becomes one, so equal means none
  return stripped.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?])/g, '$1').trim();
}
