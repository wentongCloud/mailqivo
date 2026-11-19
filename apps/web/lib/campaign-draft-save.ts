/** A save action finishes only once the submitted snapshot matches the latest edits. */
export function createDraftSaver() {
  let pending: Promise<string | null> | undefined;
  return function save<T>(
    read: () => T,
    persist: (values: T) => Promise<{ id: string; apply: () => void } | null>
  ): Promise<string | null> {
    if (pending) return pending;
    async function writeLatest() {
      for (;;) {
        const values = structuredClone(read());
        const saved = await persist(values);
        if (!saved) return null;
        if (JSON.stringify(values) !== JSON.stringify(read())) continue;
        saved.apply();
        return saved.id;
      }
    }
    pending = writeLatest().finally(() => { pending = undefined; });
    return pending;
  };
}
