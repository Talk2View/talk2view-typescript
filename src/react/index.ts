/**
 * Headless React hooks and utilities for Talk2View SDK.
 *
 * This module provides state management hooks with no UI components.
 * For pre-built UI, use `@talk2view/sdk/ui` instead.
 *
 * @example
 * ```tsx
 * import { T2VProvider, useT2VChat, useT2VAuth } from '@talk2view/sdk/react';
 * ```
 *
 * @packageDocumentation
 */

// ── Provider ──
export { T2VProvider, useT2V } from './T2VProvider';

// ── Hooks ──
export { useT2VAuth } from './useT2VAuth';
export { useT2VChat } from './useT2VChat';
export { useT2VTools } from './useT2VTools';
export { useUserPreferences } from './useUserPreferences';
export { usePartnerConfig } from './usePartnerConfig';

// ── Theme utilities ──
export { T2V_VARS } from './theme';

// ── Types ──
export type { T2VProviderProps } from './T2VProvider';
export type { UseT2VAuthResult } from './useT2VAuth';
export type { UseT2VChatResult, DisplayMessage, ToolStep, PendingApproval } from './useT2VChat';
export type { UseT2VToolsResult } from './useT2VTools';
export type { UseUserPreferencesResult } from './useUserPreferences';
export type { UsePartnerConfigResult } from './usePartnerConfig';
