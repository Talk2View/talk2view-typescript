import { afterEach, describe, expect, it, vi } from 'vitest';
import { Talk2View } from '../../src/index';
import { T2VTools } from '../../src/tools';
import type { T2VClient } from '../../src/client';
import type { ClientTool, ClientToolSchema } from '../../src/types';

function makeFakeClient(tools: ClientTool[]) {
  return {
    request: vi.fn().mockResolvedValue({ registered: tools.map((t) => t.name), count: tools.length }),
  } as unknown as T2VClient;
}

function makeTools(tools: ClientTool[]): T2VTools {
  const fakeClient = makeFakeClient(tools);
  const t2vTools = new T2VTools(fakeClient);
  // Register synchronously by calling register (which hits the mock client)
  return t2vTools;
}

async function setupTools(tools: ClientTool[]): Promise<T2VTools> {
  const t = makeTools(tools);
  await t.register(tools);
  return t;
}

describe('T2VTools.validateArgs', () => {
  const sampleTool: ClientTool = {
    name: 'test_tool',
    description: 'A test tool',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name' },
        count: { type: 'number', description: 'Count' },
        active: { type: 'boolean', description: 'Active' },
        mode: { type: 'string', description: 'Mode', enum: ['fast', 'slow'] },
        items: { type: 'array', description: 'Items' },
        config: { type: 'object', description: 'Config' },
      },
      required: ['name', 'count'],
    },
    execute: async () => 'ok',
  };

  it('rejects missing required arguments', async () => {
    const tools = await setupTools([sampleTool]);
    const result = await tools.executeToolCall('test_tool', {});
    expect(result.isError).toBe(true);
    expect(result.result).toContain('Missing required argument');
    expect(result.result).toContain('name');
  });

  it('rejects wrong types', async () => {
    const tools = await setupTools([sampleTool]);
    const result = await tools.executeToolCall('test_tool', { name: 123, count: 5 });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.result);
    expect(parsed.error).toContain('expected type');
    expect(parsed.error).toContain('string');
  });

  it('rejects invalid enum values', async () => {
    const tools = await setupTools([sampleTool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'test',
      count: 1,
      mode: 'turbo',
    });
    expect(result.isError).toBe(true);
    expect(result.result).toContain('must be one of');
    expect(result.result).toContain('fast');
  });

  it('accepts a differently-cased enum value and normalizes it to canonical casing', async () => {
    const handler = vi.fn().mockResolvedValue('success');
    const tool: ClientTool = {
      ...sampleTool,
      execute: handler,
    };
    const tools = await setupTools([tool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'test',
      count: 1,
      mode: 'FAST',
    });
    expect(result.isError).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
    // Handler receives the schema's canonical casing, not the model's casing.
    expect(handler.mock.calls[0][0]).toMatchObject({ mode: 'fast' });
  });

  it('still rejects an enum value that does not match any variant case-insensitively', async () => {
    const tools = await setupTools([sampleTool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'test',
      count: 1,
      mode: 'Turbo',
    });
    expect(result.isError).toBe(true);
    expect(result.result).toContain('must be one of');
    expect(result.result).toContain('fast');
  });

  it('leaves non-enum args untouched when normalizing enums', async () => {
    const handler = vi.fn().mockResolvedValue('success');
    const tool: ClientTool = {
      ...sampleTool,
      execute: handler,
    };
    const tools = await setupTools([tool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'KeepCase',
      count: 7,
      mode: 'Slow',
    });
    expect(result.isError).toBe(false);
    expect(handler).toHaveBeenCalledOnce();
    // Enum normalized, but the free-text "name" arg keeps its original casing.
    expect(handler.mock.calls[0][0]).toMatchObject({ name: 'KeepCase', count: 7, mode: 'slow' });
  });

  it('passes valid args through to the handler', async () => {
    const handler = vi.fn().mockResolvedValue('success');
    const tool: ClientTool = {
      ...sampleTool,
      execute: handler,
    };
    const tools = await setupTools([tool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'hello',
      count: 42,
      mode: 'fast',
      active: true,
      items: [1, 2],
      config: { a: 1 },
    });
    expect(result.isError).toBe(false);
    expect(result.result).toBe('success');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('validates array type correctly', async () => {
    const tools = await setupTools([sampleTool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'test',
      count: 1,
      items: 'not-an-array',
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.result);
    expect(parsed.error).toContain('expected type');
    expect(parsed.error).toContain('array');
  });

  it('validates object type correctly (rejects arrays)', async () => {
    const tools = await setupTools([sampleTool]);
    const result = await tools.executeToolCall('test_tool', {
      name: 'test',
      count: 1,
      config: [1, 2],
    });
    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.result);
    expect(parsed.error).toContain('expected type');
    expect(parsed.error).toContain('object');
  });
});

describe('T2VTools null stripping', () => {
  const toolWithOptional: ClientTool = {
    name: 'optional_tool',
    description: 'Tool with optional params',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query' },
        page: { type: 'number', description: 'Page number' },
        case_sensitive: { type: 'boolean', description: 'Case sensitive' },
      },
      required: ['query'],
    },
    execute: async (args) => JSON.stringify(args),
  };

  it('strips null values from args before validation', async () => {
    const tools = await setupTools([toolWithOptional]);
    const result = await tools.executeToolCall('optional_tool', {
      query: 'hello',
      page: null as unknown as number,
      case_sensitive: null as unknown as boolean,
    });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.result);
    expect(parsed).toEqual({ query: 'hello' });
    expect(parsed).not.toHaveProperty('page');
    expect(parsed).not.toHaveProperty('case_sensitive');
  });

  it('strips undefined values from args', async () => {
    const tools = await setupTools([toolWithOptional]);
    const result = await tools.executeToolCall('optional_tool', {
      query: 'hello',
      page: undefined,
    });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.result);
    expect(parsed).toEqual({ query: 'hello' });
  });

  it('still rejects null for required params', async () => {
    const tools = await setupTools([toolWithOptional]);
    const result = await tools.executeToolCall('optional_tool', {
      query: null as unknown as string,
    });
    expect(result.isError).toBe(true);
    expect(result.result).toContain('Missing required argument');
  });

  it('passes real values through unchanged', async () => {
    const tools = await setupTools([toolWithOptional]);
    const result = await tools.executeToolCall('optional_tool', {
      query: 'hello',
      page: 5,
      case_sensitive: true,
    });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.result);
    expect(parsed).toEqual({ query: 'hello', page: 5, case_sensitive: true });
  });

  it('strips empty-object placeholders an LLM sends for optional params', async () => {
    // Repro: some models pass `{}` (not null) for an optional param they don't
    // intend to set — e.g. navigate_to_page with `section: {}` to mean "no
    // section". It must be treated as unset, not rejected as a type error.
    const toolWithOptionalString: ClientTool = {
      name: 'nav_tool',
      description: 'Navigate, optionally to a section',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page id' },
          section: { type: 'string', description: 'Optional anchor' },
        },
        required: ['page'],
      },
      execute: async (args) => JSON.stringify(args),
    };
    const tools = await setupTools([toolWithOptionalString]);
    const result = await tools.executeToolCall('nav_tool', {
      page: 'company',
      section: {} as unknown as string,
    });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.result);
    expect(parsed).toEqual({ page: 'company' });
    expect(parsed).not.toHaveProperty('section');
  });
});

describe('T2VTools permission checking', () => {
  it('checkPermission returns allow for tools without permission config', async () => {
    const tool: ClientTool = {
      name: 'safe_tool',
      description: 'A safe tool',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    };
    const tools = await setupTools([tool]);
    const result = await tools.checkPermission('safe_tool', {});
    expect(result).toEqual({ action: 'allow' });
  });

  it('checkPermission returns require_approval for permission: true', async () => {
    const tool: ClientTool = {
      name: 'risky_tool',
      description: 'A risky tool',
      parameters: { type: 'object', properties: {} },
      permission: true,
      execute: async () => 'ok',
    };
    const tools = await setupTools([tool]);
    const result = await tools.checkPermission('risky_tool', {});
    expect(result).toEqual({ action: 'require_approval' });
  });

  it('checkPermission returns allow for unknown tools', async () => {
    const tools = await setupTools([]);
    const result = await tools.checkPermission('nonexistent', {});
    expect(result).toEqual({ action: 'allow' });
  });

  it('checkPermission calls callback and returns allow', async () => {
    const callback = vi.fn().mockResolvedValue({ type: 'allow' });
    const tool: ClientTool = {
      name: 'callback_tool',
      description: 'Callback tool',
      parameters: { type: 'object', properties: {} },
      permission: callback,
      execute: async () => 'ok',
    };
    const tools = await setupTools([tool]);
    const result = await tools.checkPermission('callback_tool', { x: 1 });
    expect(callback).toHaveBeenCalledWith('callback_tool', { x: 1 });
    expect(result).toEqual({ action: 'allow' });
  });

  it('checkPermission callback can return allow with updatedInput', async () => {
    const callback = vi.fn().mockResolvedValue({
      type: 'allow',
      updatedInput: { x: 99 },
    });
    const tool: ClientTool = {
      name: 'modify_tool',
      description: 'Modifies args',
      parameters: { type: 'object', properties: {} },
      permission: callback,
      execute: async () => 'ok',
    };
    const tools = await setupTools([tool]);
    const result = await tools.checkPermission('modify_tool', { x: 1 });
    expect(result).toEqual({ action: 'allow', updatedInput: { x: 99 } });
  });

  it('checkPermission callback can return deny with message', async () => {
    const callback = vi.fn().mockResolvedValue({
      type: 'deny',
      message: 'Not allowed in production',
    });
    const tool: ClientTool = {
      name: 'denied_tool',
      description: 'Denied tool',
      parameters: { type: 'object', properties: {} },
      permission: callback,
      execute: async () => 'ok',
    };
    const tools = await setupTools([tool]);
    const result = await tools.checkPermission('denied_tool', {});
    expect(result).toEqual({ action: 'deny', message: 'Not allowed in production' });
  });

  it('tracks permission across multiple tools', async () => {
    const toolA: ClientTool = {
      name: 'auto_tool',
      description: 'Auto',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    };
    const toolB: ClientTool = {
      name: 'approval_tool',
      description: 'Needs approval',
      parameters: { type: 'object', properties: {} },
      permission: true,
      execute: async () => 'ok',
    };
    const tools = await setupTools([toolA, toolB]);
    expect(await tools.checkPermission('auto_tool', {})).toEqual({ action: 'allow' });
    expect(await tools.checkPermission('approval_tool', {})).toEqual({ action: 'require_approval' });
  });

  it('getDescription returns tool description', async () => {
    const tool: ClientTool = {
      name: 'my_tool',
      description: 'Does something important',
      parameters: { type: 'object', properties: {} },
      execute: async () => 'ok',
    };
    const tools = await setupTools([tool]);
    expect(tools.getDescription('my_tool')).toBe('Does something important');
  });

  it('getDescription returns empty string for unknown tools', async () => {
    const tools = await setupTools([]);
    expect(tools.getDescription('unknown')).toBe('');
  });

  it('does not send permission to the server', async () => {
    const fakeClient = makeFakeClient([]);
    const tools = new T2VTools(fakeClient);
    const tool: ClientTool = {
      name: 'risky_tool',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      permission: true,
      execute: async () => 'ok',
    };
    await tools.register([tool]);
    const body = JSON.parse((fakeClient.request as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    // The schema sent to server should not include permission
    expect(body.tools[0]).not.toHaveProperty('permission');
  });
});

describe('handlers and register()', () => {
  const schema = (name: string, extra: Partial<ClientToolSchema> = {}): ClientToolSchema => ({
    name,
    description: `The ${name} tool`,
    parameters: { type: 'object', properties: {} },
    ...extra,
  });

  it('keeps a handler attached with handle() before register(), as the README does it', async () => {
    const tools = new T2VTools(makeFakeClient([]));
    const handler = vi.fn().mockResolvedValue('10:00');

    tools.handle('get_time', handler);
    await tools.register([schema('get_time')]);

    expect(tools.hasHandler('get_time')).toBe(true);
    await expect(tools.executeToolCall('get_time', {})).resolves.toEqual({ result: '10:00', isError: false });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('applies the permission the definition gives to a handler attached before it', async () => {
    const tools = new T2VTools(makeFakeClient([]));
    tools.handle('delete_all', async () => 'done');
    await tools.register([schema('delete_all', { permission: true })]);

    expect(tools.hasHandler('delete_all')).toBe(true);
    await expect(tools.checkPermission('delete_all', {})).resolves.toEqual({ action: 'require_approval' });
  });

  it('still works the other way round: register() first, then handle()', async () => {
    const tools = new T2VTools(makeFakeClient([]));
    await tools.register([schema('get_time')]);
    tools.handle('get_time', async () => '11:00');

    expect(tools.hasHandler('get_time')).toBe(true);
    await expect(tools.executeToolCall('get_time', {})).resolves.toEqual({ result: '11:00', isError: false });
  });

  it('lets a definition’s own execute replace a handler attached earlier', async () => {
    const tools = new T2VTools(makeFakeClient([]));
    const older = vi.fn().mockResolvedValue('older');
    tools.handle('get_time', older);
    await tools.register([{ ...schema('get_time'), execute: async () => 'newer' }]);

    await expect(tools.executeToolCall('get_time', {})).resolves.toEqual({ result: 'newer', isError: false });
    expect(older).not.toHaveBeenCalled();
  });

  it('drops the handler and the permission of a tool the next register() leaves out', async () => {
    const tools = new T2VTools(makeFakeClient([]));
    tools.handle('get_time', async () => '10:00');
    await tools.register([
      schema('get_time'),
      { ...schema('wipe', { permission: true }), execute: async () => 'wiped' },
    ]);
    expect(tools.hasHandler('wipe')).toBe(true);

    await tools.register([schema('get_time')]);

    // A withdrawn tool must not stay runnable: with no schema left, nothing
    // would validate its arguments either.
    expect(tools.hasHandler('wipe')).toBe(false);
    await expect(tools.executeToolCall('wipe', {})).resolves.toMatchObject({ isError: true });
    await expect(tools.checkPermission('wipe', {})).resolves.toEqual({ action: 'allow' });
    expect(tools.hasHandler('get_time')).toBe(true);
  });

  it('keeps every handler when the same schemas are registered again', async () => {
    const tools = new T2VTools(makeFakeClient([]));
    tools.handle('get_time', async () => '10:00');
    tools.handle('get_date', async () => '9 October');
    const schemas = [schema('get_time'), schema('get_date')];

    await tools.register(schemas);
    await tools.register(schemas);

    await expect(tools.executeToolCall('get_time', {})).resolves.toEqual({ result: '10:00', isError: false });
    await expect(tools.executeToolCall('get_date', {})).resolves.toEqual({ result: '9 October', isError: false });
    expect(tools.getRegistered().map((s) => s.name)).toEqual(['get_time', 'get_date']);
  });
});

describe('the README quick start, end to end', () => {
  /** A JSON answer, shaped like the parts of a Response the client reads. */
  const json = (body: unknown) =>
    ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

  /** An SSE answer: one `data:` line per chunk. */
  function sse(...chunks: object[]): Response {
    const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('');
    return new Response(text, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }

  const chunk = (extra: object) => ({
    id: 'c',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'm',
    thread_id: 'th_1',
    ...extra,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('runs a tool attached with handle() before register(), and posts its result to /resume', async () => {
    const sent: Array<{ path: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
        switch (path) {
          case '/v1/auth/login':
            return json({
              access_token: 'a',
              refresh_token: 'r',
              token_type: 'bearer',
              expires_in: 3600,
              user: { id: 'u1', email: 'user@example.com' },
            });
          case '/v1/tools/register':
            return json({ registered: ['get_time'], count: 1 });
          case '/v1/sessions':
            return json({ session_id: 's1', thread_id: 'th_1', model: 'm' });
          case '/v1/sessions/s1/messages':
            return sse(
              chunk({
                choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
                interrupt: { type: 'tool_call', tool_name: 'get_time', tool_call_id: 'call_1', arguments: {} },
              }),
            );
          case '/v1/sessions/s1/resume':
            return sse(
              chunk({ choices: [{ index: 0, delta: { content: 'It is 10:00.' }, finish_reason: null }] }),
              chunk({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }),
            );
          default:
            throw new Error(`unexpected request to ${path}`);
        }
      }),
    );

    // The README's vanilla quick start, step for step.
    const t2v = new Talk2View({ partnerKey: 'pk_live_x', baseUrl: 'https://engine.test' });
    await t2v.auth.login('user@example.com', 'password');
    t2v.tools.handle('get_time', async () => '2026-10-09T10:00:00.000Z');
    await t2v.tools.register([
      {
        name: 'get_time',
        description: 'Get the current time',
        parameters: { type: 'object', properties: {} },
      },
    ]);

    let reply = '';
    for await (const event of t2v.chat('What time is it?')) {
      if (event.type === 'text') reply += event.content;
    }

    const resume = sent.find((r) => r.path === '/v1/sessions/s1/resume');
    expect(resume?.body).toEqual({
      tool_call_id: 'call_1',
      result: '2026-10-09T10:00:00.000Z',
      is_error: false,
    });
    expect(reply).toBe('It is 10:00.');
  });
});
