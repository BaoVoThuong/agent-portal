/**
 * Bộ khung nhỏ cho thao tác "đổi giao diện trước, gọi API sau".
 *
 * Chỉ dùng cho luồng mới hoặc luồng được sửa trong plan instant feedback
 * (docs/superpowers/plans/2026-10-02-ui-instant-feedback.md, QĐ-E). `patchTask`,
 * `patchLead`, `patchRecord` đã có hàng đợi và rebase riêng, giữ nguyên.
 *
 * File `.ts` thuần để vitest (environment "node") test được.
 */

export class MutationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: unknown = null,
  ) {
    super(message);
    this.name = "MutationError";
  }

  /** 0 = không tới được server (mất mạng, request bị chặn). */
  get isNetwork(): boolean {
    return this.status === 0;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
}

export function toMutationError(
  cause: unknown,
  fallback = "Could not save the change.",
): MutationError {
  if (cause instanceof MutationError) return cause;
  return new MutationError(cause instanceof Error && cause.message ? cause.message : fallback, 0);
}

/**
 * fetch + đọc JSON. Mất mạng thì ném `MutationError` status 0; HTTP lỗi thì ném
 * kèm status thật và `error` API trả về. Body là chuỗi thì tự thêm
 * `Content-Type: application/json`; `FormData` để trình duyệt tự đặt.
 */
export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new MutationError("Connection lost — the change was not saved.", 0);
  }
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload.error === "string" && payload.error
        ? payload.error
        : `Request failed (${response.status}).`;
    throw new MutationError(message, response.status, payload);
  }
  return payload as T;
}

/**
 * Đánh số các lượt ghi theo key (thường là id bản ghi, hoặc `id:field`). Lượt
 * cũ xong sau lượt mới thì `isLatest()` trả false: nó không được ghi đè kết quả
 * của lượt mới hơn, dù nó thành công hay hỏng.
 */
export function createMutationTracker() {
  const latest = new Map<string, number>();
  let sequence = 0;
  return {
    begin(key: string) {
      sequence += 1;
      const id = sequence;
      latest.set(key, id);
      return {
        isLatest: () => latest.get(key) === id,
        /** Gọi khi lượt này xong hẳn, để map không giữ key mãi. */
        end: () => {
          if (latest.get(key) === id) latest.delete(key);
        },
      };
    },
    /** Còn lượt nào của key này đang chạy không. */
    isPending(key: string) {
      return latest.has(key);
    },
  };
}

export type OptimisticResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MutationError };

/**
 * Đổi giao diện (`apply`) → gọi API (`request`) → thành công thì `commit` bằng
 * dữ liệu server, lỗi thì `rollback`.
 *
 * `commit`/`rollback` chỉ chạy khi lượt này còn là lượt mới nhất (`isLatest`,
 * mặc định luôn đúng): lượt mới hơn sẽ tự quyết trạng thái cuối. `apply` nằm
 * trong `try` — nó ném thì coi như lượt ghi hỏng, không gọi API. Không tự hiện
 * lỗi: nơi gọi quyết định hiện ở đâu.
 */
export async function runOptimistic<T>(steps: {
  apply: () => void;
  request: () => Promise<T>;
  commit?: (value: T) => void;
  rollback: (error: MutationError) => void;
  isLatest?: () => boolean;
}): Promise<OptimisticResult<T>> {
  const isLatest = steps.isLatest ?? (() => true);
  let applied = false;
  try {
    steps.apply();
    applied = true;
    const value = await steps.request();
    if (isLatest()) steps.commit?.(value);
    return { ok: true, value };
  } catch (cause) {
    const error = toMutationError(cause);
    if (applied && isLatest()) steps.rollback(error);
    return { ok: false, error };
  }
}
