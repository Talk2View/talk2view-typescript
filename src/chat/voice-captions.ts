/**
 * Call captions: the words of a voice call, from both sides, shown in the
 * voice panel while the call runs. These are the rules `<VoiceButton>` keeps
 * the list by, one `transcript` line at a time. The button holds the list in
 * React state only and empties it when the call ends: captions are stored
 * nowhere.
 */
import type { VoiceTranscript } from '../types.js';
import type { Talk2ViewChatFeatures } from './provider.js';

/**
 * What one side said until the other side spoke. `settled` is its final
 * lines, joined with spaces; `live` is the line it is still saying (a Gemini
 * Live partial), which its next line replaces.
 */
export interface Caption {
  role: 'user' | 'bot';
  settled: string;
  live: string;
  /**
   * Where the last final line starts in `settled`, so that a line that
   * replaces it rewrites that line alone. Without it, the whole of `settled`
   * is the last line.
   */
  lastLineAt?: number;
}

/** The most captions kept; the oldest go first. */
export const MAX_CAPTIONS = 40;

/** What a caption shows. */
export function captionText(c: Caption): string {
  return `${c.settled} ${c.live}`.trim();
}

/** The `callCaptions` prop when given, else the chat's `features.callCaptions`, else on. */
export function captionsEnabled(
  prop: boolean | undefined,
  features: Pick<Talk2ViewChatFeatures, 'callCaptions'> | undefined,
): boolean {
  return prop ?? features?.callCaptions ?? true;
}

/**
 * The list with one more line of the call. A line with no words in it (blank,
 * or only spaces) changes nothing, and the same list comes back.
 *
 * - The side that spoke last goes on in its caption: a partial line (`final:
 *   false`) replaces `live`, and a final one joins `settled` and clears `live`.
 * - The other side starts a new caption. What the previous caption left
 *   unfinished (`live`) is dropped, and that caption too if it is left with no
 *   words.
 * - A line that `replaces` (an ElevenLabs agent line cut short by the
 *   end-user) rewrites the last line of that side's most recent caption,
 *   wherever it is in the list, and never its earlier lines. With no words it
 *   removes that line, and the caption if it is left with none. With no
 *   caption of that side to rewrite, it is a final line of its own, or nothing.
 *
 * At most {@link MAX_CAPTIONS} are kept.
 */
export function appendCaption(list: Caption[], line: VoiceTranscript): Caption[] {
  const text = line.text.trim();
  if (line.replaces) return replaceLastLine(list, line.role, text);
  if (!text) return list;
  const last = list[list.length - 1];
  if (last?.role !== line.role) return startCaption(list, line.role, text, line.final);
  const next: Caption = line.final
    ? { ...last, ...withLastLine(last.settled, text), live: '' }
    : { ...last, live: text };
  return [...list.slice(0, -1), next];
}

/**
 * `earlier`, then `line` as the last line. With no `line` there is no last
 * line left to rewrite: a line that replaces it next goes after `earlier`.
 */
function withLastLine(earlier: string, line: string): Pick<Caption, 'settled' | 'lastLineAt'> {
  if (!line) return { settled: earlier, lastLineAt: earlier.length };
  if (!earlier) return { settled: line, lastLineAt: 0 };
  return { settled: `${earlier} ${line}`, lastLineAt: earlier.length + 1 };
}

/** A new caption at the end of the list. */
function startCaption(list: Caption[], role: Caption['role'], text: string, final: boolean): Caption[] {
  const caption: Caption = final ? { role, settled: text, live: '', lastLineAt: 0 } : { role, settled: '', live: text };
  return [...withoutUnfinished(list), caption].slice(-MAX_CAPTIONS);
}

/** The list without what its last caption left unfinished, and without that caption if it is left with no words. */
function withoutUnfinished(list: Caption[]): Caption[] {
  const last = list[list.length - 1];
  if (!last?.live) return list;
  const rest = list.slice(0, -1);
  return last.settled ? [...rest, { ...last, live: '' }] : rest;
}

/** A line that `replaces`, as {@link appendCaption} describes. */
function replaceLastLine(list: Caption[], role: Caption['role'], text: string): Caption[] {
  let at = list.length - 1;
  while (at >= 0 && list[at]?.role !== role) at -= 1;
  const caption = list[at];
  if (!caption) return text ? startCaption(list, role, text, true) : list;
  const earlier = caption.settled.slice(0, caption.lastLineAt ?? 0).trimEnd();
  // The line is final: whatever was still being said is over.
  const next: Caption = { ...caption, ...withLastLine(earlier, text), live: '' };
  return captionText(next)
    ? list.map((c, i) => (i === at ? next : c))
    : list.filter((_, i) => i !== at);
}
