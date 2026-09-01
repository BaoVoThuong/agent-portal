"use client";

export type LeadEventOption = {
  id: string;
  name: string;
  event_date: string | null;
};

/**
 * Danh sách sự kiện dùng chung cho dialog Add và Import.
 *
 * Trước đó mỗi dialog tự gọi `/api/leads/events` và giữ bản riêng, nên mở Add
 * rồi mở Import là hai lần tải cùng một danh sách — và một sự kiện vừa tạo
 * trong Import không xuất hiện bên Add cho tới khi tải lại trang.
 *
 * Không đặt thời hạn: `prime()` được gọi ngay sau khi tạo sự kiện, và mỗi lần
 * mở dialog vẫn làm mới ở nền. Một cache tự hết hạn chỉ thêm một trạng thái nữa
 * để sai.
 */
let cached: { events: LeadEventOption[]; truncated: boolean } | null = null;
let inflight: Promise<{ events: LeadEventOption[]; truncated: boolean }> | null = null;

export function peekLeadEvents() {
  return cached;
}

/** Thêm một sự kiện vừa tạo mà không cần đi vòng qua mạng. */
export function primeLeadEvent(event: LeadEventOption) {
  if (!cached) return;
  if (cached.events.some((item) => item.id === event.id)) return;
  cached = { ...cached, events: [event, ...cached.events] };
}

export async function fetchLeadEvents(): Promise<{
  events: LeadEventOption[];
  truncated: boolean;
}> {
  // Hai dialog mở gần nhau chỉ tốn một request: cái thứ hai chờ cùng promise.
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch("/api/leads/events", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.events)) {
        throw new Error(payload?.error ?? "Could not load events.");
      }
      cached = {
        events: payload.events as LeadEventOption[],
        truncated: payload.truncated === true,
      };
      return cached;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}
