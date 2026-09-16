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
export { T2VProvider, useT2V } from './T2VProvider.js';

// ── Hooks ──
export { useT2VAuth } from './useT2VAuth.js';
export { useT2VChat } from './useT2VChat.js';
export { useT2VTools } from './useT2VTools.js';
export { useUserPreferences } from './useUserPreferences.js';
export { usePartnerConfig } from './usePartnerConfig.js';

// ── Theme utilities ──
export { T2V_VARS } from './theme.js';

// ── Types ──
export type { T2VProviderProps } from './T2VProvider.js';
export type { UseT2VAuthResult } from './useT2VAuth.js';
export type { UseT2VChatResult, PendingApproval } from './useT2VChat.js';
export type { DisplayMessage, ToolStep } from '../types.js';
export type { UseT2VToolsResult } from './useT2VTools.js';
export type { UseUserPreferencesResult } from './useUserPreferences.js';
export type { UsePartnerConfigResult } from './usePartnerConfig.js';
