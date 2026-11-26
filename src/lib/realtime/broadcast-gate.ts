/**
 * Gộp tín hiệu Realtime `changed` để giới hạn số lần làm mới danh sách.
 *
 * Mỗi tín hiệu làm tab tải lại cả danh sách. Khi tín hiệu đến dồn dập (import,
 * sửa hàng loạt, nhiều người cùng sửa), tab sẽ tải lại liên tục. Cổng cho tín
 * hiệu đầu chạy ngay, rồi gộp mọi tín hiệu đến trong `minIntervalMs` tiếp theo
 * thành ĐÚNG một lần `fire` ở cuối cửa sổ: thay đổi không mất, chỉ trễ tối đa
 * một cửa sổ. Poll 60 giây và lần tải lại khi focus không đi qua cổng này.
 */
export const BROADCAST_REFETCH_MIN_INTERVAL_MS = 5_000;

export function broadcastGateDelay(
  lastFiredAt: number | null,
  now: number,
  minIntervalMs: number = BROADCAST_REFETCH_MIN_INTERVAL_MS,
): number {
  if (lastFiredAt === null) return 0;
  return Math.max(0, lastFiredAt + minIntervalMs - now);
}

export type BroadcastGate<T> = {
  push(value: T): void;
  dispose(): void;
};

export function createBroadcastGate<T>(options: {
  merge: (pending: T | null, incoming: T) => T;
  fire: (value: T) => void;
  minIntervalMs?: number;
  now?: () => number;
}): BroadcastGate<T> {
  const minIntervalMs =
    options.minIntervalMs ?? BROADCAST_REFETCH_MIN_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  let pending: T | null = null;
  let lastFiredAt: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const run = () => {
    timer = null;
    if (disposed || pending === null) return;
    const value = pending;
    pending = null;
    lastFiredAt = now();
    options.fire(value);
  };

  return {
    push(value) {
      if (disposed) return;
      pending = options.merge(pending, value);
      if (timer !== null) return;
      const delay = broadcastGateDelay(lastFiredAt, now(), minIntervalMs);
      if (delay === 0) {
        run();
        return;
      }
      timer = setTimeout(run, delay);
    },
    dispose() {
      disposed = true;
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
