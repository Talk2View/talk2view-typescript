// Every component in this directory is wrapped in `forwardRef`. React 19 lets a
// plain function component read `ref` out of its props; React 18 — which this
// package still supports — strips it, warns, and the ref reaches nothing. Its
// props type advertises a `ref`, so a plain function here breaks that promise
// on 18. See tests/chat/ui-refs.test.tsx.
import * as React from "react"
import { cn } from "../lib/cn.js"

const Skeleton = React.forwardRef<HTMLDivElement, React.ComponentProps<"div">>(
  function Skeleton({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="skeleton"
        className={cn("animate-pulse rounded-md bg-muted", className)}
        {...props}
      />
    )
  }
)
Skeleton.displayName = "Skeleton"

export { Skeleton }
