// Every component in this directory that renders a DOM element is wrapped in
// `forwardRef`. React 19 lets a plain function component read `ref` out of its
// props; React 18 — which this package still supports — strips it, warns, and
// the ref reaches nothing. Base UI hands refs to whatever it renders, so a
// plain function here loses them silently. See tests/chat/ui-refs.test.tsx.
import * as React from "react"
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

const Collapsible = React.forwardRef<
  HTMLDivElement,
  CollapsiblePrimitive.Root.Props
>(function Collapsible({ ...props }, ref) {
  return (
    <CollapsiblePrimitive.Root ref={ref} data-slot="collapsible" {...props} />
  )
})
Collapsible.displayName = "Collapsible"

const CollapsibleTrigger = React.forwardRef<
  HTMLButtonElement,
  CollapsiblePrimitive.Trigger.Props
>(function CollapsibleTrigger({ ...props }, ref) {
  return (
    <CollapsiblePrimitive.Trigger
      ref={ref}
      data-slot="collapsible-trigger"
      {...props}
    />
  )
})
CollapsibleTrigger.displayName = "CollapsibleTrigger"

const CollapsibleContent = React.forwardRef<
  HTMLDivElement,
  CollapsiblePrimitive.Panel.Props
>(function CollapsibleContent({ ...props }, ref) {
  return (
    <CollapsiblePrimitive.Panel
      ref={ref}
      data-slot="collapsible-content"
      {...props}
    />
  )
})
CollapsibleContent.displayName = "CollapsibleContent"

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
