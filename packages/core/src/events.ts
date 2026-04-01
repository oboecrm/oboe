import type { EventBus } from "./types.js";

export function createEventBus(): EventBus {
  const listeners = new Map<
    string,
    Set<(payload: Record<string, unknown>) => void | Promise<void>>
  >();

  return {
    async emit(name, payload) {
      const bucket = listeners.get(name);
      if (!bucket) {
        return;
      }

      for (const listener of bucket) {
        await listener(payload);
      }
    },

    on(name, listener) {
      const bucket = listeners.get(name) ?? new Set();
      bucket.add(listener);
      listeners.set(name, bucket);

      return () => {
        bucket.delete(listener);

        if (bucket.size === 0) {
          listeners.delete(name);
        }
      };
    },
  };
}
