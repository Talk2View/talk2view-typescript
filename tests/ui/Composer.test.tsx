import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const stop = vi.fn();
const sendMessage = vi.fn();
const uploadAttachment = vi.fn();
let isLoading = false;

vi.mock('../../src/ui/context', () => ({
  useChat: () => ({ sendMessage, isLoading, stop }),
  useTalk2View: () => ({ t2v: { transcribe: vi.fn(), uploadAttachment } }),
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

describe('Composer attachments', () => {
  const ATTACHMENT = { id: 'att_1', filename: 'scan.png', mime_type: 'image/png', size_bytes: 4 };

  beforeEach(() => {
    isLoading = false;
    sendMessage.mockClear();
    sendMessage.mockResolvedValue(undefined);
    uploadAttachment.mockClear();
    uploadAttachment.mockResolvedValue(ATTACHMENT);
  });

  function attachFile(container: HTMLElement, file: File) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('renders an attach button and a hidden file input', () => {
    const { getByLabelText, container } = render(React.createElement(Composer));
    expect(getByLabelText('Attach file')).toBeTruthy();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain('image/png');
    expect(input.accept).toContain('application/pdf');
  });

  it('uploads the selected file and shows a chip', async () => {
    const { container, findByText } = render(React.createElement(Composer));
    attachFile(container, new File([new Uint8Array(4)], 'scan.png', { type: 'image/png' }));

    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(await findByText('scan.png')).toBeTruthy();
  });

  it('sends attachments with the message and clears the chips', async () => {
    const { container, getByLabelText, getByPlaceholderText, queryByText, findByText } = render(
      React.createElement(Composer),
    );
    attachFile(container, new File([new Uint8Array(4)], 'scan.png', { type: 'image/png' }));
    await findByText('scan.png');

    fireEvent.change(getByPlaceholderText('Type a message…'), { target: { value: 'look' } });
    fireEvent.click(getByLabelText('Send message'));

    expect(sendMessage).toHaveBeenCalledWith('look', { attachments: [ATTACHMENT] });
    await waitFor(() => expect(queryByText('scan.png')).toBeNull());
  });

  it('allows sending attachments without text', async () => {
    const { container, getByLabelText, findByText } = render(React.createElement(Composer));
    attachFile(container, new File([new Uint8Array(4)], 'scan.png', { type: 'image/png' }));
    await findByText('scan.png');

    const sendBtn = getByLabelText('Send message') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(false);
    fireEvent.click(sendBtn);
    expect(sendMessage).toHaveBeenCalledWith('', { attachments: [ATTACHMENT] });
  });

  it('removes a chip when its remove button is clicked', async () => {
    const { container, findByText, getByLabelText, queryByText } = render(
      React.createElement(Composer),
    );
    attachFile(container, new File([new Uint8Array(4)], 'scan.png', { type: 'image/png' }));
    await findByText('scan.png');

    fireEvent.click(getByLabelText('Remove scan.png'));
    expect(queryByText('scan.png')).toBeNull();
  });

  it('drops the chip and logs when the upload fails', async () => {
    uploadAttachment.mockRejectedValue(new Error('too big'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, queryByText } = render(React.createElement(Composer));
    attachFile(container, new File([new Uint8Array(4)], 'bad.png', { type: 'image/png' }));

    await waitFor(() => expect(queryByText('bad.png')).toBeNull());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
