/**
 * 极简 TTL 缓存：同一 key 的并发加载共享一个 Promise；加载失败不缓存。
 * 条目数超过 maxEntries 时清理已过期条目，避免长期运行的 worker 因活动 id 不断增加而积累
 * （活动行含整份 HTML，可达数百 KB）。
 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { expires: number; value: Promise<V> }>();
  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now, private readonly maxEntries = 256) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    if (this.entries.size >= this.maxEntries) this.sweep();
    const value = load();
    this.entries.set(key, { expires: this.now() + this.ttlMs, value });
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }

  get size() { return this.entries.size; }

  clear() { this.entries.clear(); }

  private sweep() {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expires <= now) this.entries.delete(key);
  }
}
