import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';

const stop = vi.fn();
const sendMessage = vi.fn();
let isLoading = false;

vi.mock('../../src/ui/context', () => ({
  useChat: () => ({ sendMessage, isLoading, stop }),
  useTalk2View: () => ({ t2v: { transcribe: vi.fn() } }),
}));
vi.mock('../../src/react/useUserPreferences', () => ({
  useUserPreferences: () => ({ preferences: {} }),
}));
vi.mock('../../src/react/usePartnerConfig', () => ({
  usePartnerConfig: () => ({ config: {} }),
}));

import { Composer } from '../../src/ui/components/Composer';

describe('Composer send/stop button', () => {
  beforeEach(() => {
    stop.mockClear();
    sendMessage.mockClear();
  });

  it('shows a Send button (not Stop) when idle', () => {
    isLoading = false;
    const { queryByLabelText } = render(React.createElement(Composer));
    expect(queryByLabelText('Send message')).toBeTruthy();
    expect(queryByLabelText('Stop generating')).toBeNull();
  });

  it('shows a Stop button while a response is streaming, and calls stop() on click', () => {
    isLoading = true;
    const { getByLabelText, queryByLabelText } = render(React.createElement(Composer));
    expect(queryByLabelText('Send message')).toBeNull();
    const stopBtn = getByLabelText('Stop generating');
    expect((stopBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stopBtn);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
