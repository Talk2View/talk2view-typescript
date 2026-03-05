import { describe, expect, it, vi } from 'vitest';
import { T2VTools } from '../../src/tools';
import type { T2VClient } from '../../src/client';
import type { ClientTool } from '../../src/types';

function makeTools(tools: ClientTool[]): T2VTools {
  const fakeClient = {
    request: vi.fn().mockResolvedValue({ registered: tools.map((t) => t.name), count: tools.length }),
  } as unknown as T2VClient;
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
