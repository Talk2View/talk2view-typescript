import { describe, expect, it, vi } from 'vitest';
import { Talk2View } from '../../src/index';
import { T2VSession } from '../../src/sessions';
import type { T2VClient } from '../../src/client';
import type { T2VTools } from '../../src/tools';
import type { Attachment, ChatCompletionChunk, ChatEvent } from '../../src/types';

function stopChunk(): ChatCompletionChunk {
  return {
    id: 'test',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test',
    choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }],
    thread_id: 'thread_1',
  };
}

async function collectEvents(gen: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const e of gen) events.push(e);
  return events;
}

function createMockClient(): T2VClient {
  return {
    streamRequest: vi.fn().mockImplementation(async function* () {
      yield stopChunk();
    }),
    uploadRequest: vi.fn().mockResolvedValue({
      id: 'att_1',
      filename: 'scan.png',
      mime_type: 'image/png',
      size_bytes: 4,
    }),
  } as unknown as T2VClient;
}

function createSession(client: T2VClient): T2VSession {
  return new T2VSession(
    { session_id: 'sess_1', thread_id: 'thread_1', model: 'test' },
    client,
    { hasHandler: vi.fn().mockReturnValue(false) } as unknown as T2VTools,
  );
}

const ATTACHMENT: Attachment = {
  id: 'att_1',
  filename: 'scan.png',
  mime_type: 'image/png',
  size_bytes: 4,
};

describe('T2VSession.sendMessage — attachments', () => {
  it('sends plain string content when no attachments (regression)', async () => {
    const client = createMockClient();
    const session = createSession(client);
    await collectEvents(session.sendMessage('hello'));

    const body = (client.streamRequest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('sends structured content parts when attachments are provided', async () => {
    const client = createMockClient();
    const session = createSession(client);
    await collectEvents(session.sendMessage('look at this', { attachments: [ATTACHMENT] }));

    const body = (client.streamRequest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          { type: 'attachment', attachment_id: 'att_1' },
        ],
      },
    ]);
  });

  it('omits the text part when content is empty', async () => {
    const client = createMockClient();
    const session = createSession(client);
    await collectEvents(session.sendMessage('', { attachments: [ATTACHMENT] }));

    const body = (client.streamRequest as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.messages[0].content).toEqual([
      { type: 'attachment', attachment_id: 'att_1' },
    ]);
  });
});

describe('Talk2View.uploadAttachment', () => {
  it('uploads via multipart and returns attachment metadata', async () => {
    const t2v = new Talk2View({ partnerKey: 'pk_test', anonymousAutoStart: false });
    const client = createMockClient();
    (t2v as unknown as { client: T2VClient }).client = client;

    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
    const result = await t2v.uploadAttachment(blob, 'scan.png');

    expect(result).toEqual(ATTACHMENT);
    const uploadMock = client.uploadRequest as ReturnType<typeof vi.fn>;
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [endpoint, formData] = uploadMock.mock.calls[0];
    expect(endpoint).toBe('/v1/attachments');
    expect(formData).toBeInstanceOf(FormData);
    const file = formData.get('file') as File;
    expect(file.name).toBe('scan.png');
    t2v.destroy();
  });
});
