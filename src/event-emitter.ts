export class TypedEventEmitter<TEvents extends Record<string, unknown[]>> {
  private listeners = new Map<keyof TEvents, Set<(...args: unknown[]) => void>>();

  on<K extends keyof TEvents>(
    event: K,
    callback: (...args: TEvents[K]) => void,
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(callback as (...args: unknown[]) => void);
    return () => set.delete(callback as (...args: unknown[]) => void);
  }

  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        cb(...args);
      }
    }
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
