/**
 * Tests for the SSE stream decoder (`decodeSSEStream`).
 *
 * Focus: spec-compliance of `data:` line parsing. Per the EventStream spec a
 * producer may emit `data:{json}` with NO space after the colon (the space is
 * optional and stripped if present). The decoder must treat spaced and unspaced
 * lines identically.
 */
import { describe, expect, it } from 'vitest';
import { decodeSSEStream } from '../../src/streaming';
import type { ChatCompletionChunk } from '../../src/types';

/** Build a Response whose body streams the given raw SSE text. */
function sseResponse(raw: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  });
  return new Response(body);
}

async function collect(raw: string): Promise<ChatCompletionChunk[]> {
  const chunks: ChatCompletionChunk[] = [];
  for await (const chunk of decodeSSEStream(sseResponse(raw))) {
    chunks.push(chunk);
  }
  return chunks;
}

const chunkJson = (content: string) =>
  JSON.stringify({
    id: 'cmpl-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  });

describe('decodeSSEStream — data: prefix spec compliance', () => {
  it('parses "data: {json}" (with the optional space)', async () => {
    const chunks = await collect(`data: ${chunkJson('hi')}\n\n`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('hi');
  });

  it('parses "data:{json}" (no space) identically to the spaced form', async () => {
    const spaced = await collect(`data: ${chunkJson('hi')}\n\n`);
    const unspaced = await collect(`data:${chunkJson('hi')}\n\n`);
    // The no-space line must not be dropped — both forms decode to the same chunk.
    expect(unspaced).toHaveLength(1);
    expect(unspaced).toEqual(spaced);
    expect(unspaced[0]?.choices[0]?.delta.content).toBe('hi');
  });

  it('terminates on "data:[DONE]" (no space)', async () => {
    const chunks = await collect(
      `data:${chunkJson('one')}\n\ndata:[DONE]\n\ndata:${chunkJson('after')}\n\n`,
    );
    // Chunks after the unspaced [DONE] sentinel must not be yielded.
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('one');
  });

  it('terminates on "data: [DONE]" (with space)', async () => {
    const chunks = await collect(`data: ${chunkJson('one')}\n\ndata: [DONE]\n\n`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('one');
  });

  it('parses a stream mixing spaced and unspaced events in order', async () => {
    const chunks = await collect(
      [
        `data: ${chunkJson('a')}`,
        '',
        `data:${chunkJson('b')}`,
        '',
        `data: ${chunkJson('c')}`,
        '',
        'data:[DONE]',
        '',
      ].join('\n'),
    );
    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(['a', 'b', 'c']);
  });

  it('preserves a tool_call interrupt carried on an unspaced data line', async () => {
    const interruptJson = JSON.stringify({
      id: 'cmpl-2',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'm',
      choices: [{ index: 0, delta: {}, finish_reason: null }],
      interrupt: {
        type: 'tool_call',
        tool_name: 'set_view',
        tool_call_id: 'call_1',
        arguments: { plane: 'axial' },
      },
    });
    const chunks = await collect(`data:${interruptJson}\n\n`);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.interrupt).toEqual({
      type: 'tool_call',
      tool_name: 'set_view',
      tool_call_id: 'call_1',
      arguments: { plane: 'axial' },
    });
  });
});
