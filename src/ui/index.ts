/**
 * Talk2View UI — pre-styled chat components powered by assistant-ui.
 *
 * Requires Tailwind CSS and @assistant-ui/react + @assistant-ui/react-ui peer dependencies.
 *
 * @example
 * ```tsx
 * import { T2VAssistantProvider, T2VThread } from '@talk2view/sdk/ui';
 *
 * function App() {
 *   return (
 *     <T2VAssistantProvider partnerKey="pk_live_abc" tools={myTools}>
 *       <T2VThread />
 *     </T2VAssistantProvider>
 *   );
 * }
 * ```
 *
 * @packageDocumentation
 */

// ── Components ──
export { T2VAssistantProvider, useT2VChatActions } from './components/T2VAssistantProvider';
export { T2VThread } from './components/T2VThread';
export { T2VAssistantModal } from './components/T2VAssistantModal';
export { T2VLoginGate } from './components/T2VLoginGate';
export { T2VToolFallback } from './components/T2VToolFallback';
export { T2VComposer } from './components/T2VComposer';
export { T2VChatHeader } from './components/T2VChatHeader';

// ── Hooks ──
export { useT2VRuntime } from './runtime/useT2VRuntime';

// ── Adapters ──
export { T2VDictationAdapter } from './components/T2VDictationAdapter';

// ── Utilities ──
export { convertDisplayMessage } from './runtime/convertMessage';
export { t2vPreset } from './themes/tailwind-preset';

// ── Types ──
export type { T2VAssistantProviderProps } from './components/T2VAssistantProvider';
export type { T2VThreadProps } from './components/T2VThread';
export type { T2VAssistantModalProps } from './components/T2VAssistantModal';
export type { T2VLoginGateProps } from './components/T2VLoginGate';
export type { T2VChatHeaderProps } from './components/T2VChatHeader';
export type { UseT2VRuntimeOptions } from './runtime/useT2VRuntime';
