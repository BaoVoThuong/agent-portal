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
        // Ô trên form là "Reviewed", cột trong bảng là "needs_review" — ngược nhau.
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
export function todayForColumn(column: TableColumn | undefined, now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  if (column?.type === "date") return `${now.getFullYear()}-${month}-${day}`;
  return `${month}/${day}/${now.getFullYear()}`;
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
  if (dateColumn && "date" in values) values.date = todayForColumn(dateColumn, now);
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
 */
export function providerFieldPatch(
  column: TableColumn,
  value: unknown,
  ctx: { columns: readonly TableColumn[]; viewerName: string; now?: Date }
): ProviderFormValues {
  if (!isReviewedColumn(column) || value !== true) return { [column.key]: value };

  const patch: ProviderFormValues = { [column.key]: true };
  const verifiedBy = ctx.columns.find((item) => item.key === "verified_by");
  const dateColumn = ctx.columns.find((item) => item.key === "date");
  if (verifiedBy && !verifiedBy.archived_at && ctx.viewerName) {
    patch.verified_by = ctx.viewerName;
  }
  if (dateColumn && !dateColumn.archived_at) {
    patch.date = todayForColumn(dateColumn, ctx.now ?? new Date());
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
