/**
 * SSE stream decoder — parses Server-Sent Events into typed chunks.
 */

import type { ChatCompletionChunk } from './types';

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
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6); // Remove "data: " prefix
        if (data === '[DONE]') {
          return;
        }

        try {
          const chunk: ChatCompletionChunk = JSON.parse(data);
          yield chunk;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
