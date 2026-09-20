"use client";

/*
 * Vendored from assistant-ui's shadcn registry (Base UI flavour).
 * Copyright (c) 2025 AgentbaseAI Inc. Licensed under the MIT License;
 * see ./LICENSE. Source: https://github.com/assistant-ui/assistant-ui
 *
 * Not hand-edited. Every difference from upstream is a path rewrite, the
 * codemod or a patch in scripts/chat/ — run `npm run chat:sync` to refresh.
 */

import { memo, useCallback, useRef } from "react";
import {
  useScrollLock,
  useAuiState,
  type ReasoningMessagePartComponent,
  type ReasoningGroupComponent,
} from "@assistant-ui/react";
import { MarkdownText } from "../markdown.js";
import {
  ANIMATION_DURATION,
  ReasoningRoot as ReasoningRootBase,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
  type ReasoningRootProps,
} from "./reasoning.js";

export type { ReasoningRootProps } from "./reasoning.js";

/** `ReasoningRoot` with the thread viewport scroll locked during disclosure animations. */
function ReasoningRoot({
  ref,
  onAnimationStart,
  ...props
}: ReasoningRootProps) {
  const collapsibleRef = useRef<HTMLDivElement | null>(null);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const handleAnimationStart = useCallback(() => {
    lockScroll();
    onAnimationStart?.();
  }, [lockScroll, onAnimationStart]);

  const composedRef = useCallback(
    (node: HTMLDivElement | null) => {
      collapsibleRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    },
    [ref],
  );

  return (
    <ReasoningRootBase
      ref={composedRef}
      onAnimationStart={handleAnimationStart}
      {...props}
    />
  );
}

const ReasoningImpl: ReasoningMessagePartComponent = () => <MarkdownText />;

const ReasoningGroupImpl: ReasoningGroupComponent = ({
  children,
  startIndex,
  endIndex,
}) => {
  const isReasoningStreaming = useAuiState((s) => {
    if (s.message.status?.type !== "running") return false;
    for (let index = startIndex; index <= endIndex; index++) {
      if (s.message.parts[index]?.status.type === "running") return true;
    }
    return false;
  });

  return (
    <ReasoningRoot streaming={isReasoningStreaming}>
      <ReasoningTrigger active={isReasoningStreaming} />
      <ReasoningContent aria-busy={isReasoningStreaming}>
        <ReasoningText>{children}</ReasoningText>
      </ReasoningContent>
    </ReasoningRoot>
  );
};

const Reasoning = memo(
  ReasoningImpl,
) as unknown as ReasoningMessagePartComponent & {
  Root: typeof ReasoningRoot;
  Trigger: typeof ReasoningTrigger;
  Content: typeof ReasoningContent;
  Text: typeof ReasoningText;
  Fade: typeof ReasoningFade;
};

Reasoning.displayName = "Reasoning";
Reasoning.Root = ReasoningRoot;
Reasoning.Trigger = ReasoningTrigger;
Reasoning.Content = ReasoningContent;
Reasoning.Text = ReasoningText;
Reasoning.Fade = ReasoningFade;

/**
 * @deprecated This wrapper targets the legacy `components.ReasoningGroup`
 * prop on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>`
 * with a `groupBy` returning `"group-reasoning"` and compose `ReasoningRoot`
 * / `ReasoningTrigger` / `ReasoningContent` / `ReasoningText` directly.
 * See `thread.aui.tsx` for an example.
 */
const ReasoningGroup = memo(ReasoningGroupImpl);
ReasoningGroup.displayName = "ReasoningGroup";

export {
  Reasoning,
  ReasoningGroup,
  ReasoningRoot,
  ReasoningTrigger,
  ReasoningContent,
  ReasoningText,
  ReasoningFade,
  reasoningVariants,
};
