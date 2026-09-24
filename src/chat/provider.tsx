'use client';

/**
 * Everything the packaged chat needs, in one place: the Talk2View client, the
 * assistant-ui runtime built on it, the suggestion store, the portal host, and
 * the end-user's own choices from Settings.
 *
 * `<Talk2ViewChat>` and (from Task 6) `<Talk2ViewChatLauncher>` are both this
 * provider plus a different frame around the same shell.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AssistantRuntimeProvider, AuiProvider, Suggestions, useAui } from '@assistant-ui/react';
import { Talk2View } from '../index.js';
import type { ClientTool, ClientToolSchema, PartnerConfig, T2VConfig } from '../types.js';
import { useTalk2ViewRuntimeForClient } from '../assistant-ui/index.js';
import { useUserPreferences } from '../react/useUserPreferences.js';
import { assertOneAssistantUi } from './lib/guard.js';
import { useGuestLimits, type GuestLimits } from './auth-gate.js';
import { PortalHostContext, useCreatePortalHost } from './lib/portal-host.js';
import { createDictationPhaseStore, type DictationPhaseStore } from './lib/dictation-phase.js';
import { useConversations } from './lib/use-conversations.js';
import { useSkills, type SkillsStore } from './lib/use-skills.js';

/** The opening screen: a heading and the openers offered under the composer. */
export interface Talk2ViewChatWelcome {
  heading?: string;
  suggestions?: string[];
}

/**
 * Built-in views, all on by default. `dictation` also needs a browser
 * microphone: without one the voice button never appears.
 */
export interface Talk2ViewChatFeatures {
  dictation?: boolean;
  attachments?: boolean;
  settings?: boolean;
  account?: boolean;
  threadList?: boolean;
  /** The end-user's own markdown skills, written in the chat (default true). */
  skills?: boolean;
  /**
   * The realtime voice button beside the launcher (default true). Shown only
   * when the partner has voice enabled (`/v1/config` → `voice_agent_enabled`).
   */
  voice?: boolean;
}

export interface Talk2ViewChatProps extends Omit<T2VConfig, 'partnerKey'> {
  /** Either give the config (a client is created for you) … */
  partnerKey?: string;
  /** … or an existing client (e.g. shared with the rest of the app). */
  client?: Talk2View;
  tools?: (ClientToolSchema | ClientTool)[];
  /**
   * Your own instructions, sent with every message — the same prop `/ui` and
   * `/assistant-ui` take. It is a runtime option, not part of `T2VConfig`, so
   * changing it does not rebuild the client or drop the conversation.
   */
  systemPrompt?: string;
  welcome?: Talk2ViewChatWelcome;
  /**
   * Logged-out visitors chat as guests (default true). false → sign-in first:
   * the Account view replaces the thread, and no guest session is started.
   */
  allowAnonymous?: boolean;
  features?: Talk2ViewChatFeatures;
  /** The host's own font stack, e.g. '"Space Grotesk", sans-serif'. Default: inherit. */
  fontFamily?: string;
  /** Where "Forgot it?" sends people. Default: none (the link is left out). */
  resetPasswordUrl?: string;
  /** A short line under the composer, e.g. terms. */
  footer?: ReactNode;
  /**
   * Tool approvals. `describeToolActivity` names what a running tool is doing
   * ("Inserting 240 characters"); `isToolDestructive` marks a call that changes
   * the end-user's work, and `destructiveWarning` replaces the warning shown
   * above the approval buttons when it does.
   */
  describeToolActivity?: (name: string, args?: Record<string, unknown>) => string | null;
  isToolDestructive?: (name: string, args?: Record<string, unknown>) => boolean;
  destructiveWarning?: (name: string, activity: string | null) => ReactNode;
  className?: string;
}

/**
 * The props a slot component cannot be handed directly (assistant-ui's
 * `components={{ ToolFallback }}` takes a component, not a closure), read
 * through a ref so adding one does not re-render the whole chat.
 */
export interface Talk2ViewChatBehaviour {
  allowAnonymous: boolean;
  resetPasswordUrl?: string | undefined;
  describeToolActivity?: Talk2ViewChatProps['describeToolActivity'];
  isToolDestructive?: Talk2ViewChatProps['isToolDestructive'];
  destructiveWarning?: Talk2ViewChatProps['destructiveWarning'];
}

export interface Talk2ViewChatContextValue {
  client: Talk2View;
  /** The partner's defaults, shown as "Default — …" in Settings. Null until loaded. */
  config: PartnerConfig | null;
  features: Required<Talk2ViewChatFeatures>;
  welcome: Talk2ViewChatWelcome;
  /** Where portaled popups render. Null only while rendering on a server. */
  portalHost: HTMLElement | null;
  /**
   * Whether a guest has been turned away. Tracked here rather than in the view
   * that shows the sign-in, because the launcher's panel is unmounted when the
   * refusal arrives.
   */
  limits: GuestLimits;
  /** The end-user's own skills, and what is sent with their chats. */
  skills: SkillsStore;
  dictation: DictationPhaseStore;
  /**
   * Whether the integrator asked for dark mode, i.e. `className` carries
   * `dark`. Read by anything that renders OUTSIDE the chat's own element — see
   * the portal-host effect below.
   */
  dark: boolean;
  /** Always the latest render's values; stable identity. */
  behaviour: { readonly current: Talk2ViewChatBehaviour };
}

/** `dark` as a whole word, so `darkroom-theme` is not dark mode. */
export function hasDarkClass(className: string | undefined): boolean {
  return !!className && /(^|\s)dark(\s|$)/.test(className);
}

const ChatContext = createContext<Talk2ViewChatContextValue | null>(null);

export function useChatContext(): Talk2ViewChatContextValue {
  const value = useContext(ChatContext);
  if (!value) {
    throw new Error('This component must be rendered inside <Talk2ViewChat>.');
  }
  return value;
}

/** The chat context when rendered inside a chat, or null when standalone. */
export function useOptionalChatContext(): Talk2ViewChatContextValue | null {
  return useContext(ChatContext);
}

/** The client behind the chat, for the host's own UI (sign-out buttons and the like). */
export function useTalk2ViewChatClient(): Talk2View {
  return useChatContext().client;
}

const FEATURE_DEFAULTS: Required<Talk2ViewChatFeatures> = {
  dictation: true,
  attachments: true,
  settings: true,
  account: true,
  threadList: true,
  skills: true,
  voice: true,
};

const NO_WELCOME: Talk2ViewChatWelcome = {};

export interface ChatProviderProps extends Talk2ViewChatProps {
  children: ReactNode;
}

export function ChatProvider({ children, ...props }: ChatProviderProps): ReactNode {
  assertOneAssistantUi();

  const {
    client: givenClient,
    partnerKey,
    tools,
    systemPrompt,
    welcome = NO_WELCOME,
    features: givenFeatures,
    allowAnonymous = true,
    resetPasswordUrl,
    describeToolActivity,
    isToolDestructive,
    destructiveWarning,
    // Not connection options: `fontFamily`, `footer` and `className` belong to
    // the frame, and the rest of `props` is T2VConfig.
    fontFamily: _fontFamily,
    footer: _footer,
    className,
    ...config
  } = props;

  if (!givenClient && !partnerKey) {
    throw new Error('<Talk2ViewChat> needs either a partnerKey or a client.');
  }

  // `allowAnonymous: false` has to reach the client, not just the view: the gate
  // is computed from whether anyone is signed in, and a guest session started
  // behind it — by listing the models for Settings, say — would open it. An
  // explicit `anonymousAutoStart` still wins; this only fills in the default.
  const anonymousAutoStart = config.anonymousAutoStart ?? allowAnonymous;

  // A new client only when the connection details change. `model` is not one of
  // them: it travels with each message, so an end-user can switch models in
  // Settings without losing the conversation.
  //
  // React invokes this factory TWICE per mount under StrictMode and keeps only
  // one of the two clients, so it must leave nothing behind: `new Talk2View()`
  // registers two `window` listeners for auth, and the instance React discards
  // is unreachable from the effect below and could never take them off again.
  // So every client built here starts asleep and the effect wakes the survivor.
  // Nothing outside the instance can tell the difference — auth events only
  // matter to a mounted chat, and the gap is one commit long.
  const client = useMemo(() => {
    if (givenClient) return givenClient;
    const made = new Talk2View({ ...config, anonymousAutoStart, partnerKey: partnerKey! });
    made.auth.destroy();
    return made;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [givenClient, partnerKey, config.baseUrl, config.debug, anonymousAutoStart]);
  const ours = client !== givenClient;

  const features = useMemo<Required<Talk2ViewChatFeatures>>(
    () => ({ ...FEATURE_DEFAULTS, ...givenFeatures }),
    [givenFeatures],
  );

  const [partnerConfig, setPartnerConfig] = useState<PartnerConfig | null>(null);
  useEffect(() => {
    let live = true;
    // Single-flighted and cached by the client, so Settings asking again is free.
    // A brand-new visitor has no session yet and this 401s; Settings retries
    // once the model list has started a guest session.
    const load = () =>
      client
        .getConfig()
        .then((value) => live && value && setPartnerConfig(value))
        .catch(() => {});
    load();
    // The config is auth-scoped, and the client drops its cache on every auth
    // change (its own listener runs first, registered at construction). Asking
    // again here is what brings in the config a guest's first 401 missed — and
    // with it anything gated on it, like the voice button beside the launcher.
    const off = client.auth.onAuthStateChange(() => void load());
    return () => {
      live = false;
      off?.();
    };
  }, [client]);

  const dictation = useMemo(() => createDictationPhaseStore(), []);
  const { preferences } = useUserPreferences();

  // Before the runtime, and it has to stay there: this may put the conversation
  // this device left off on back into the client, and the runtime reads the
  // client's messages as its own initial state on the same render.
  const threadList = useConversations(client, { enabled: features.threadList });
  const skills = useSkills(client, { enabled: features.skills });

  const runtime = useTalk2ViewRuntimeForClient(client, {
    systemPrompt,
    tools,
    // The end-user's choice from Settings; empty means the partner's default.
    model: preferences.model || undefined,
    attachments: features.attachments,
    threadList,
    dictation: features.dictation && {
      model: preferences.sttModel || undefined,
      language: preferences.sttLanguage || undefined,
      // assistant-ui has no surface for a dictation failure; at least leave a trace.
      onError: (error) => console.warn('[Talk2View] Dictation failed:', error),
      onPhaseChange: dictation.set,
    },
  });

  // After the runtime hook, so its subscriptions are torn down before the
  // client we own is destroyed. A client the integrator passed in is theirs.
  //
  // Setup wakes it and cleanup puts it back to sleep, both ways round and any
  // number of times: StrictMode runs this as setup → cleanup → setup, and a
  // cleanup that only tore listeners off would leave the surviving client deaf
  // to cross-tab sign-out and to `clearAuth()` for the rest of the session.
  useEffect(() => {
    if (!ours) return;
    client.auth.listen();
    return () => client.destroy();
  }, [client, ours]);

  const portalHost = useCreatePortalHost();
  const limits = useGuestLimits(client);

  // Dark mode is `dark` on the chat's container, and every token it redefines
  // is declared on `.t2v-chat.dark`. But tooltips, dialogs and the launcher's
  // own panel do not render inside that element — they render in the portal
  // host, a sibling of the chat in <body> — so a dark chat was opening a white
  // panel and showing light-themed tooltips. The class has to travel with them.
  //
  // One portal host serves every chat on the page: two chats with different
  // themes would share whichever was set last. Nobody does that today, and the
  // alternative is a host per chat.
  const dark = hasDarkClass(className);
  useEffect(() => {
    if (!portalHost) return;
    portalHost.classList.toggle('dark', dark);
    return () => portalHost.classList.remove('dark');
  }, [portalHost, dark]);

  const behaviour = useRef<Talk2ViewChatBehaviour>({ allowAnonymous });
  behaviour.current = {
    allowAnonymous,
    resetPasswordUrl,
    describeToolActivity,
    isToolDestructive,
    destructiveWarning,
  };

  const value = useMemo<Talk2ViewChatContextValue>(
    () => ({
      client,
      config: partnerConfig,
      features,
      welcome,
      portalHost,
      limits,
      skills,
      dictation,
      dark,
      behaviour,
    }),
    [client, partnerConfig, features, welcome, portalHost, limits, skills, dictation, dark],
  );

  return (
    <ChatContext.Provider value={value}>
      <PortalHostContext.Provider value={portalHost}>
        <AssistantRuntimeProvider runtime={runtime}>
          <SuggestionStore suggestions={welcome.suggestions}>{children}</SuggestionStore>
        </AssistantRuntimeProvider>
      </PortalHostContext.Provider>
    </ChatContext.Provider>
  );
}

/**
 * The openers the thread shows under the composer on an empty chat. Inside the
 * runtime provider, so they attach to this chat's store and not another's.
 */
function SuggestionStore({
  suggestions,
  children,
}: {
  suggestions: string[] | undefined;
  children: ReactNode;
}): ReactNode {
  // Joined on a character that cannot occur in an opener, so two different
  // lists can never produce the same key. Written as the escape, not as a
  // literal NUL byte: one of those makes the whole file binary to grep, git and
  // half the editors that open it.
  const key = suggestions?.join('\0') ?? '';
  const aui = useAui(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useMemo(() => (suggestions?.length ? { suggestions: Suggestions(suggestions) } : {}), [key]),
  );
  return <AuiProvider value={aui}>{children}</AuiProvider>;
}
