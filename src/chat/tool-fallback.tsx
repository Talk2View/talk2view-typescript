'use client';

/**
 * How every tool call looks in the packaged chat — one component, no tool names
 * hard-coded, passed to the thread as `components={{ ToolFallback }}`.
 *
 * Three states:
 *  - running — an activity row: what the host says the agent is doing
 *    (`describeToolActivity`) and how long it has been at it;
 *  - waiting on the end-user — the approval card: allow once, always allow, or
 *    deny with a reason, with the arguments editable first, and a warning above
 *    the buttons for a tool the host marks as changing the end-user's work;
 *  - finished — the collapsed "Used tool" line, opening to the arguments and the
 *    result.
 *
 * Two things worth knowing before restyling the card:
 *  - Edited arguments apply to THIS call only. "Always allow" skips the card for
 *    later calls, which then run with whatever the agent proposes — so the card
 *    does not offer it while the arguments are edited.
 *  - Decisions go straight to the Talk2View client (`approveToolCall`), not
 *    through assistant-ui's approval seam, because that seam carries a decision
 *    and a reason but not changed input.
 */
import { useEffect, useId, useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { LoaderIcon, ShieldAlertIcon } from 'lucide-react';
import {
  useToolCallElapsed,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartProps,
} from '@assistant-ui/react';
import {
  ToolFallback as VendoredToolFallback,
  ToolFallbackArgs,
  ToolFallbackContent,
  ToolFallbackError,
  ToolFallbackResult,
  ToolFallbackRoot,
  ToolFallbackTrigger,
} from './vendor/tool-fallback.aui.js';
import { ToolGroupContent, ToolGroupRoot, ToolGroupTrigger } from './vendor/tool-group.aui.js';
import type { ThreadGroupPart } from './vendor/thread.aui.js';
import { CollapsibleTrigger } from './ui/collapsible.js';
import { Button } from './ui/button.js';
import { Textarea } from './ui/textarea.js';
import { cn } from './lib/cn.js';
import { useChatContext } from './provider.js';

/** True while this tool call is the one the end-user has to decide on. */
const awaitingDecision = (p: ToolCallMessagePartProps) =>
  p.approval != null && p.approval.approved === undefined && p.approval.resolution === undefined;

/** The arguments as a human reads them. `argsText` arrives as one long line. */
const prettyArgs = (args: unknown, argsText: string | undefined): string | undefined => {
  if (args && typeof args === 'object' && Object.keys(args).length > 0) {
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      /* circular or otherwise unserialisable — fall through to the raw text */
    }
  }
  return argsText;
};

export const ToolFallback: ToolCallMessagePartComponent = (props) => {
  if (awaitingDecision(props)) return <ApprovalCard {...props} />;
  // Some other kind of pause — assistant-ui's own approval seam, a resumable
  // interrupt. Upstream knows what to draw for those; we do not second-guess it.
  if (props.status?.type === 'requires-action') return <VendoredToolFallback {...props} />;
  const finished =
    props.result !== undefined ||
    props.status?.type === 'complete' ||
    props.status?.type === 'incomplete';
  return finished ? <FinishedCall {...props} /> : <RunningCall {...props} />;
};

/**
 * The run of tool calls in one assistant turn, as a single "2 tool calls" line.
 *
 * Upstream's group starts closed and stays closed, which is right for a finished
 * turn and wrong for a live one: an approval card inside a closed group leaves
 * the end-user looking at "1 tool call" while the agent waits on them, with
 * nothing to say a decision is needed. This opens the group while the run is
 * under way and leaves whatever the end-user last chose standing once it settles.
 */
export function ToolGroup({
  group,
  children,
}: {
  group: ThreadGroupPart;
  children?: ReactNode;
}): ReactNode {
  const running = group.status.type === 'running';
  const live = running || group.status.type === 'requires-action';
  const [open, setOpen] = useState(live);
  const [wasLive, setWasLive] = useState(live);
  if (live !== wasLive) {
    setWasLive(live);
    if (live) setOpen(true);
  }

  return (
    <ToolGroupRoot variant="ghost" open={open} onOpenChange={setOpen}>
      <ToolGroupTrigger count={group.indices.length} active={running} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}

/**
 * Seconds this call has been running. assistant-ui keeps the real clock on the
 * part, but it has none for a part outside a message scope (and none at all
 * until the runtime records the start), so a local tick stands in — the row must
 * still count.
 */
function useElapsedSeconds(): number {
  const fromPart = useToolCallElapsed();
  const [ticked, setTicked] = useState(0);
  const tracked = fromPart !== undefined;
  useEffect(() => {
    if (tracked) return;
    const id = setInterval(() => setTicked((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [tracked]);
  return fromPart !== undefined ? Math.floor(fromPart / 1000) : ticked;
}

function RunningCall({ toolName, args, argsText }: ToolCallMessagePartProps) {
  const { behaviour } = useChatContext();
  const [open, setOpen] = useState(false);
  const seconds = useElapsedSeconds();
  const activity = behaviour.current.describeToolActivity?.(toolName, args) ?? null;

  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen} className="t2v-tool-activity">
      <CollapsibleTrigger className="aui-tool-fallback-trigger text-muted-foreground hover:text-foreground flex w-fit origin-left items-center gap-2 py-1.5 text-sm transition-[color,scale] active:scale-[0.98]">
        <LoaderIcon
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin [animation-duration:0.6s] motion-reduce:animate-none"
        />
        <span className="shimmer motion-reduce:animate-none inline-block text-start leading-none">
          {activity ?? 'Working…'}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">{seconds}s</span>
      </CollapsibleTrigger>
      <ToolFallbackContent>
        <ToolFallbackArgs argsText={prettyArgs(args, argsText)} />
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
}

function FinishedCall({ toolName, args, argsText, result, status }: ToolCallMessagePartProps) {
  const [open, setOpen] = useState(false);
  const cancelled = status?.type === 'incomplete' && status.reason === 'cancelled';

  return (
    <ToolFallbackRoot open={open} onOpenChange={setOpen}>
      <ToolFallbackTrigger toolName={toolName} status={status} />
      <ToolFallbackContent>
        <ToolFallbackError status={status} />
        <ToolFallbackArgs
          argsText={prettyArgs(args, argsText)}
          className={cn(cancelled && 'opacity-60')}
        />
        {!cancelled && <ToolFallbackResult result={result} />}
      </ToolFallbackContent>
    </ToolFallbackRoot>
  );
}

function ApprovalCard({ toolName, args, argsText, approval }: ToolCallMessagePartProps) {
  const { client, behaviour } = useChatContext();
  const original = useMemo(() => prettyArgs(args, argsText) ?? '{}', [args, argsText]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(original);
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const argsId = useId();
  const reasonId = useId();

  // Only arguments that parse as a JSON object can be sent back changed.
  const parsedDraft = (): Record<string, unknown> | null => {
    try {
      const value: unknown = JSON.parse(draft);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const draftChanged = editing && draft !== original;
  const draftValid = !draftChanged || parsedDraft() !== null;

  const { describeToolActivity, isToolDestructive, destructiveWarning } = behaviour.current;
  const activity = describeToolActivity?.(toolName, args) ?? null;
  const destructive = isToolDestructive?.(toolName, args) ?? false;

  const decide = (action: 'once' | 'always' | 'deny') => {
    // Answer only the gate the client is actually holding: a card left over from
    // a decision that has already moved on must not answer the next one.
    if (busy || client.pendingApproval?.toolCallId !== approval?.id) return;
    setBusy(true);
    const updatedInput =
      action === 'once' && draftChanged ? (parsedDraft() ?? undefined) : undefined;
    // The client clears the gate synchronously, which unmounts this card; a
    // failure surfaces on the thread's own error card.
    void client.approveToolCall({
      action,
      // The SDK forwards a reason to the assistant only when the call is denied.
      ...(action === 'deny' && reason.trim() ? { feedback: reason.trim() } : {}),
      ...(updatedInput ? { updatedInput } : {}),
    });
  };

  return (
    // Not a collapsible: this is a decision to make, not a detail to expand, and
    // upstream's disclosure row would announce it as "Used tool" before the
    // end-user has allowed anything.
    <div className="t2v-tool-approval border-primary/60 bg-muted/40 my-1.5 flex w-full flex-col gap-3 border p-3 text-sm">
      <div className="flex items-start gap-2">
        <ShieldAlertIcon className="text-primary mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium">The assistant wants to run {toolName}</p>
          {/* `approval.prompt` is the AGENT's description of the call, and the
              agent has read whatever this conversation put in front of it — a
              web-search result, an attachment, another tool's output. This is
              the one screen where a person grants permission to change their
              work, so the line is attributed and quoted rather than sitting in
              the chat's own voice directly above the buttons. Escaped by React;
              the real defence is the tool name and arguments shown below. */}
          {approval?.prompt ? (
            <p className="text-muted-foreground text-xs">
              <span className="font-medium">The assistant says:</span>{' '}
              <q className="t2v-tool-approval-prompt italic">{approval.prompt}</q>
            </p>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={argsId} className="text-muted-foreground text-xs">
            Arguments (JSON)
          </label>
          <Textarea
            id={argsId}
            value={draft}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value)}
            spellCheck={false}
            className={cn('font-mono text-xs', !draftValid && 'border-destructive')}
            rows={Math.min(12, draft.split('\n').length + 1)}
          />
          {!draftValid ? (
            <span className="text-destructive text-xs">Not valid JSON — fix it or deny.</span>
          ) : null}
          {draftChanged && draftValid ? (
            <span className="text-muted-foreground text-xs">
              Your changes apply to this call only, so “Always allow” is off while they’re in place.
            </span>
          ) : null}
        </div>
      ) : (
        <ToolFallbackArgs argsText={original} />
      )}

      {destructive ? (
        <DestructiveWarning toolName={toolName} activity={activity} render={destructiveWarning} />
      ) : null}

      {denying ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={reasonId} className="text-muted-foreground text-xs">
            Reason for denying (optional, sent to the assistant)
          </label>
          <Textarea
            id={reasonId}
            value={reason}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
            rows={1}
            placeholder="e.g. wrong recipient"
            autoFocus
          />
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {denying ? (
          <>
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => decide('deny')}>
              Confirm deny
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDenying(false)}>
              Back
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" disabled={busy || !draftValid} onClick={() => decide('once')}>
              Allow once
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || draftChanged}
              onClick={() => decide('always')}
            >
              Always allow
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDenying(true)}>
              Deny
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              className="ms-auto"
              onClick={() => {
                if (editing) setDraft(original);
                setEditing(!editing);
              }}
            >
              {editing ? 'Discard edits' : 'Edit arguments'}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function DestructiveWarning({
  toolName,
  activity,
  render,
}: {
  toolName: string;
  activity: string | null;
  render: ((toolName: string, activity: string | null) => ReactNode) | undefined;
}) {
  return (
    <div
      role="alert"
      className="border-accent-amber/50 bg-accent-amber/15 text-foreground flex items-start gap-2 border px-2.5 py-2 text-xs leading-relaxed"
    >
      {render ? (
        render(toolName, activity)
      ) : (
        <span>
          This will modify your document: <strong>{activity ?? toolName}</strong>. Review before
          approving.
        </span>
      )}
    </div>
  );
}
