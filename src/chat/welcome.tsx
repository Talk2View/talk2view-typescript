'use client';

/**
 * The opening screen. assistant-ui's `components={{ Welcome }}` slot replaces
 * the whole section, which is how the heading is set without touching the
 * vendored thread. The openers underneath it are not here: they come from the
 * suggestion store the provider seeds, and the thread renders them itself.
 */
import type { FC } from 'react';
import { useChatContext } from './provider.js';

export const DEFAULT_WELCOME_HEADING = 'How can I help you today?';

export const Welcome: FC = () => {
  const { welcome } = useChatContext();
  return (
    <div className="aui-thread-welcome-root mb-6 flex flex-col px-2">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-medium tracking-tight duration-200">
        {welcome.heading ?? DEFAULT_WELCOME_HEADING}
      </h1>
    </div>
  );
};
