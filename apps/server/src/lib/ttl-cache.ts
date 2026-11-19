/** 极简 TTL 缓存：同一 key 的并发加载共享一个 Promise；加载失败不缓存。 */
export class TtlCache<V> {
  private readonly entries = new Map<string, { expires: number; value: Promise<V> }>();
  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.entries.get(key);
    if (hit && hit.expires > this.now()) return hit.value;
    const value = load();
    this.entries.set(key, { expires: this.now() + this.ttlMs, value });
    value.catch(() => { if (this.entries.get(key)?.value === value) this.entries.delete(key); });
    return value;
  }

  clear() { this.entries.clear(); }
}
