"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ExternalLink, MapPin, Search } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { parseMultiselectValue } from "@/lib/table-config/multiselect";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { parsePlanCell } from "@/lib/providers/plans";
import {
  parseSpecialtyCell,
  PROVIDER_SPECIALTY_OPTIONS,
  isProviderSpecialtyField,
} from "@/lib/providers/specialties";
import {
  isNewPatientColumn,
  isProviderMultiselectColumn,
  isProviderPlanColumn,
  isReadOnlyProviderColumn,
  isReviewedColumn,
  isTruthyProviderValue,
  providerFieldPatch,
} from "@/lib/providers/form";

// Bám đúng TaskDetailDrawer (CUSTOM_FIELD_INPUT_CLASS + LABEL_CLASS) để hai
// modal của cùng một sản phẩm không trông như hai sản phẩm: viền 2px #dfe1e6,
// rê chuột đổi sang #c1c7d0, focus chỉ đổi màu viền chứ KHÔNG bật vòng sáng.
const INPUT_CLASS =
  "h-9 w-full rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
// `h-9` của INPUT_CLASS là chiều cao CỐ ĐỊNH, phải ghi đè bằng `!h-auto` thì
// textarea mới co giãn được. min-h-16 đủ cho 2 dòng; kéo tay nếu cần thêm.
const TEXTAREA_CLASS = `${INPUT_CLASS} !h-auto min-h-16 resize-y py-2`;
const LABEL_CLASS = "mb-1 block text-xs font-bold uppercase tracking-wide text-[#6b778c]";

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function isLongTextColumn(column: TableColumn, value: unknown): boolean {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return column.key === "business_hours" || stringValue.length > 120;
}

function specialtyOptions(column: TableColumn, options: readonly TableColumnOption[]) {
  const byLabel = new Map(options.map((option) => [option.label.toLowerCase(), option]));
  return PROVIDER_SPECIALTY_OPTIONS.map(
    (label, index) =>
      byLabel.get(label.toLowerCase()) ?? {
        id: `provider-specialty-${index}`,
        column_id: column.id,
        label,
        color: null,
        position: (index + 1) * 10,
        archived_at: null,
      }
  );
}

/**
 * Bề ngang của một cột KHÔNG nằm trong bố cục nhóm bên dưới — tức cột tuỳ chỉnh
 * do admin thêm. Những cột đó rơi vào khối "Other details" dùng lưới 6 ô, và
 * đây là cách đoán độ rộng hợp lý cho chúng khi form không biết trước là gì.
 */
function editFieldSpan(column: TableColumn, value: unknown): 1 | 2 | 4 | 6 {
  if (isProviderPlanColumn(column.key)) return 6;
  if (isProviderMultiselectColumn(column)) return isProviderSpecialtyField(column.key) ? 4 : 6;
  if (column.key === "business_hours") return 2;
  if (isLongTextColumn(column, value)) return 6;
  if (column.type === "checkbox" || isNewPatientColumn(column) || isReviewedColumn(column)) return 2;
  if (column.key === "state" || column.key === "zip_code") return 1;
  return 2;
}

// Tailwind chỉ giữ được class viết nguyên văn, nên phải liệt kê đủ chứ không
// ghép chuỗi. Dưới `md` lưới chỉ có 2 cột và mọi ô đều trải hết chiều ngang.
const SPAN_CLASS: Record<1 | 2 | 4 | 6, string> = {
  1: "col-span-2 min-w-0 md:col-span-1",
  2: "col-span-2 min-w-0 md:col-span-2",
  4: "col-span-2 min-w-0 md:col-span-4",
  6: "col-span-2 min-w-0 md:col-span-6",
};

/**
 * Bố cục nhóm của form sửa.
 *
 * Bản trước đổ MỌI cột vào một lưới 6 ô duy nhất theo đúng thứ tự trong cấu
 * hình cột: không sai dữ liệu, nhưng không nói lên quan hệ nào — `street` đứng
 * cạnh `phone` chỉ vì hai khoá đó liền nhau trong bảng cấu hình. Gom theo việc
 * người dùng đang làm (sửa địa chỉ / sửa plan / bật cờ) thì mắt nhảy thẳng tới
 * đúng khối thay vì phải quét cả form.
 *
 * `fields` là map khoá cột → số ô nó chiếm trong lưới `cols` của khối. Khoá nào
 * không có mặt ở đây thì cột đó VẪN hiện, trong khối "Other details" ở cuối:
 * admin thêm một cột tuỳ chỉnh mà form nuốt mất là không còn đường nhập giá trị
 * cho nó.
 */
type PanelSpec = {
  id: string;
  title: string;
  /** Số cột của lưới bên trong khối. */
  cols: 1 | 2 | 4 | 6;
  /** Bề ngang của khối trong hàng 3 cột: 1 = một phần ba, 3 = trọn hàng. */
  width: 1 | 2 | 3;
  fields: Record<string, number>;
};

const PANEL_LAYOUT: readonly (readonly PanelSpec[])[] = [
  [
    {
      id: "details",
      title: "Provider details",
      cols: 4,
      width: 3,
      fields: { doctors: 1, facility: 1, npi: 1, phone: 1 },
    },
  ],
  [
    {
      id: "status",
      title: "Status & specialty",
      cols: 2,
      width: 1,
      fields: { accepting_new_patients: 1, needs_review: 1, practices_as: 2 },
    },
    {
      id: "location",
      title: "Location",
      cols: 4,
      width: 2,
      fields: { street: 4, city: 2, state: 1, zip_code: 1 },
    },
  ],
  [
    {
      id: "hours",
      title: "Business hours",
      cols: 1,
      width: 1,
      fields: { business_hours: 1 },
    },
    {
      id: "plans",
      title: "Plans",
      cols: 6,
      width: 2,
      fields: { obamacare: 3, medicare: 3, other_plans: 2, verified_by: 2, date: 2 },
    },
  ],
];

const PANEL_KEYS = new Set(
  PANEL_LAYOUT.flatMap((row) => row.flatMap((panel) => Object.keys(panel.fields)))
);

// Tailwind chỉ giữ được class viết nguyên văn nên phải liệt kê sẵn từng cặp
// (số cột của khối)-(số ô trường chiếm). Dưới `md` mọi lưới rút về 2 cột.
const PANEL_GRID_CLASS: Record<1 | 2 | 4 | 6, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  4: "grid-cols-2 md:grid-cols-4",
  6: "grid-cols-2 md:grid-cols-6",
};

const CELL_CLASS: Record<string, string> = {
  "1-1": "col-span-1 min-w-0",
  "2-1": "col-span-1 min-w-0",
  "2-2": "col-span-2 min-w-0",
  "4-1": "col-span-2 min-w-0 md:col-span-1",
  "4-2": "col-span-2 min-w-0",
  "4-4": "col-span-2 min-w-0 md:col-span-4",
  "6-2": "col-span-2 min-w-0",
  "6-3": "col-span-2 min-w-0 md:col-span-3",
  "6-6": "col-span-2 min-w-0 md:col-span-6",
};

const PANEL_WIDTH_CLASS: Record<1 | 2 | 3, string> = {
  1: "md:col-span-1",
  2: "md:col-span-2",
  3: "md:col-span-3",
};

/**
 * Khối trắng có viền mảnh. Ảnh mẫu tô nền xám nhạt cho từng khối; ở đây giữ nền
 * TRẮNG theo yêu cầu, nên viền là thứ duy nhất phân định khối — bỏ viền đi thì
 * ba khối liền nhau dính thành một mảng chữ.
 */
function Panel({
  title,
  action,
  className,
  children,
}: {
  title: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`rounded-xl border border-[#dfe1e6] bg-white p-3 ${className ?? ""}`}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-[#172b4d]">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Mở đúng địa chỉ đang gõ trên Google Maps. Chỉ là một đường dẫn tìm kiếm, KHÔNG
 * gọi API nào — người sửa địa chỉ hay cần kiểm tra xem số nhà đó có thật không.
 */
function MapLink({ query }: { query: string }) {
  if (!query) return null;
  return (
    <a
      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-[#0c66e4] transition hover:underline"
    >
      <MapPin className="h-3.5 w-3.5" />
      Map view
    </a>
  );
}


/**
 * Thân của cả hai modal provider: cùng khối, cùng thứ tự, cùng kiểu ô.
 *
 * `onChange` nhận một MẢNH VÁ chứ không phải một cặp khoá/giá trị, vì một cú
 * bấm có thể đổi nhiều ô cùng lúc — xem `providerFieldPatch`.
 */
export function ProviderFormBody({
  columns,
  columnOptions,
  values,
  onChange,
  viewerName,
  showSystemInfo,
}: {
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  viewerName: string;
  /** Tắt ở form Thêm: dòng chưa tồn tại thì chưa có ai tạo và chưa có lần sửa nào. */
  showSystemInfo: boolean;
}) {
  const optionsByColumn = useMemo(() => {
    const map = new Map<string, TableColumnOption[]>();
    for (const option of columnOptions) {
      const list = map.get(option.column_id) ?? [];
      list.push(option);
      map.set(option.column_id, list);
    }
    return map;
  }, [columnOptions]);

  const editableColumns = columns.filter(
    (column) => !column.archived_at && !isReadOnlyProviderColumn(column)
  );
  const readOnlyColumns = columns.filter(
    (column) => !column.archived_at && isReadOnlyProviderColumn(column)
  );
  const columnsByKey = new Map(editableColumns.map((column) => [column.key, column]));
  // Cột admin tự thêm: không nằm trong bố cục nhóm nên phải có chỗ chứa riêng,
  // nếu không giá trị của chúng thành không sửa được từ form này.
  const leftoverColumns = editableColumns.filter((column) => !PANEL_KEYS.has(column.key));
  const mapQuery = ["street", "city", "state", "zip_code"]
    .map((key) => String(values[key] ?? "").trim())
    .filter(Boolean)
    .join(", ");

  function optionsFor(column: TableColumn): TableColumnOption[] {
    if (isProviderSpecialtyField(column.key)) {
      return specialtyOptions(column, optionsByColumn.get(column.id) ?? []);
    }
    return optionsByColumn.get(column.id) ?? [];
  }

  function handleChange(column: TableColumn, value: unknown) {
    onChange(providerFieldPatch(column, value, { columns, viewerName }));
  }

  function field(column: TableColumn) {
    return (
      <ProviderEditField
        column={column}
        value={values[column.key]}
        options={optionsFor(column)}
        onChange={(value) => handleChange(column, value)}
      />
    );
  }

  function renderPanel(panel: PanelSpec) {
    const entries = Object.entries(panel.fields).flatMap(([key, span]) => {
      const column = columnsByKey.get(key);
      return column ? [{ column, span }] : [];
    });
    // Admin ẩn/xoá hết cột của một khối thì bỏ luôn khối đó, đừng để lại một cái
    // tiêu đề trống.
    if (entries.length === 0) return null;
    return (
      <Panel
        key={panel.id}
        title={panel.title}
        className={PANEL_WIDTH_CLASS[panel.width]}
        action={panel.id === "location" ? <MapLink query={mapQuery} /> : undefined}
      >
        <div className={`grid gap-x-3 gap-y-2.5 ${PANEL_GRID_CLASS[panel.cols]}`}>
          {entries.map(({ column, span }) => (
            <div
              key={column.id}
              className={CELL_CLASS[`${panel.cols}-${span}`] ?? "col-span-2 min-w-0"}
            >
              {field(column)}
            </div>
          ))}
        </div>
      </Panel>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-3">
      {PANEL_LAYOUT.map((row) => {
        const panels = row.map(renderPanel);
        if (panels.every((panel) => panel === null)) return null;
        return (
          <div key={row[0].id} className="grid gap-3 md:grid-cols-3">
            {panels}
          </div>
        );
      })}

      {leftoverColumns.length > 0 ? (
        <Panel title="Other details">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 md:grid-cols-6">
            {leftoverColumns.map((column) => (
              <div
                key={column.id}
                className={SPAN_CLASS[editFieldSpan(column, values[column.key])]}
              >
                {field(column)}
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {showSystemInfo && readOnlyColumns.length > 0 ? (
        <Panel title="System information">
          {/* Nhãn trái, giá trị phải trên cùng một dòng: bốn ô chỉ-đọc mà dựng
              thành bốn thẻ như ô nhập thì trông như còn sửa được. */}
          <dl className="grid gap-x-10 gap-y-0 sm:grid-cols-2">
            {readOnlyColumns.map((column) => (
              <div
                key={column.id}
                className="flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed border-[#ebecf0] py-1.5 last:border-b-0"
              >
                <dt className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                  {column.label}
                </dt>
                <dd
                  className="min-w-0 truncate text-xs font-semibold text-[#5e6c84]"
                  title={displayValue(values[column.key])}
                >
                  {displayValue(values[column.key])}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      ) : null}
    </div>
  );
}

function ProviderEditField({
  column,
  value,
  options,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  onChange: (value: unknown) => void;
}) {
  const label = (
    <span className={LABEL_CLASS}>
      {isNewPatientColumn(column)
        ? "New Patient"
        : isReviewedColumn(column)
          ? "Reviewed"
          : column.label}
      {column.required ? <span className="text-[#bf2600]"> *</span> : null}
    </span>
  );

  if (isNewPatientColumn(column) || isReviewedColumn(column)) {
    const checked = isReviewedColumn(column)
      ? value === true
      : value === true || isTruthyProviderValue(value);
    const toggleLabel = isReviewedColumn(column)
      ? "Record has been checked"
      : "Accepting new patients";
    return (
      <div>
        {label}
        {/* Chỉ một ô tick. Bản cũ là nút to chiếm trọn chiều ngang, kèm câu mô
            tả và huy hiệu Yes/No — ba cách nói cùng một giá trị đúng/sai, và
            chiếm chỗ ngang bằng một ô nhập chữ. Nhãn cột ở trên đã nói rõ đây
            là trường gì. */}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => onChange(!checked)}
          className={`flex h-9 w-full items-center justify-center rounded-lg border-2 transition focus:outline-none focus:border-[#0c66e4] ${
            checked
              ? "border-[#b7e4d0] bg-[#f0fbf5]"
              : "border-[#dfe1e6] bg-white hover:border-[#c1c7d0]"
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
              checked
                ? "border-[#16a66a] bg-[#16a66a] text-white"
                : "border-[#c7d1e0] bg-white"
            }`}
          >
            {checked ? <Check className="h-3.5 w-3.5" /> : null}
          </span>
        </button>
      </div>
    );
  }

  if (isProviderMultiselectColumn(column)) {
    const selected = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : isProviderSpecialtyField(column.key)
        ? parseSpecialtyCell(value)
        : isProviderPlanColumn(column.key)
          ? parsePlanCell(value as string | null)
          : parseMultiselectValue(value);
    return (
      <MultiSelectField
        label={label}
        selected={selected}
        options={options}
        onChange={onChange}
      />
    );
  }

  if (column.type === "checkbox") {
    return (
      <label className="flex h-9 items-center gap-2 rounded-lg border-2 border-[#dfe1e6] bg-white px-2 text-sm font-semibold text-[#172b4d]">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
        />
        {column.label}
      </label>
    );
  }

  if (column.type === "dropdown") {
    return (
      <label className="block min-w-0">
        {label}
        <select className={INPUT_CLASS} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose {column.label.toLowerCase()}</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
    );
  }

  const stringValue = value === null || value === undefined ? "" : String(value);
  const isLongText = isLongTextColumn(column, value);
  return (
    <label className="block min-w-0">
      {label}
      {isLongText ? (
        <textarea
          className={TEXTAREA_CLASS}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder={`Enter ${column.label.toLowerCase()}`}
        />
      ) : (
        <div className="flex items-center gap-2">
          <input
            className={INPUT_CLASS}
            type={column.type === "number" ? "number" : column.type === "date" ? "date" : column.type === "link" ? "url" : "text"}
            value={stringValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder={`Enter ${column.label.toLowerCase()}`}
          />
          {column.type === "link" && stringValue ? (
            <a
              href={/^https?:\/\//i.test(stringValue) ? stringValue : `https://${stringValue}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#b3d4ff] bg-[#deebff] text-[#0055cc] transition hover:bg-[#cce0ff]"
              aria-label={`Open ${column.label}`}
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      )}
    </label>
  );
}

function MultiSelectField({
  label,
  selected,
  options,
  onChange,
}: {
  label: ReactNode;
  selected: string[];
  options: readonly TableColumnOption[];
  onChange: (value: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedSet = new Set(selected.map((item) => item.toLowerCase()));

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function toggleOption(option: TableColumnOption) {
    const normalizedLabel = option.label.toLowerCase();
    onChange(
      selectedSet.has(normalizedLabel)
        ? selected.filter((item) => item.toLowerCase() !== normalizedLabel)
        : [...selected, option.label]
    );
  }

  function chipStyle(value: string) {
    const option = options.find((item) => item.label.toLowerCase() === value.toLowerCase());
    if (!option) return { backgroundColor: "#eef2f6", color: "#475467" };
    const palette = tableColumnOptionBadgePalette(option);
    return { backgroundColor: palette.background, color: palette.foreground };
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      {label}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-lg border-2 bg-white px-2 py-1.5 text-left outline-none transition ${
          open ? "border-[#0c66e4]" : "border-[#dfe1e6] hover:border-[#c1c7d0]"
        }`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {selected.length === 0 ? (
            <span className="text-sm font-medium text-[#98a2b3]">Choose values</span>
          ) : (
            <>
              {selected.slice(0, 3).map((item) => (
                <span
                  key={item}
                  className="max-w-[220px] truncate rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em]"
                  style={chipStyle(item)}
                >
                  {item}
                </span>
              ))}
              {selected.length > 3 ? (
                <span className="rounded-md bg-[#f2f4f7] px-2 py-1 text-[10px] font-bold text-[#667085]">
                  +{selected.length - 3} more
                </span>
              ) : null}
            </>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-[#667085] transition ${open ? "rotate-180" : ""}`} />
      </button>
      <div className="mt-0.5 flex items-center justify-between text-[10px] font-medium text-[#7a869a]">
        <span>{selected.length} selected</span>
        {selected.length > 0 ? (
          <button type="button" className="font-bold text-[#0c66e4] hover:underline" onClick={() => onChange([])}>
            Clear
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+28px)] z-50 overflow-hidden rounded-xl border border-[#dfe1e6] bg-white shadow-[0_14px_36px_rgba(9,30,66,0.18)]">
          <div className="border-b border-[#edf0f4] p-2">
            <div className="flex h-9 items-center gap-2 rounded-lg bg-[#f7f9fc] px-2.5">
              <Search className="h-4 w-4 text-[#98a2b3]" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search values..."
                className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none placeholder:text-[#98a2b3]"
              />
            </div>
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto p-1.5">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-[#7a869a]">No matching values</p>
            ) : (
              filteredOptions.map((option) => {
                const checked = selectedSet.has(option.label.toLowerCase());
                const palette = tableColumnOptionBadgePalette(option);
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggleOption(option)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                      checked ? "bg-[#edf4ff]" : "hover:bg-[#f7f9fc]"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-[#0c66e4] bg-[#0c66e4] text-white" : "border-[#c7d1e0] bg-white"
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span
                      className="truncate rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em]"
                      style={{ backgroundColor: palette.background, color: palette.foreground }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-[#edf0f4] bg-[#fbfcfe] px-3 py-2 text-[11px] text-[#667085]">
            Select one or more values
          </div>
        </div>
      ) : null}
    </div>
  );
}
