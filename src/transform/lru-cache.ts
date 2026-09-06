/**
 * The memo every per-message transform needs.
 *
 * Cleaning or splitting one body means parsing HTML and walking a DOM — real
 * work, tens of milliseconds on a fat Outlook mail. In a mail client bodies
 * arrive one at a time, continuously, and re-transforming the whole thread on
 * each arrival is what turns a 200-message thread from instant into a locked
 * tab. So results are memoized per message.
 *
 * Keyed by id AND invalidated by the source body, because the id alone is a
 * lie: a pending message whose body later arrives keeps its id, and serving the
 * cached (empty) result for it is exactly the bug where a message never renders
 * its content.
 *
 * Bounded, because entries hold both the source and the derived value: unbounded,
 * a long-lived session browsing thousands of messages retains every body it ever
 * rendered.
 */

/** Default capacity — comfortably more than any single thread. */
export const DEFAULT_CACHE_CAPACITY = 500;

/** A memo of values derived from a message body. */
export interface KeyedCache<T> {
  /** The stored value for this message, if the cached source still matches. */
  get(id: string, source: string): T | undefined;
  /** Record a derived value. */
  set(id: string, source: string, value: T): void;
  /** Drop everything. Call when switching threads. */
  clear(): void;
  /** Current entry count, for diagnostics and tests. */
  readonly size: number;
}

/**
 * Create a bounded, least-recently-used cache.
 *
 * `Map` iterates in insertion order, which is all an LRU needs — re-inserting
 * on a hit moves an entry to the end, so the oldest key is always first.
 */
export function createKeyedCache<T>(capacity = DEFAULT_CACHE_CAPACITY): KeyedCache<T> {
  const entries = new Map<string, { source: string; value: T }>();

  return {
    get(id, source) {
      const entry = entries.get(id);
      if (!entry || entry.source !== source) return undefined;
      entries.delete(id);
      entries.set(id, entry);
      return entry.value;
    },
    set(id, source, value) {
      if (entries.has(id)) entries.delete(id);
      entries.set(id, { source, value });
      if (entries.size > capacity) {
        const oldest = entries.keys().next();
        if (!oldest.done) entries.delete(oldest.value);
      }
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
  };
}
