/**
 * Where the current dictation is up to. assistant-ui says "listening" from the
 * mic tap until the transcript lands; the SDK's adapter also reports the wait in
 * between, and the composer's voice button shows it.
 *
 * One store per chat, held in the chat's context — two chats on one page
 * (a task pane and a launcher, say) each dictate on their own.
 */
import { useSyncExternalStore } from 'react';
import type { Talk2ViewDictationPhase } from '../../assistant-ui/index.js';

export interface DictationPhaseStore {
  set: (phase: Talk2ViewDictationPhase) => void;
  get: () => Talk2ViewDictationPhase;
  subscribe: (listener: () => void) => () => void;
}

export function createDictationPhaseStore(): DictationPhaseStore {
  let phase: Talk2ViewDictationPhase = 'idle';
  const listeners = new Set<() => void>();
  return {
    set: (next) => {
      if (next === phase) return;
      phase = next;
      listeners.forEach((notify) => notify());
    },
    get: () => phase,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const IDLE = () => 'idle' as const;

export function useDictationPhase(store: DictationPhaseStore): Talk2ViewDictationPhase {
  return useSyncExternalStore(store.subscribe, store.get, IDLE);
}
