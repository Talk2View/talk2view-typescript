/**
 * The runtime's tool registration against the REAL T2VTools.
 *
 * runtime.test.tsx mocks T2VTools, so it cannot see the order the two calls
 * land in. Here they are real: `register()` rebuilds the handler map from what
 * it is given, and the runtime gives it schemas without `execute`. Adding the
 * handlers BEFORE that call left the map empty, so every client tool answered
 * "Unknown tool" — hidden in development, where StrictMode runs the effect a
 * second time (handlers re-added, register skipped as unchanged), and live in
 * a production build, where it runs once. Voice runs tools straight from this
 * map, so on talk2view.com it could use none of the site's tools.
 */
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    streamRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({ onAuthStateChange: vi.fn(), getUser: vi.fn().mockReturnValue(null) })),
}));

import { Talk2View } from '../../src/index';
import { useTalk2ViewRuntimeForClient } from '../../src/assistant-ui';
import type { ClientTool } from '../../src/types';

const tools: ClientTool[] = [
  {
    name: 'get_time',
    description: 'The time',
    parameters: { type: 'object', properties: {} },
    execute: async () => '10:00',
  },
];

function Host({ t2v }: { t2v: Talk2View }) {
  useTalk2ViewRuntimeForClient(t2v, { tools });
  return null;
}

describe('client tool handlers', () => {
  it('survive registration when the effect runs once, as in a production build', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test_x' });
    const register = vi.spyOn(t2v.tools, 'register');
    // No <StrictMode>: its second effect run is what hid this in development.
    render(<Host t2v={t2v} />);
    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));

    expect(t2v.tools.hasHandler('get_time')).toBe(true);
    await expect(t2v.tools.executeToolCall('get_time', {})).resolves.toMatchObject({
      result: '10:00',
      isError: false,
    });
  });
});
