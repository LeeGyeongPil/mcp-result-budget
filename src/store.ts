import { BudgetConfigError } from "./errors.js";
import type { PageStore, StoredResult } from "./types.js";

/** In-memory store with TTL, an entry cap (maxEntries, default 100) and a total size cap (maxTotalChars, default 32 million chars), evicting least recently used first. The clock can be injected for tests. */
export class MemoryPageStore implements PageStore {
  private readonly entries = new Map<string, { value: StoredResult; expires: number; chars: number }>();
  private readonly maxTotalChars: number;
  private totalChars = 0;
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(opts: { ttlMs?: number; maxEntries?: number; maxTotalChars?: number; now?: () => number } = {}) {
    this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
    this.maxEntries = opts.maxEntries ?? 100;
    this.maxTotalChars = opts.maxTotalChars ?? 32_000_000;
    this.now = opts.now ?? Date.now;
    for (const [name, v] of [["ttlMs", this.ttlMs], ["maxEntries", this.maxEntries], ["maxTotalChars", this.maxTotalChars]] as const) {
      if (!Number.isFinite(v) || v <= 0) {
        throw new BudgetConfigError(`MemoryPageStore: ${name} must be a positive finite number, got ${v}`);
      }
    }
  }

  async get(id: string): Promise<StoredResult | undefined> {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.remove(id);
      return undefined;
    }
    // Re-insert so the Map order tracks recency of use.
    this.entries.delete(id);
    entry.expires = this.now() + this.ttlMs;
    this.entries.set(id, entry);
    return entry.value;
  }

  async set(id: string, value: StoredResult): Promise<void> {
    this.remove(id);
    const chars = value.pages.reduce((n, p) => n + JSON.stringify(p).length, 0);
    this.entries.set(id, { value, expires: this.now() + this.ttlMs, chars });
    this.totalChars += chars;
    // Sweep expired entries, then evict the least recently used until both limits hold
    // (the newest entry is always kept, even if it alone exceeds maxTotalChars).
    const t = this.now();
    for (const [k, e] of this.entries) if (e.expires <= t) this.remove(k);
    while (this.entries.size > 1 && (this.entries.size > this.maxEntries || this.totalChars > this.maxTotalChars)) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }

  async delete(id: string): Promise<void> {
    this.remove(id);
  }

  private remove(id: string): void {
    const e = this.entries.get(id);
    if (!e) return;
    this.totalChars -= e.chars;
    this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}
