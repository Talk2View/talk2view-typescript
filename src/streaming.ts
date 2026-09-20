/**
 * SSE stream decoder — parses Server-Sent Events into typed chunks.
 */

import type { ChatCompletionChunk } from './types.js';

/**
 * Decode an SSE response body into an async generator of ChatCompletionChunk.
 */
export async function* decodeSSEStream(
  response: Response,
): AsyncGenerator<ChatCompletionChunk> {
  const body = response.body;
  if (!body) {
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await reader.read();
      } catch (err) {
        // The fetch was aborted (e.g. user pressed "stop") — end the stream
        // cleanly rather than surfacing an AbortError to the consumer.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        throw err;
      }
      const { done, value } = result;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        // Strip the "data:" prefix, then a single optional leading space.
        // Per the EventStream spec the space after the colon is optional and
        // is removed if present, so "data:{json}" and "data: {json}" are
        // equivalent. Matching only "data: " (with space) silently dropped
        // spec-compliant unspaced lines.
        let data = trimmed.slice(5);
        if (data.startsWith(' ')) data = data.slice(1);
        if (data === '[DONE]') {
          return;
        }

        try {
          const chunk: ChatCompletionChunk = JSON.parse(data);
          yield chunk;
        } catch {
          // A frame we cannot parse means the reply the end-user is reading is
          // missing a piece, and skipping in silence leaves no way to find out
          // why. Keep going — one bad frame should not end a live answer — but
          // say so, once per frame, with enough of it to identify.
          console.warn(
            '[Talk2View] Skipped an unparseable stream frame:',
            data.length > 200 ? `${data.slice(0, 200)}…` : data,
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
