/**
 * The fence guard for an ElevenLabs call's instructions.
 *
 * The engine puts the partner prompt, the page prompt and the app's
 * capabilities between two delimiters in the agent's instructions. An
 * ElevenLabs call's page prompt and capabilities reach the agent as dynamic
 * variables inside that fence, so the SDK guards them as the engine does:
 * nothing from the page or a tool can close the fence early. Each function
 * gives exactly the engine's text for the same input
 * (`t2v/core/voice_rules.py`), so the instructions read the same whichever
 * voice model takes the call.
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
