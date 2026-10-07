/**
 * Kiểu chung cho thanh tiêu đề của các trang danh sách: Health Customer Service,
 * Enrollment (ACA / Medicare / Medicaid), Lead Management, Provider List.
 *
 * Mẫu là trang Enrollment. Trước đây mỗi trang tự gõ class nên lệch nhau: nút
 * của Provider cao 40px trong khi chỗ khác 36px, nút Import của Enrollment không
 * cùng kiểu với nút Export đứng ngay cạnh, còn nút của Lead tụt xuống ngang dòng
 * phụ đề thay vì ngang tiêu đề. Sửa kiểu ở đây là sửa cho mọi trang.
 */

/** Hàng tiêu đề: tên trang bên trái, nhóm nút bên phải. */
export const PAGE_HEADER_CLASS = "flex flex-wrap items-end justify-between gap-3";

/**
 * Như trên nhưng nhóm nút canh theo dòng TIÊU ĐỀ chứ không theo đáy khối chữ —
 * dùng khi dưới tiêu đề còn một dòng phụ đề.
 */
export const PAGE_HEADER_WITH_SUBTITLE_CLASS =
  "flex flex-wrap items-start justify-between gap-3";

export const PAGE_TITLE_CLASS =
  "text-3xl font-bold leading-tight tracking-normal text-[#172b4d]";

export const PAGE_ACTIONS_CLASS = "flex flex-wrap items-center justify-end gap-2";

/** Nút chính (New task / New enrollment / Add lead / Add address), luôn đứng cuối bên phải. */
export const PAGE_PRIMARY_BUTTON_CLASS =
  "inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60";

const SECONDARY_BASE =
  "inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Nút phụ (Export, Import, Reassign, Distribute…).
 *
 * `open`    — menu của nút đang mở (Export).
 * `pressed` — nút bật/tắt một chế độ đang BẬT (Reassign leads): thêm nền xanh nhạt
 *             để nhìn là biết đang ở chế độ đó.
 */
export function pageSecondaryButtonClass(state?: "open" | "pressed"): string {
  if (state === "pressed") {
    return `${SECONDARY_BASE} border-[#0c66e4] bg-[#e9f2ff] text-[#0c66e4]`;
  }
  if (state === "open") {
    return `${SECONDARY_BASE} border-[#0c66e4] bg-white text-[#0c66e4]`;
  }
  return `${SECONDARY_BASE} border-[#d8dee8] bg-white text-[#42526e] hover:border-[#0c66e4] hover:text-[#0c66e4]`;
}
