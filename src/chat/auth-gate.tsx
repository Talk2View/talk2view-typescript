'use client';

/**
 * Who is using the chat, and whether they have to sign in before they can.
 *
 * The rule is the one the SDK's own `/ui` panel has shipped with: a logged-out
 * visitor is stopped when the integrator does not allow guests, or when the
 * engine refuses to start a guest session; a guest is stopped once their
 * allowance runs out. Everything else — a signed-in end-user, a guest with
 * allowance left — goes straight to the thread.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Talk2View } from '../index.js';
import type { User } from '../types.js';

/** Why the Account view opened by itself, if it did. */
export type AccountReason = 'guest-limit' | 'demo-limit' | 'misconfigured' | null;

export const REASON_COPY: Record<Exclude<AccountReason, null>, string> = {
  // Not the end-user's problem and not something signing in can fix: the key
  // this app was built with is wrong. Say so without blaming them.
  misconfigured: 'This app isn’t set up correctly, so chat is unavailable. Please contact support.',
  'guest-limit': 'Guest chat isn’t available right now. Sign in to keep going.',
  'demo-limit': 'You’ve reached the guest limit. Sign in or create a free account to keep going.',
};

export type AccountState = { status: 'none' | 'guest' | 'signed-in'; user: User | null };

const NONE: AccountState = { status: 'none', user: null };

function readAccount(client: Talk2View): AccountState {
  const user = client.auth.getUser();
  if (!user) return NONE;
  return { status: client.auth.isAnonymous() ? 'guest' : 'signed-in', user };
}

/** Who is using the chat. Re-renders on sign-in, sign-out and guest start. */
export function useAccount(client: Talk2View): AccountState {
  // getSnapshot must return a stable value between changes, so the state is
  // cached here and replaced only when the auth layer says something changed.
  const [store] = useState(() => {
    let current = NONE;
    return {
      subscribe: (notify: () => void) => {
        current = readAccount(client);
        notify();
        return client.auth.onAuthStateChange(() => {
          current = readAccount(client);
          notify();
        });
      },
      get: () => current,
    };
  });
  return useSyncExternalStore(store.subscribe, store.get, () => NONE);
}

/** Whether a guest has been turned away, and which way. */
export interface GuestLimits {
  /** This guest has used their allowance. */
  demoLimitReached: boolean;
  /** The engine will not start a guest session at all. */
  anonymousUnavailable: boolean;
  /** The engine rejected this app's partner key: nobody can chat here. */
  misconfigured: boolean;
}

const NO_LIMITS: GuestLimits = {
  demoLimitReached: false,
  anonymousUnavailable: false,
  misconfigured: false,
};

/**
 * Track the two ways a guest is turned away, for as long as the chat is on the
 * page.
 *
 * It belongs to the provider, not to the view that reacts to it: the launcher's
 * panel is unmounted until someone opens it, and the refusal usually arrives
 * while it still is — the chat starts its guest session as soon as it mounts.
 * State kept inside the panel would miss the event that is the reason to open
 * the panel at all, and the visitor would land on a thread they cannot use.
 */
export function useGuestLimits(client: Talk2View): GuestLimits {
  const account = useAccount(client);
  const [limits, setLimits] = useState<GuestLimits>(NO_LIMITS);

  useEffect(() => {
    const offs = [
      client.on('demoLimitReached', () =>
        setLimits((l) => (l.demoLimitReached ? l : { ...l, demoLimitReached: true })),
      ),
      client.on('anonymousUnavailable', (reason) =>
        setLimits((l) => {
          // A rejected partner key is not a guest limit. Signing in cannot fix
          // it, so the gate must not offer signing in as the way out.
          if (reason === 'partner_key_error') {
            return l.misconfigured ? l : { ...l, misconfigured: true };
          }
          return l.anonymousUnavailable ? l : { ...l, anonymousUnavailable: true };
        }),
      ),
    ];
    return () => offs.forEach((off) => off());
  }, [client]);

  // Signing in to a real account lifts the limit AND resumes what it interrupted:
  // the core has already dropped the orphaned guest session, so the resend lands
  // in a fresh one owned by the now-signed-in end-user.
  const signedIn = account.status === 'signed-in';
  // `misconfigured` is deliberately not here: signing in does not lift it, and
  // clearing it would retry a key the engine has already refused.
  const limited = limits.demoLimitReached || limits.anonymousUnavailable;
  useEffect(() => {
    if (!signedIn || !limited) return;
    setLimits(NO_LIMITS);
    void client.retryLastMessage();
  }, [client, signedIn, limited]);

  return limits;
}

export interface AuthGate {
  /** Sign-in replaces the thread: the visitor cannot chat until they are in. */
  gated: boolean;
  /** What opened it by itself, for the banner. Null when the visitor did. */
  reason: AccountReason;
  account: AccountState;
}

/**
 * The gate, computed exactly as `ChatPanel` in the SDK's `/ui` panel computes
 * it, so the two chats agree about who may speak to the agent.
 */
export function useAuthGate(
  client: Talk2View,
  allowAnonymous: boolean,
  limits: GuestLimits,
): AuthGate {
  const account = useAccount(client);
  const { demoLimitReached, anonymousUnavailable, misconfigured } = limits;

  // A guest counts as authenticated here, as they do in `/ui`: they have a
  // session and may chat. `allowAnonymous` is what decides whether they get one.
  const isAuthenticated = account.status !== 'none';
  return {
    gated:
      misconfigured ||
      (!isAuthenticated && (!allowAnonymous || anonymousUnavailable)) ||
      demoLimitReached,
    reason: misconfigured
      ? 'misconfigured'
      : demoLimitReached
        ? 'demo-limit'
        : anonymousUnavailable
          ? 'guest-limit'
          : null,
    account,
  };
}
