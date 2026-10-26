import type { TableColumn } from "@/lib/table-config/types";
import { parseMultiselectValue } from "@/lib/table-config/multiselect";
import { parsePlanCell } from "./plans";
import { isProviderSpecialtyField, parseSpecialtyCell } from "./specialties";
import {
  PROVIDER_META_FIELDS,
  PROVIDER_TEXT_FIELDS,
  type ProviderRow,
} from "./types";

/**
 * Luật dữ liệu của form provider — dùng chung cho form Thêm và form Sửa.
 *
 * Để ở `lib` chứ không nằm trong file component: đây là phần duy nhất có thể
 * làm hỏng dữ liệu (ghi sai ô, gửi sai định dạng lên API), nên nó phải chạy
 * được dưới test. Vitest chỉ nhận `src/**\/*.test.ts` nên logic nằm trong
 * `.tsx` là logic không ai kiểm.
 */

export type ProviderFormValues = Record<string, unknown>;

export function isProviderPlanColumn(key: string): boolean {
  return key === "obamacare" || key === "medicare";
}

export function isProviderMultiselectColumn(column: TableColumn): boolean {
  return (
    column.type === "multiselect" ||
    isProviderSpecialtyField(column.key) ||
    isProviderPlanColumn(column.key)
  );
}

export function isProviderTextKey(
  key: string
): key is (typeof PROVIDER_TEXT_FIELDS)[number] {
  return (PROVIDER_TEXT_FIELDS as readonly string[]).includes(key);
}

export function isNewPatientColumn(column: TableColumn): boolean {
  return column.key === "accepting_new_patients";
}

export function isReviewedColumn(column: TableColumn): boolean {
  return column.key === "needs_review";
}

/** Cột `accepting_new_patients` là chữ "Yes"/"No" trong bảng, không phải boolean. */
export function isTruthyProviderValue(value: unknown): boolean {
  return ["yes", "true", "1", "y"].includes(String(value ?? "").trim().toLowerCase());
}

/**
 * Verified by / Verified date: hệ thống điền khi bật Reviewed (tên người bật và
 * ngày hôm đó), form chỉ hiện chứ không cho gõ — người soát là một người thật,
 * không phải chữ ai cũng gõ được (user chốt 25/10/2026). Vẫn gửi lên như ô
 * thường để lưu; Import thì máy chủ tự đóng dấu (lib/providers/import.ts).
 */
export const PROVIDER_VERIFIED_STAMP_KEYS = ["verified_by", "date"] as const;

export function isVerifiedStampColumn(column: TableColumn): boolean {
  return (
    column.is_system && (PROVIDER_VERIFIED_STAMP_KEYS as readonly string[]).includes(column.key)
  );
}

/**
 * Hai ô Verified của một bộ giá trị form, để trả về khi bỏ tick Reviewed.
 * `blank` cho form Thêm: dòng mới bỏ tick nghĩa là chưa ai soát.
 */
export function verifiedStampValues(
  values: ProviderFormValues,
  options: { blank?: boolean } = {}
): ProviderFormValues {
  return Object.fromEntries(
    PROVIDER_VERIFIED_STAMP_KEYS.filter((key) => key in values).map((key) => [
      key,
      options.blank ? "" : values[key],
    ])
  );
}

/**
 * Ngày soát tính theo giờ Việt Nam — nơi đội soát provider làm việc. Dùng chung
 * cho bản xem trước trên form và dấu do API/Import ghi: lấy giờ máy người dùng
 * thì người ở Mỹ tick buổi tối sẽ thấy một ngày mà server lưu ngày khác.
 */
export const PROVIDER_STAMP_TIME_ZONE = "Asia/Ho_Chi_Minh";

/** API chỉ lấy dấu đã lưu hoặc tự đóng dấu khi chuyển sang Reviewed. */
export function trustedVerifiedStamp(input: {
  currentNeedsReview: boolean | null;
  nextNeedsReview: boolean;
  currentVerifiedBy?: string | null;
  currentDate?: string | null;
  actorName: string;
  date: string;
}): { verified_by: string | null; date: string | null } {
  if (!input.nextNeedsReview && input.currentNeedsReview !== false) {
    return { verified_by: input.actorName, date: input.date };
  }
  return {
    verified_by: input.currentVerifiedBy ?? null,
    date: input.currentDate ?? null,
  };
}

export function isReadOnlyProviderColumn(column: TableColumn): boolean {
  return (
    column.is_system && (PROVIDER_META_FIELDS as readonly string[]).includes(column.key)
  );
}

function valueForColumn(provider: ProviderRow, column: TableColumn): unknown {
  if (isProviderTextKey(column.key)) return provider[column.key];
  if (column.is_system) {
    if (column.key === "needs_review") return provider.needs_review;
    if ((PROVIDER_META_FIELDS as readonly string[]).includes(column.key)) {
      return provider[column.key as keyof ProviderRow];
    }
    return null;
  }
  return provider.custom_values?.[column.key] ?? null;
}

/** Giá trị khởi tạo cho form SỬA: đọc từ một dòng có sẵn. */
export function providerFormValues(
  provider: ProviderRow,
  columns: readonly TableColumn[]
): ProviderFormValues {
  return Object.fromEntries(
    columns
      .filter((column) => !column.archived_at)
      .map((column) => {
        const raw = valueForColumn(provider, column);
        if (isNewPatientColumn(column)) return [column.key, isTruthyProviderValue(raw)];
        // Ô trên form là "Verified" (trước 26/10 tên "Reviewed"), cột trong bảng
        // là "needs_review" — ngược nhau.
        if (isReviewedColumn(column)) return [column.key, !isTruthyProviderValue(raw)];
        if (isProviderMultiselectColumn(column)) {
          return [
            column.key,
            isProviderSpecialtyField(column.key)
              ? parseSpecialtyCell(raw)
              : isProviderPlanColumn(column.key)
                ? parsePlanCell(raw as string | null)
                : parseMultiselectValue(raw),
          ];
        }
        return [column.key, raw ?? ""];
      })
  );
}

/**
 * Ngày hôm nay, viết theo đúng kiểu cột `date` đang dùng.
 *
 * Dữ liệu sẵn có trong `provider_directory` là chuỗi `MM/DD/YYYY` (cột text,
 * không phải cột ngày của Postgres). Ghi ISO vào đó là cột Verified date có hai
 * cách viết lẫn lộn. Nhưng admin đổi được kiểu cột sang `date` trong /config,
 * lúc ấy ô nhập là `<input type="date">` và CHỈ nhận `YYYY-MM-DD` — nên phải
 * hỏi cấu hình cột chứ không đoán.
 */
export function todayForColumn(
  column: TableColumn | undefined,
  now = new Date(),
  timeZone?: string,
): string {
  let year = String(now.getFullYear());
  let month = String(now.getMonth() + 1).padStart(2, "0");
  let day = String(now.getDate()).padStart(2, "0");
  if (timeZone) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    year = parts.find((part) => part.type === "year")?.value ?? year;
    month = parts.find((part) => part.type === "month")?.value ?? month;
    day = parts.find((part) => part.type === "day")?.value ?? day;
  }
  if (column?.type === "date") return `${year}-${month}-${day}`;
  return `${month}/${day}/${year}`;
}

/** Giá trị khởi tạo cho form THÊM mới: mọi ô trống, trừ ba ô nói dưới đây. */
export function blankProviderValues(
  columns: readonly TableColumn[],
  viewerName: string,
  now = new Date()
): ProviderFormValues {
  const values: ProviderFormValues = {};
  for (const column of columns) {
    if (column.archived_at) continue;
    if (isNewPatientColumn(column)) values[column.key] = false;
    // Người tự gõ thì đã nhìn thấy dữ liệu mình nhập — chỉ dữ liệu chuyển từ
    // Sheet sang mới cần người khác soát lại. Server cũng mặc định
    // needs_review=false cho dòng gõ tay, nên để ô này tắt là form nói sai về
    // thứ sắp được lưu.
    else if (isReviewedColumn(column)) values[column.key] = true;
    else if (isProviderMultiselectColumn(column)) values[column.key] = [];
    else if (column.type === "checkbox") values[column.key] = false;
    else values[column.key] = "";
  }
  // Hệ quả của dòng trên: đã coi là đã soát thì phải ghi luôn ai soát và soát
  // ngày nào, y như lúc bấm tay vào ô Reviewed bên form sửa.
  if ("verified_by" in values && viewerName) values.verified_by = viewerName;
  const dateColumn = columns.find((column) => column.key === "date");
  if (dateColumn && "date" in values) {
    values.date = todayForColumn(dateColumn, now, PROVIDER_STAMP_TIME_ZONE);
  }
  return values;
}

/**
 * Đổi giá trị của MỘT ô thành mảnh vá cho cả form.
 *
 * Bật ô Reviewed không chỉ là bật một cờ: nó là hành động xác nhận, nên kéo
 * theo "ai xác nhận" và "xác nhận ngày nào". Bắt người dùng gõ lại hai ô đó mỗi
 * lần thì chắc chắn có dòng đánh dấu đã soát mà không biết ai soát — đúng tình
 * trạng của 99% dòng trong bảng hiện nay.
 *
 * Tắt ô Reviewed thì KHÔNG xoá hai giá trị kia: nhiều dòng mang sẵn tên người
 * soát từ Google Sheet, xoá đi là mất dữ liệu mà người dùng không hề yêu cầu.
 * Nhưng hai ô không còn gõ được, nên tick rồi bỏ tick trong cùng lượt mở form
 * phải trả chúng về như trước khi tick: `unreviewed` là giá trị đó (form Sửa:
 * giá trị đang lưu; form Thêm: trống).
 */
export function providerFieldPatch(
  column: TableColumn,
  value: unknown,
  ctx: {
    columns: readonly TableColumn[];
    viewerName: string;
    now?: Date;
    unreviewed?: ProviderFormValues;
  }
): ProviderFormValues {
  if (!isReviewedColumn(column)) return { [column.key]: value };
  if (value !== true) return { [column.key]: value, ...(ctx.unreviewed ?? {}) };

  const patch: ProviderFormValues = { [column.key]: true };
  const verifiedBy = ctx.columns.find((item) => item.key === "verified_by");
  const dateColumn = ctx.columns.find((item) => item.key === "date");
  if (verifiedBy && !verifiedBy.archived_at && ctx.viewerName) {
    patch.verified_by = ctx.viewerName;
  }
  if (dateColumn && !dateColumn.archived_at) {
    patch.date = todayForColumn(dateColumn, ctx.now ?? new Date(), PROVIDER_STAMP_TIME_ZONE);
  }
  return patch;
}

/**
 * Gom giá trị form thành đúng thân request mà cả POST lẫn PATCH đều nhận.
 *
 * Một hàm cho cả hai form: trước đây form Thêm gửi mọi thứ dưới dạng chuỗi thô
 * còn form Sửa gửi mảng cho ô nhiều lựa chọn, nên cùng một ô Specialty đi hai
 * đường khác nhau tuỳ người dùng bấm nút nào.
 */
export function providerFormPayload(
  values: ProviderFormValues,
  editableColumns: readonly TableColumn[],
  currentCustomValues: Record<string, unknown> = {}
): Record<string, unknown> {
  const systemPatch: Record<string, unknown> = {};
  const customValues: Record<string, unknown> = { ...currentCustomValues };

  for (const column of editableColumns) {
    const value = values[column.key];
    if (isReviewedColumn(column)) {
      systemPatch[column.key] = value !== true;
    } else if (isProviderTextKey(column.key)) {
      systemPatch[column.key] = isNewPatientColumn(column)
        ? value === true
          ? "Yes"
          : "No"
        : isProviderMultiselectColumn(column)
          ? value
          : value === ""
            ? null
            : value;
    } else if (!column.is_system) {
      customValues[column.key] = value === "" ? null : value;
    }
  }

  return { ...systemPatch, custom_values: customValues };
}
