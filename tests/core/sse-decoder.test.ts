import { describe, expect, it } from 'vitest';
import { decodeSSEStream } from '../../src/streaming';
import type { ChatCompletionChunk } from '../../src/types';

/**
 * Build a minimal Response whose body streams the given byte chunks in order.
 *
 * Each entry in `chunks` is emitted as one `reader.read()` result, which lets us
 * exercise event boundaries that fall *inside* a single network chunk as well as
 * events that are *split across* multiple chunks (the hard case for the buffer
 * logic in decodeSSEStream).
 */
function responseFromChunks(chunks: Array<string | Uint8Array>): Response {
  const encoder = new TextEncoder();
  const queue = chunks.map((c) => (typeof c === 'string' ? encoder.encode(c) : c));
  let i = 0;
  const reader = {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      if (i < queue.length) {
        return { done: false, value: queue[i++] };
      }
      return { done: true, value: undefined };
    },
    releaseLock() {},
  };
  return {
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
}

/** A Response whose first read() throws an AbortError, like an aborted fetch. */
function abortingResponse(): Response {
  const reader = {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      throw new DOMException('The user aborted a request.', 'AbortError');
    },
    releaseLock() {},
  };
  return { body: { getReader: () => reader } } as unknown as Response;
}

/** A Response whose first read() throws a non-abort error. */
function throwingResponse(err: Error): Response {
  const reader = {
    async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
      throw err;
    },
    releaseLock() {},
  };
  return { body: { getReader: () => reader } } as unknown as Response;
}

/** Serialize a chunk as one SSE event line ("data: {...}\n\n"). */
function sse(chunk: ChatCompletionChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

function textChunk(content: string, id = 'c'): ChatCompletionChunk {
  return {
    id,
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
    thread_id: 'thread_1',
  };
}

function interruptChunk(): ChatCompletionChunk {
  return {
    id: 'c',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    thread_id: 'thread_1',
    interrupt: {
      type: 'tool_call',
      tool_name: 'send_email',
      tool_call_id: 'call_42',
      arguments: { to: 'a@b.com', subject: 'Hi' },
    },
  };
}

async function collect(response: Response): Promise<ChatCompletionChunk[]> {
  const out: ChatCompletionChunk[] = [];
  for await (const chunk of decodeSSEStream(response)) out.push(chunk);
  return out;
}

describe('decodeSSEStream — happy path', () => {
  it('parses a sequence of well-formed events in order', async () => {
    const response = responseFromChunks([
      sse(textChunk('Hello', 'c1')),
      sse(textChunk(' world', 'c2')),
      'data: [DONE]\n\n',
    ]);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe('c1');
    expect(chunks[0].choices[0].delta.content).toBe('Hello');
    expect(chunks[1].id).toBe('c2');
    expect(chunks[1].choices[0].delta.content).toBe(' world');
  });

  it('parses multiple events delivered together in a single network chunk', async () => {
    const response = responseFromChunks([
      sse(textChunk('a', 'c1')) + sse(textChunk('b', 'c2')) + sse(textChunk('c', 'c3')),
      'data: [DONE]\n\n',
    ]);

    const chunks = await collect(response);

    expect(chunks.map((c) => c.choices[0].delta.content)).toEqual(['a', 'b', 'c']);
  });
});

describe('decodeSSEStream — split across network chunks', () => {
  it('reassembles a single event split across two reads', async () => {
    const full = sse(textChunk('reassembled', 'split'));
    const mid = Math.floor(full.length / 2);

    const response = responseFromChunks([full.slice(0, mid), full.slice(mid), 'data: [DONE]\n\n']);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].id).toBe('split');
    expect(chunks[0].choices[0].delta.content).toBe('reassembled');
  });

  it('reassembles an event whose JSON is split mid-token across three reads', async () => {
    const full = sse(textChunk('chunky-payload', 'three'));
    const a = full.slice(0, 5);
    const b = full.slice(5, 20);
    const c = full.slice(20);

    const response = responseFromChunks([a, b, c, 'data: [DONE]\n\n']);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe('chunky-payload');
  });

  it('handles a newline boundary that lands exactly between two reads', async () => {
    // First read ends right after the first event's trailing newline.
    const ev1 = sse(textChunk('one', 'c1'));
    const ev2 = sse(textChunk('two', 'c2'));

    const response = responseFromChunks([ev1, ev2 + 'data: [DONE]\n\n']);

    const chunks = await collect(response);

    expect(chunks.map((c) => c.choices[0].delta.content)).toEqual(['one', 'two']);
  });
});

describe('decodeSSEStream — tool-call interrupt chunk', () => {
  it('yields the interrupt payload intact', async () => {
    const response = responseFromChunks([sse(interruptChunk()), 'data: [DONE]\n\n']);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].interrupt).toEqual({
      type: 'tool_call',
      tool_name: 'send_email',
      tool_call_id: 'call_42',
      arguments: { to: 'a@b.com', subject: 'Hi' },
    });
  });

  it('reassembles an interrupt chunk split across reads', async () => {
    const full = sse(interruptChunk());
    const mid = Math.floor(full.length / 2);

    const response = responseFromChunks([full.slice(0, mid), full.slice(mid), 'data: [DONE]\n\n']);

    const chunks = await collect(response);

    expect(chunks[0].interrupt?.tool_name).toBe('send_email');
    expect(chunks[0].interrupt?.arguments).toEqual({ to: 'a@b.com', subject: 'Hi' });
  });
});

describe('decodeSSEStream — [DONE] terminator', () => {
  it('stops yielding after [DONE], ignoring any trailing events', async () => {
    const response = responseFromChunks([
      sse(textChunk('before', 'c1')),
      'data: [DONE]\n\n',
      // Anything after [DONE] must not be emitted.
      sse(textChunk('after', 'c2')),
    ]);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe('before');
  });

  it('terminates when [DONE] shares a network chunk with a preceding event', async () => {
    const response = responseFromChunks([
      sse(textChunk('last', 'c1')) + 'data: [DONE]\n\n' + sse(textChunk('ignored', 'c2')),
    ]);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe('last');
  });
});

describe('decodeSSEStream — malformed and non-data lines', () => {
  it('skips malformed JSON but still yields valid events before and after', async () => {
    const response = responseFromChunks([
      sse(textChunk('good1', 'c1')),
      'data: {not valid json}\n\n',
      sse(textChunk('good2', 'c2')),
      'data: [DONE]\n\n',
    ]);

    const chunks = await collect(response);

    expect(chunks.map((c) => c.choices[0].delta.content)).toEqual(['good1', 'good2']);
  });

  it('ignores SSE comment lines, blank lines, and non-data fields', async () => {
    const response = responseFromChunks([
      ': this is a heartbeat comment\n',
      '\n',
      'event: message\n',
      'id: 99\n',
      sse(textChunk('survives', 'c1')),
      'data: [DONE]\n\n',
    ]);

    const chunks = await collect(response);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].choices[0].delta.content).toBe('survives');
  });

  it('yields nothing for a body with no data lines', async () => {
    const response = responseFromChunks([': keepalive\n\nevent: ping\n\n']);

    const chunks = await collect(response);

    expect(chunks).toEqual([]);
  });
});

describe('decodeSSEStream — empty / aborted / error streams', () => {
  it('returns immediately when the response has no body', async () => {
    const response = { body: null } as unknown as Response;

    const chunks = await collect(response);

    expect(chunks).toEqual([]);
  });

  it('ends cleanly (no throw, no events) when the fetch is aborted mid-read', async () => {
    const chunks = await collect(abortingResponse());

    expect(chunks).toEqual([]);
  });

  it('propagates non-abort read errors to the consumer', async () => {
    const boom = new TypeError('network failure');
    await expect(collect(throwingResponse(boom))).rejects.toThrow('network failure');
  });
});

describe('decodeSSEStream — data: prefix spec compliance', () => {
  // Per the EventStream spec the space after `data:` is optional; spaced and
  // unspaced lines must decode identically, and `[DONE]` terminates either way.
  const json = (content: string) => JSON.stringify(textChunk(content));

  it('parses "data: {json}" (with the optional space)', async () => {
    const chunks = await collect(responseFromChunks([`data: ${json('hi')}\n\n`]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('hi');
  });

  it('parses "data:{json}" (no space) identically to the spaced form', async () => {
    const spaced = await collect(responseFromChunks([`data: ${json('hi')}\n\n`]));
    const unspaced = await collect(responseFromChunks([`data:${json('hi')}\n\n`]));
    expect(unspaced).toHaveLength(1);
    expect(unspaced[0]?.choices[0]?.delta.content).toBe('hi');
    expect(unspaced[0]?.choices[0]?.delta.content).toBe(spaced[0]?.choices[0]?.delta.content);
  });

  it('terminates on "data:[DONE]" (no space)', async () => {
    const chunks = await collect(
      responseFromChunks([`data:${json('one')}\n\ndata:[DONE]\n\ndata:${json('after')}\n\n`]),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('one');
  });

  it('terminates on "data: [DONE]" (with space)', async () => {
    const chunks = await collect(responseFromChunks([`data: ${json('one')}\n\ndata: [DONE]\n\n`]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.choices[0]?.delta.content).toBe('one');
  });

  it('parses a stream mixing spaced and unspaced events in order', async () => {
    const chunks = await collect(
      responseFromChunks([
        [`data: ${json('a')}`, '', `data:${json('b')}`, '', `data: ${json('c')}`, '', 'data:[DONE]', ''].join('\n'),
      ]),
    );
    expect(chunks.map((c) => c.choices[0]?.delta.content)).toEqual(['a', 'b', 'c']);
  });

  it('preserves a tool_call interrupt carried on an unspaced data line', async () => {
    const chunks = await collect(responseFromChunks([`data:${JSON.stringify(interruptChunk())}\n\n`]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.interrupt).toEqual(interruptChunk().interrupt);
  });
});
