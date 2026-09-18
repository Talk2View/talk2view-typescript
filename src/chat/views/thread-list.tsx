'use client';

/**
 * Earlier conversations, over the thread. The list itself is assistant-ui's
 * vendored one; this adds the search box (only once there is something to search)
 * and closes the view when a conversation is picked.
 */
import { useState, type FC } from 'react';
import { useAuiState } from '@assistant-ui/react';
import {
  ThreadListItems,
  ThreadListRoot,
  ThreadListSearch,
} from '../vendor/thread-list.aui.js';

export const ThreadListView: FC<{ onSelect: () => void }> = ({ onSelect }) => {
  const [search, setSearch] = useState('');
  const hasThreads = useAuiState((s) => s.threads.threadIds.length > 0);

  return (
    <ThreadListRoot
      className="t2v-chat-thread-list aui-modal-thread-list bg-popover absolute inset-0 overflow-y-auto p-2"
      onClick={(event) => {
        const target = event.target as Element;
        if (target.closest("[data-slot='aui_thread-list-item-trigger']")) {
          onSelect();
        }
      }}
    >
      {hasThreads && <ThreadListSearch value={search} onValueChange={setSearch} />}
      <ThreadListItems searchQuery={hasThreads ? search : ''} />
    </ThreadListRoot>
  );
};
