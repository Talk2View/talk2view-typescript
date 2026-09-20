'use client';

/**
 * The Account view: sign in, create an account, continue with Apple or Google,
 * sign out. It is the same engine auth the SDK's other surfaces use
 * (`client.auth`), so an account made in one Talk2View app works in all of them.
 *
 * A visitor starts as a guest. Creating an account from a guest session converts
 * it in place — same end-user, so the conversation so far is kept.
 *
 * Ported from the website's assistant modal. Two things are different here: the
 * client comes from the chat's own context rather than the site's, and the
 * "Forgot it?" link points at whatever page the integrator named, or is left out.
 */
import { useEffect, useId, useState, type FormEvent } from 'react';
import type { PopupProvider, Talk2View } from '../../index.js';
import type { User } from '../../types.js';
import { cn } from '../lib/cn.js';
import { useChatContext } from '../provider.js';
import { REASON_COPY, useAccount, type AccountReason } from '../auth-gate.js';

const inputClass =
  'border-input bg-background text-foreground placeholder:text-muted-foreground/70 focus-visible:ring-ring h-10 w-full border px-3 text-base outline-none focus-visible:ring-2 disabled:opacity-60';
const primaryClass =
  'bg-primary text-primary-foreground focus-visible:ring-foreground h-10 w-full text-sm font-medium transition-[filter] hover:brightness-95 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60';
/* Apple's own black button, as their Sign in with Apple guidelines require; the
   one place in the chat that does not follow the integrator's colour tokens. */
const appleClass =
  'focus-visible:ring-primary flex h-10 w-full items-center justify-center gap-2.5 bg-black text-sm font-medium text-white outline-none hover:bg-black/85 focus-visible:ring-2 disabled:opacity-60';
const secondaryClass =
  'border-input bg-background text-foreground hover:bg-foreground/[0.04] focus-visible:ring-ring flex h-10 w-full items-center justify-center gap-2.5 border text-sm font-medium outline-none focus-visible:ring-2 disabled:opacity-60';

export function AccountView({
  reason,
  onSignedIn,
}: {
  reason: AccountReason;
  onSignedIn: () => void;
}) {
  const { client, behaviour } = useChatContext();
  const account = useAccount(client);

  // A rejected partner key stops the app for everyone, so this is neither a
  // sign-in problem nor an account problem: no form, no account panel, just
  // what happened. Signing in does not lift it and there is nothing to retry.
  if (reason === 'misconfigured') {
    return (
      <div className="t2v-chat-account aui-modal-account bg-popover absolute inset-0 flex flex-col gap-5 overflow-y-auto p-4 text-sm">
        <p role="status" className="bg-muted text-foreground px-3 py-2.5 leading-relaxed">
          {REASON_COPY.misconfigured}
        </p>
      </div>
    );
  }

  return (
    <div className="t2v-chat-account aui-modal-account bg-popover absolute inset-0 flex flex-col gap-5 overflow-y-auto p-4 text-sm">
      {account.status === 'signed-in' ? (
        <SignedIn client={client} user={account.user!} />
      ) : (
        <SignInForm
          client={client}
          guest={account.status === 'guest'}
          reason={reason}
          resetPasswordUrl={behaviour.current.resetPasswordUrl}
          onSignedIn={onSignedIn}
        />
      )}
    </div>
  );
}

function SignedIn({ client, user }: { client: Talk2View; user: User }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-muted-foreground text-xs">Signed in as</p>
        <p className="truncate text-base font-medium">{user.email}</p>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">
        Your conversations are saved to this account, and it works in every Talk2View app.
      </p>
      <button
        type="button"
        className={secondaryClass}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void client.auth.logout().finally(() => setBusy(false));
        }}
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </>
  );
}

function SignInForm({
  client,
  guest,
  reason,
  resetPasswordUrl,
  onSignedIn,
}: {
  client: Talk2View;
  guest: boolean;
  reason: AccountReason;
  resetPasswordUrl: string | undefined;
  onSignedIn: () => void;
}) {
  // Someone who ran out of guest allowance needs an account, not a password.
  const [mode, setMode] = useState<'login' | 'signup'>(
    reason === 'demo-limit' ? 'signup' : 'login',
  );

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'form' | 'google' | 'apple' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmSentTo, setConfirmSentTo] = useState<string | null>(null);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  // Which popup sign-ins work on THIS page — the engine decides (it has to be an
  // https:// website that sends a Referer; never localhost). Null while asking: a
  // form that grows a button is better than one that shows a button and takes
  // it away.
  const [providers, setProviders] = useState<PopupProvider[] | null>(null);
  useEffect(() => {
    let live = true;
    void client.auth.getPopupProviders().then((list) => live && setProviders(list));
    return () => {
      live = false;
    };
  }, [client]);
  const apple = providers?.includes('apple') ?? false;
  const google = providers?.includes('google') ?? false;

  const fail = (err: unknown, fallback: string) =>
    setError(err instanceof Error && err.message ? err.message : fallback);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy('form');
    try {
      if (mode === 'signup') {
        const outcome = await client.auth.signup(email.trim(), password);
        if (outcome.confirmationRequired) setConfirmSentTo(email.trim());
        else onSignedIn();
      } else {
        await client.auth.login(email.trim(), password);
        onSignedIn();
      }
    } catch (err) {
      fail(err, mode === 'signup' ? 'Couldn’t create the account.' : 'Couldn’t sign in.');
    } finally {
      setBusy(null);
    }
  };

  const popup = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setError(null);
    setBusy(provider);
    try {
      await (provider === 'apple' ? client.auth.signInWithApple() : client.auth.signInWithGoogle());
      onSignedIn();
    } catch (err) {
      fail(
        err,
        provider === 'apple' ? 'Apple sign-in didn’t finish.' : 'Google sign-in didn’t finish.',
      );
    } finally {
      setBusy(null);
    }
  };

  if (confirmSentTo) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Check your email</h2>
        <p className="text-muted-foreground leading-relaxed">
          We sent a confirmation link to <span className="text-foreground">{confirmSentTo}</span>.
          You can keep chatting in the meantime — this conversation moves to your account once you
          confirm.
        </p>
        <button type="button" className={secondaryClass} onClick={onSignedIn}>
          Back to the chat
        </button>
      </div>
    );
  }

  const signup = mode === 'signup';
  return (
    <>
      {reason ? (
        <p role="status" className="bg-muted text-foreground px-3 py-2.5 leading-relaxed">
          {REASON_COPY[reason]}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">{signup ? 'Create your account' : 'Sign in'}</h2>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {!guest
            ? 'One account for every Talk2View app.'
            : signup
              ? 'You’re chatting as a guest. Creating an account keeps this conversation and lifts the guest limits.'
              : 'You’re chatting as a guest. Signing in starts a fresh chat under your account.'}
        </p>
      </div>

      {apple || google ? (
        <>
          <div className="flex flex-col gap-2.5">
            {/* Apple first, in its mandatory black style: their guidelines ask
                that it be no less prominent than any other sign-in option. It is
                also the only way in for an account made with Apple in T2Board,
                which has no password. */}
            {apple ? (
              <button
                type="button"
                className={appleClass}
                disabled={busy !== null}
                onClick={() => popup('apple')}
              >
                <AppleMark />
                {busy === 'apple' ? 'Waiting for Apple…' : 'Continue with Apple'}
              </button>
            ) : null}
            {google ? (
              <button
                type="button"
                className={secondaryClass}
                disabled={busy !== null}
                onClick={() => popup('google')}
              >
                <GoogleMark />
                {busy === 'google' ? 'Waiting for Google…' : 'Continue with Google'}
              </button>
            ) : null}
          </div>

          <div className="text-muted-foreground flex items-center gap-3 text-xs" aria-hidden="true">
            <span className="bg-foreground/10 h-px flex-1" />
            or
            <span className="bg-foreground/10 h-px flex-1" />
          </div>
        </>
      ) : null}

      <form className="flex flex-col gap-3" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={emailId} className="font-medium">
            Email
          </label>
          <input
            id={emailId}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            className={inputClass}
            value={email}
            disabled={busy !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor={passwordId} className="font-medium">
              Password
            </label>
            {/* The chat may be a panel inside someone else's app, so the reset
                page opens beside it rather than navigating the host away. */}
            {!signup && resetPasswordUrl ? (
              <a
                href={resetPasswordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground text-xs underline"
              >
                Forgot it?
              </a>
            ) : null}
          </div>
          <input
            id={passwordId}
            type="password"
            required
            minLength={signup ? 8 : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            className={inputClass}
            value={password}
            disabled={busy !== null}
            aria-describedby={error ? errorId : undefined}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup ? <p className="text-muted-foreground text-xs">At least 8 characters.</p> : null}
        </div>

        {error ? (
          <p id={errorId} role="alert" className="text-destructive">
            {error}
          </p>
        ) : null}

        <button type="submit" className={primaryClass} disabled={busy !== null}>
          {busy === 'form'
            ? signup
              ? 'Creating account…'
              : 'Signing in…'
            : signup
              ? 'Create account'
              : 'Sign in'}
        </button>
      </form>

      <p className="text-muted-foreground text-xs">
        {signup ? 'Already have an account? ' : 'New to Talk2View? '}
        <button
          type="button"
          className={cn('text-foreground underline', busy && 'pointer-events-none opacity-60')}
          onClick={() => {
            setError(null);
            setMode(signup ? 'login' : 'signup');
          }}
        >
          {signup ? 'Sign in' : 'Create an account'}
        </button>
      </p>
    </>
  );
}

/** Apple's logo, white on black, per their Sign in with Apple guidelines. */
const AppleMark = () => (
  <svg
    viewBox="0 0 14 17"
    aria-hidden="true"
    fill="currentColor"
    className="h-[17px] w-[14px] shrink-0"
  >
    <path d="M11.62 9.03c-.02-1.9 1.55-2.81 1.62-2.86-.88-1.29-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.88.69-.59 0-1.51-.67-2.48-.65-1.28.02-2.45.74-3.11 1.88-1.33 2.3-.34 5.7.95 7.57.63.91 1.38 1.94 2.37 1.9.95-.04 1.31-.61 2.46-.61 1.15 0 1.47.61 2.48.59 1.02-.02 1.67-.93 2.3-1.85.72-1.06 1.02-2.08 1.04-2.13-.02-.01-1.99-.76-2.01-3.04zM9.73 3.43c.52-.64.88-1.52.78-2.4-.76.03-1.67.5-2.21 1.14-.49.56-.91 1.46-.8 2.32.84.07 1.71-.43 2.23-1.06z" />
  </svg>
);

/** Google's "G", per their sign-in branding guidelines (standard colours). */
const GoogleMark = () => (
  <svg viewBox="0 0 18 18" aria-hidden="true" className="size-[18px] shrink-0">
    <path
      fill="#4285F4"
      d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
    />
    <path
      fill="#34A853"
      d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
    />
    <path
      fill="#FBBC05"
      d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z"
    />
    <path
      fill="#EA4335"
      d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
    />
  </svg>
);
