import type { CSSProperties } from "react";

export type MultiValueBadgeItem = {
  key: string;
  label: string;
  /** Màu của option (badge có màu). Bỏ trống thì dùng `className` hoặc màu trung tính. */
  style?: CSSProperties;
  className?: string;
};

const NEUTRAL_BADGE_CLASS = "bg-[#f4f5f7] text-[#6b778c]";

/**
 * Một cách hiện cho MỌI ô chọn nhiều giá trị (2026-10-02): Carrier của
 * Enrollment, cột multiselect tự thêm (Task CS / Enrollment / Leads),
 * Collaborators của Leads, cột nhiều giá trị của Provider List.
 *
 * Hiện HẾT các giá trị, hết chỗ thì xuống dòng — người dùng chốt không gom thành
 * "+N". Nhãn dài hơn bề rộng ô thì có "…" thay vì tràn; rê chuột thấy đủ.
 * `maxVisible` chỉ dùng khi một màn cố ý giới hạn (còn lại thì "+N").
 *
 * Trước đây mỗi màn tự vẽ, và chữ đặt thẳng trong flex container nên nhãn dài bị
 * cắt cụt không có dấu "…" ("HEALTHSPRING/CIG").
 */
export function MultiValueBadges({
  items,
  maxVisible = null,
  uppercase = true,
}: {
  items: readonly MultiValueBadgeItem[];
  /** `null` (mặc định) = hiện tất cả. */
  maxVisible?: number | null;
  uppercase?: boolean;
}) {
  const visible = maxVisible === null ? items : items.slice(0, Math.max(1, maxVisible));
  const hiddenItems = items.slice(visible.length);
  const textClass = uppercase
    ? "text-[11px] font-semibold uppercase tracking-[0.025em]"
    : "text-[11px] font-semibold";

  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-1"
      title={items.map((item) => item.label).join(", ")}
    >
      {visible.map((item) => (
        <span
          key={item.key}
          className={`inline-flex min-w-0 max-w-full items-center rounded px-1.5 py-0.5 ${textClass} ${
            item.style ? "" : item.className ?? NEUTRAL_BADGE_CLASS
          }`}
          style={item.style}
          title={item.label}
        >
          {/* Chữ phải nằm trong span con thì "…" mới chạy. */}
          <span className="min-w-0 truncate">{item.label}</span>
        </span>
      ))}
      {hiddenItems.length > 0 ? (
        <span
          className="inline-flex shrink-0 items-center rounded border border-[#dfe1e6] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#44546f]"
          title={hiddenItems.map((item) => item.label).join(", ")}
        >
          +{hiddenItems.length}
        </span>
      ) : null}
    </span>
  );
}
