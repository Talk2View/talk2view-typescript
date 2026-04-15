import { describe, expect, it, vi } from 'vitest';
import { T2VTools } from '../../src/tools';
import type { T2VClient } from '../../src/client';
import type { ClientTool } from '../../src/types';

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
