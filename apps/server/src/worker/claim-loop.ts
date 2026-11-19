/**
 * 持续并发池：始终保持最多 `concurrency` 个任务在处理，某个任务完成就立刻领取下一条，
 * 取代“领取一批 → 等整批完成 → 再领下一批”的模式，避免一条慢任务（SMTP 超时、慢 LLM 调用）拖住整批。
 */
export type ClaimLoopOptions<T extends { id: string }> = {
  name: string;
  concurrency: number;
  /** 兜底轮询间隔（无任务时多久再领一次）。 */
  intervalMs?: number;
  claim(limit: number): Promise<T[]>;
  process(item: T): Promise<void>;
  /** 每次领取前执行（如回收过期租约）；失败只记日志。 */
  beforeClaim?(): Promise<void>;
  /** 本次没有领到任务时执行（如空闲时同步退订）。 */
  onIdle?(): Promise<void>;
  /** 定期为处理中的任务续租。 */
  heartbeat?: { everyMs: number; renew(items: T[]): Promise<void> };
  onStop?(): void;
};

export function startClaimLoop<T extends { id: string }>(options: ClaimLoopOptions<T>) {
  const inFlight = new Map<string, T>();
  let stopped = false;
  let claiming = false;
  let again = false;

  const fill = async (): Promise<void> => {
    if (stopped) return;
    if (claiming) { again = true; return; }
    claiming = true;
    try {
      await options.beforeClaim?.();
      const free = options.concurrency - inFlight.size;
      if (free <= 0 || stopped) return;
      const claimed = await options.claim(free);
      if (!claimed.length) { await options.onIdle?.(); return; }
      for (const item of claimed) {
        inFlight.set(item.id, item);
        void options.process(item)
          .catch((error: unknown) => { console.error(`[${options.name}] message ${item.id} 处理失败`, error); })
          .finally(() => { inFlight.delete(item.id); void fill(); });
      }
    } catch (error) {
      // 单轮失败（如数据库瞬断）只记日志，下一轮重试；不得让 rejection 逃出导致进程退出。
      console.error(`[${options.name}] tick 失败，下一轮重试`, error);
    } finally {
      claiming = false;
      if (again && !stopped) { again = false; void fill(); }
    }
  };

  const timer = setInterval(() => { void fill(); }, options.intervalMs ?? 1000);
  timer.unref();
  let renewing: Promise<void> | undefined;
  const heartbeat = options.heartbeat && setInterval(() => {
    if (renewing || !inFlight.size) return;
    renewing = options.heartbeat!.renew([...inFlight.values()])
      .catch((error: unknown) => { console.error(`[${options.name}] 租约续期失败`, error); })
      .finally(() => { renewing = undefined; });
  }, options.heartbeat.everyMs);
  heartbeat?.unref();
  void fill();

  return {
    get inFlight() { return inFlight.size; },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (heartbeat) clearInterval(heartbeat);
      while (claiming || inFlight.size) await new Promise((resolve) => setTimeout(resolve, 10));
      await renewing;
      options.onStop?.();
    }
  };
}
