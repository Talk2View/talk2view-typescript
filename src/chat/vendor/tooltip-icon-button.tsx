"use client";

/*
 * Vendored from assistant-ui's shadcn registry (Base UI flavour).
 * Copyright (c) 2025 AgentbaseAI Inc. Licensed under the MIT License;
 * see ./LICENSE. Source: https://github.com/assistant-ui/assistant-ui
 *
 * Not hand-edited. Every difference from upstream is a path rewrite, the
 * codemod or a patch in scripts/chat/ — run `npm run chat:sync` to refresh.
 */

import { type ComponentPropsWithRef, forwardRef } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, side = "bottom", className, ...rest }, ref) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              {...rest}
              className={cn(
                "aui-button-icon size-6 p-1 active:scale-90",
                className,
              )}
              ref={ref}
            />
          }
        >
          {children}
          <span className="aui-sr-only sr-only">{tooltip}</span>
        </TooltipTrigger>
        <TooltipContent side={side}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

TooltipIconButton.displayName = "TooltipIconButton";
