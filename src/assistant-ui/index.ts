/**
 * assistant-ui runtime for Talk2View.
 *
 * Talk2View plugs into assistant-ui the way its other backends do — at the
 * runtime seam, not by shipping a fork of its components. Hand the runtime to
 * `<AssistantRuntimeProvider>` and render the stock `<Thread />` (or the
 * primitives): messages stream, client tools run in your app, and tool
 * approvals appear as assistant-ui's own approval card.
 *
 * @example
 * ```tsx
 * import { AssistantRuntimeProvider } from '@assistant-ui/react';
 * import { useTalk2ViewRuntime } from '@talk2view/sdk/assistant-ui';
 *
 * function Chat() {
 *   const runtime = useTalk2ViewRuntime({ partnerKey: 'pk_live_...', tools });
 *   return (
 *     <AssistantRuntimeProvider runtime={runtime}>
 *       <Thread />
 *     </AssistantRuntimeProvider>
 *   );
 * }
 * ```
 *
 * `@assistant-ui/react` is an optional peer dependency: it is only loaded by
 * this entry point, never by `@talk2view/sdk`, `/react` or `/ui`.
 *
 * @packageDocumentation
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useExternalStoreRuntime } from '@assistant-ui/react';
import type {
  AppendMessage,
  AssistantRuntime,
  AttachmentAdapter,
  CompleteAttachment,
  ExternalStoreAdapter,
  PendingAttachment,
} from '@assistant-ui/react';
import { Talk2View } from '../index.js';
import { ATTACHMENT_ACCEPT } from '../constants.js';
import type {
  Attachment,
  ClientTool,
  ClientToolSchema,
  DisplayMessage,
  PendingApproval,
  T2VConfig,
} from '../types.js';
import { toHumanDecision, toThreadMessage } from './convert.js';
import { createTalk2ViewDictationAdapter, type Talk2ViewDictationOptions } from './dictation.js';
export type { Talk2ViewDictationClient, Talk2ViewDictationPhase } from './dictation.js';

export { toThreadMessage, toHumanDecision, APPROVAL_OPTION_IDS } from './convert.js';
export type { ConvertContext } from './convert.js';
export { createTalk2ViewDictationAdapter, DEFAULT_DICTATION_MODEL } from './dictation.js';
export type { Talk2ViewDictationOptions } from './dictation.js';

/** Options shared by both forms of the hook. */
export interface Talk2ViewRuntimeOptions {
  /** Sent with every message. */
  systemPrompt?: string;
  /**
   * Client tools the agent may call; handlers run in your app. Registered
   * with the engine whenever the set of schemas changes (compared by value,
   * so an inline array is fine).
   */
  tools?: (ClientToolSchema | ClientTool)[];
  /**
   * Model for the next message — for example the end-user's choice from a
   * settings screen. Unlike the client's `model`, changing it keeps the chat.
   */
  model?: string;
  /**
   * Turn on assistant-ui's mic button, transcribed by Talk2View. `true` uses
   * the default speech-to-text model; pass `{ model, language }` to choose.
   */
  dictation?: boolean | Talk2ViewDictationOptions;
  /**
   * Let the end-user attach files (default true). `false` removes the adapter,
   * which is what turns the composer's attach button and its drop zone off —
   * hiding the button alone would still leave a drop target.
   */
  attachments?: boolean;
}

export interface UseTalk2ViewRuntimeOptions extends T2VConfig, Talk2ViewRuntimeOptions {}

/** What Stop means while a tool call is waiting on the end-user. */
const CANCELLED_APPROVAL_FEEDBACK = 'Cancelled by the user';

/** Create a Talk2View client and expose it as an assistant-ui runtime. */
export function useTalk2ViewRuntime(options: UseTalk2ViewRuntimeOptions): AssistantRuntime {
  const { systemPrompt, tools, model: messageModel, dictation, ...config } = options;
  // A new client only when the connection details change. `model` is not one
  // of them here: it travels with each message, so an end-user can switch
  // models from a settings screen without losing the chat.
  // Built asleep: React invokes this factory twice per mount under StrictMode
  // and keeps one client, and the one it discards is unreachable from the effect
  // below — it could never take its window listeners off again. The effect wakes
  // the survivor.
  const t2v = useMemo(
    () => {
      const made = new Talk2View(config);
      made.auth.destroy();
      return made;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.partnerKey, config.baseUrl, config.debug, config.anonymousAutoStart],
  );
  const runtime = useTalk2ViewRuntimeForClient(t2v, { systemPrompt, tools, model: messageModel, dictation });
  // Declared after the subscriptions above so, on a client swap or unmount,
  // React runs their cleanup first and destroys the client last. Setup and
  // cleanup are exact inverses because StrictMode runs this as setup → cleanup →
  // setup: without the `listen()`, the surviving client spends the rest of the
  // session deaf to cross-tab sign-out and to `clearAuth()`.
  useEffect(() => {
    t2v.auth.listen();
    return () => t2v.destroy();
  }, [t2v]);
  return runtime;
}

/** Expose an existing client (for example the one from `useT2V()`) as an assistant-ui runtime. */
export function useTalk2ViewRuntimeForClient(
  t2v: Talk2View,
  { systemPrompt, tools, model, dictation, attachments: attachmentsEnabled = true }: Talk2ViewRuntimeOptions = {},
): AssistantRuntime {
  const [messages, setMessages] = useState<DisplayMessage[]>(t2v.messages);
  const [isLoading, setIsLoading] = useState(t2v.isLoading);
  const [error, setError] = useState<string | null>(t2v.error);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(t2v.pendingApproval);

  useEffect(() => {
    setMessages(t2v.messages);
    setIsLoading(t2v.isLoading);
    setError(t2v.error);
    setPendingApproval(t2v.pendingApproval);
    const unsubs = [
      t2v.on('messagesChange', setMessages),
      t2v.on('loadingChange', setIsLoading),
      t2v.on('errorChange', setError),
      t2v.on('approvalChange', setPendingApproval),
    ];
    return () => unsubs.forEach((u) => u());
  }, [t2v]);

  // Register tools the way <Talk2View> does: schemas to the engine, handlers
  // locally. Keyed by value so a partner's inline `tools` array does not
  // re-register on every render (this hook re-renders on every stream chunk).
  const schemas = useMemo(
    () =>
      (tools ?? []).map((tool) => {
        const { execute: _execute, ...schema } = tool as ClientTool;
        return schema as ClientToolSchema;
      }),
    [tools],
  );
  const schemaKey = useMemo(() => JSON.stringify(schemas), [schemas]);
  const registered = useRef<{ t2v: Talk2View; key: string } | null>(null);
  useEffect(() => {
    if (schemas.length === 0) return;
    for (const tool of tools ?? []) {
      if ('execute' in tool && tool.execute) t2v.tools.handle(tool.name, tool.execute);
    }
    if (registered.current?.t2v === t2v && registered.current.key === schemaKey) return;
    registered.current = { t2v, key: schemaKey };
    t2v.tools.register(schemas).catch(() => {});
  }, [t2v, tools, schemas, schemaKey]);

  // Uploaded files, by the id assistant-ui hands back in the composed message.
  const uploaded = useRef(new Map<string, Attachment>());

  const attachments = useMemo<AttachmentAdapter>(
    () => ({
      accept: ATTACHMENT_ACCEPT,
      async add({ file }): Promise<PendingAttachment> {
        return {
          id: pendingId(),
          type: file.type.startsWith('image/') ? 'image' : 'document',
          name: file.name,
          contentType: file.type,
          file,
          status: { type: 'requires-action', reason: 'composer-send' },
        };
      },
      async send(pending): Promise<CompleteAttachment> {
        const stored = await t2v.uploadAttachment(pending.file, pending.file.name);
        uploaded.current.set(stored.id, stored);
        return {
          id: stored.id,
          type: pending.type,
          name: stored.filename,
          contentType: stored.mime_type,
          status: { type: 'complete' },
          // The engine resolves the bytes by id; nothing is inlined.
          content: [],
        };
      },
      async remove() {
        // Uploads are cheap and expire server-side; nothing to undo client-side.
      },
    }),
    [t2v],
  );

  // One adapter per client; the options are read when a clip is sent, so a
  // settings change applies to the next dictation without a new runtime.
  const dictationOptions = useRef<Talk2ViewDictationOptions>({});
  dictationOptions.current = typeof dictation === 'object' ? dictation : {};
  const dictationEnabled = Boolean(dictation);
  const dictationAdapter = useMemo(
    () => (dictationEnabled ? createTalk2ViewDictationAdapter(t2v, () => dictationOptions.current) : null),
    [t2v, dictationEnabled],
  );

  // A turn that fails before its first text chunk leaves no assistant message
  // behind (the SDK drops the empty one), and assistant-ui can only show an
  // error on an assistant message — so give it one to show it on.
  const threadMessages = useMemo<DisplayMessage[]>(() => {
    const last = messages[messages.length - 1];
    if (error && last && last.role !== 'assistant') {
      return [...messages, { id: `${last.id}:error`, role: 'assistant', content: '', timestamp: new Date() }];
    }
    return messages;
  }, [messages, error]);

  const convertMessage = useCallback(
    (msg: DisplayMessage, idx: number) =>
      toThreadMessage(msg, { isLast: idx === threadMessages.length - 1, pendingApproval, error }),
    [threadMessages.length, pendingApproval, error],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      const files = (message.attachments ?? []).map((a): Attachment => {
        const stored = uploaded.current.get(a.id);
        uploaded.current.delete(a.id);
        // The id is the engine's whichever way we got here; rebuild the rest
        // if the upload happened before this hook instance existed.
        return stored ?? { id: a.id, filename: a.name, mime_type: a.contentType ?? '', size_bytes: a.file?.size ?? 0 };
      });
      await t2v.sendMessage(text, {
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(model ? { model } : {}),
        ...(files.length ? { attachments: files } : {}),
      });
    },
    [t2v, systemPrompt, model],
  );

  // assistant-ui puts a reload action on every assistant message; the SDK
  // can only regenerate the latest turn — the one started by the last user
  // message. That includes the error card and every segment of that turn;
  // reload of an older reply is a no-op rather than a silent rewrite of the
  // newest one.
  const onReload = useCallback(
    async (parentId: string | null) => {
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      if (!lastUser || parentId !== lastUser.id) return;
      await t2v.retryLastMessage();
    },
    [t2v, messages],
  );

  // Stop while a tool call waits on the end-user: the SDK is not streaming,
  // so stop() would do nothing — deny the call instead, which is what a
  // partner expects Stop to mean there.
  const onCancel = useCallback(async () => {
    if (t2v.pendingApproval) {
      await t2v.approveToolCall({ action: 'deny', feedback: CANCELLED_APPROVAL_FEEDBACK });
      return;
    }
    t2v.stop();
  }, [t2v]);

  const adapter = useMemo<ExternalStoreAdapter<DisplayMessage>>(
    () => ({
      messages: threadMessages,
      // A turn waiting on an approval is still in progress: the engine holds
      // the interrupt, and a second message would land on top of it.
      isRunning: isLoading || pendingApproval !== null,
      convertMessage,
      onNew,
      onCancel,
      onReload,
      onRespondToToolApproval: async (response) => {
        // Only the current gate can be answered; a stale card is ignored.
        if (response.approvalId !== t2v.pendingApproval?.toolCallId) return;
        await t2v.approveToolCall(toHumanDecision(response));
      },
      adapters: {
        ...(attachmentsEnabled ? { attachments } : {}),
        ...(dictationAdapter ? { dictation: dictationAdapter } : {}),
        // The header's "New Thread" control. The runtime reads this from
        // `adapters.threadList`, not from the root, and without it it throws
        // "External store adapter does not support switching to new thread",
        // catches it, logs it, and the button does nothing at all — which is
        // how it shipped. `clearMessages()` is what the first-party panel's
        // New chat always did: it drops the messages, the history and the
        // thread id, and ends the engine-side session.
        threadList: {
          onSwitchToNewThread: () => {
            t2v.clearMessages();
          },
        },
      },
    }),
    [threadMessages, isLoading, pendingApproval, convertMessage, onNew, onCancel, onReload, t2v, attachments, attachmentsEnabled, dictationAdapter],
  );

  const runtime = useExternalStoreRuntime(adapter);

  // First character typed = intent. Mint the end-user's key while they finish
  // the sentence. Not on mount and not on focus: the composer autofocuses when a
  // chat opens, and a visitor who opens it and leaves should cost nothing.
  // A ref, not a local: the effect re-runs under StrictMode and must not
  // re-arm. It remembers which client it warmed, so a new client gets its own.
  const warmedFor = useRef<unknown>(null);
  useEffect(() => {
    const composer = runtime.thread.composer;
    const check = () => {
      if (warmedFor.current === t2v || !composer.getState().text) return;
      warmedFor.current = t2v;
      void t2v.warmUp();
    };
    check();
    return composer.subscribe(check);
  }, [runtime, t2v]);

  return runtime;
}

let pendingCounter = 0;
function pendingId(): string {
  pendingCounter += 1;
  return `pending-${Date.now()}-${pendingCounter}`;
}
