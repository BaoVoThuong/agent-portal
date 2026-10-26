"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ExternalLink, FileSpreadsheet, MapPin, Search } from "lucide-react";
import { useAnchoredMenu } from "../../_components/use-anchored-menu";
import { Initials } from "../../_components/board-ui";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { parseMultiselectValue } from "@/lib/table-config/multiselect";
import { tableColumnOptionBadgePalette } from "@/lib/table-config/value-colors";
import { formatTableDate, formatTableDateTimeFull } from "@/lib/table-config/date-format";
import { formatEmailAsName } from "@/lib/tasks/people";
import { parsePlanCell } from "@/lib/providers/plans";
import {
  US_STATES,
  cityChangePatch,
  placeCities,
  placeZipsForCity,
  stateChangePatch,
  stateZips,
  usStateCode,
  zipChangePatch,
  type AddressParts,
} from "@/lib/providers/us-places";
import { useStatePlaces } from "./use-state-places";
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
  type ProviderFormValues,
} from "@/lib/providers/form";

// Cùng bộ ô với dialog New enrollment (EnrollmentClient: LABEL_CLASS,
// COMPACT_DETAIL_INPUT_CLASS, ô chọn h-9 viền 2px): user 26/10 — các dialog
// trong app phải cùng một kiểu. Bố cục A1 (nhóm, lưới 12 cột) giữ nguyên.
const INPUT_CLASS =
  "h-9 w-full rounded border-2 border-[#dfe1e6] bg-white px-2 py-1.5 text-sm font-semibold text-[#172b4d] outline-none transition placeholder:font-normal placeholder:text-[#97a0af] hover:border-[#c1c7d0] focus:border-[#0c66e4] disabled:cursor-not-allowed disabled:bg-[#f4f5f7] disabled:text-[#6b778c]";
// `h-9` là chiều cao CỐ ĐỊNH, phải ghi đè bằng `!h-auto` thì textarea mới co giãn
// được. min-h-[72px] đủ cho 2 dòng; kéo tay nếu cần thêm.
const TEXTAREA_CLASS = `${INPUT_CLASS} !h-auto min-h-[72px] resize-y py-2 leading-6`;
const LABEL_CLASS = "mb-1 block text-xs font-bold uppercase tracking-wide text-[#6b778c]";
// Ô chọn (Specialty, plan, State / City / ZIP): cùng kiểu ô chọn của New enrollment.
const SELECT_TRIGGER_CLASS =
  "flex w-full items-center justify-between gap-2 rounded-lg border-2 bg-white px-2 text-left text-sm font-semibold outline-none transition disabled:cursor-not-allowed disabled:bg-[#f4f5f7]";
const CHIP_CLASS =
  "max-w-[200px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.02em]";

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
 * Số ô một trường chiếm trong lưới 12 cột (màn rộng). Dưới `md` lưới còn 6 cột:
 * 4–5 ô thành nửa hàng, 7–8 ô thành trọn hàng, nên City · State · ZIP (3+1+2)
 * vẫn chung một hàng trên màn hẹp.
 *
 * Tailwind chỉ giữ được class viết nguyên văn, nên phải liệt kê đủ chứ không
 * ghép chuỗi.
 */
type Span = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 12;
const SPAN_CLASS: Record<Span, string> = {
  1: "col-span-1 md:col-span-1",
  2: "col-span-2 md:col-span-2",
  3: "col-span-3 md:col-span-3",
  4: "col-span-3 md:col-span-4",
  5: "col-span-3 md:col-span-5",
  6: "col-span-6 md:col-span-6",
  7: "col-span-6 md:col-span-7",
  8: "col-span-6 md:col-span-8",
  12: "col-span-6 md:col-span-12",
};

/** Ô gộp hai cờ New Patient + Reviewed thành hai ô tick nằm cạnh nhau. */
const STATUS_CELL = "status";

/**
 * Bố cục A1: ba nhóm (bác sĩ & trạng thái · địa chỉ · plan & giờ làm việc) ngăn
 * bằng đường kẻ mảnh, không khung viền và không tiêu đề cho từng khối. Ô rộng
 * theo nội dung — State/ZIP hẹp, Street rộng — thay vì chia đều.
 *
 * Khoá nào không có ở đây (cột admin tự thêm) VẪN hiện, ở nhóm cuối: admin thêm
 * một cột tuỳ chỉnh mà form nuốt mất là không còn đường nhập giá trị cho nó.
 * Verified by / Verified date không phải ô nhập: hệ thống tự điền, nên chúng
 * nằm ở hàng chỉ-đọc cuối form cùng người tạo (`RecordInfoCells`).
 */
const FORM_GROUPS: readonly (readonly { key: string; span: Span }[])[] = [
  [
    { key: "doctors", span: 4 },
    { key: "facility", span: 5 },
    { key: "npi", span: 3 },
    { key: "phone", span: 3 },
    { key: "practices_as", span: 4 },
    { key: STATUS_CELL, span: 5 },
  ],
  // State đứng trước City: City / ZIP là dropdown lọc theo State, nên chọn
  // State trước là thứ tự người nhập thật sự đi.
  [
    { key: "street", span: 5 },
    { key: "state", span: 2 },
    { key: "city", span: 3 },
    { key: "zip_code", span: 2 },
  ],
  [
    { key: "obamacare", span: 7 },
    { key: "medicare", span: 5 },
    { key: "other_plans", span: 4 },
    { key: "business_hours", span: 8 },
  ],
];

/** Hàng địa chỉ theo thứ tự trên form — link Map đứng ở ô cuối còn hiện. */
const ADDRESS_ROW_KEYS = ["street", "state", "city", "zip_code"];

const LAYOUT_KEYS = new Set([
  ...FORM_GROUPS.flatMap((group) => group.map((cell) => cell.key)),
  "accepting_new_patients",
  "needs_review",
  "verified_by",
  "date",
]);

/** Bề ngang đoán trước cho cột admin tự thêm, khi form không biết trước nó là gì. */
function customFieldSpan(column: TableColumn, value: unknown): Span {
  if (isProviderMultiselectColumn(column)) return 6;
  if (isLongTextColumn(column, value)) return 8;
  if (column.type === "checkbox" || column.type === "date" || column.type === "number") return 3;
  return 4;
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value).trim();
}

/** Ô chỉ-đọc của hàng cuối form, cùng kiểu ô "Opened by" của drawer Task. */
function ReadOnlyCell({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`${SPAN_CLASS[3]} min-w-0`}>
      <span className={LABEL_CLASS}>{label}</span>
      <div
        title={title}
        className="flex h-9 min-w-0 items-center gap-2 rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 text-sm font-medium text-[#172b4d]"
      >
        {children ?? <span className="font-normal text-[#97a0af]">—</span>}
      </div>
    </div>
  );
}

/**
 * Avatar + tên, như ô người của bảng Task. `email` null là tên không khớp tài
 * khoản nào (gõ tay từ Sheet): lấy chính tên làm khoá cho Initials — không ảnh
 * nào mang khoá đó, nên nó vẽ chữ viết tắt với màu cố định theo tên.
 */
function PersonValue({ email, name }: { email: string | null; name: string }) {
  return (
    <>
      <Initials email={email ?? name} label={name} />
      <span className="min-w-0 truncate">{name}</span>
    </>
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
      className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold normal-case tracking-normal text-[#0c66e4] transition hover:underline"
    >
      <MapPin className="h-3 w-3" />
      Map
    </a>
  );
}

/**
 * Thân của cả hai modal provider: cùng lưới, cùng thứ tự, cùng kiểu ô.
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
  people,
  showSystemInfo,
  fromSheet = false,
  hideReview = false,
  disabled = false,
  unreviewedValues,
}: {
  columns: readonly TableColumn[];
  columnOptions: readonly TableColumnOption[];
  values: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  viewerName: string;
  /** Người xem được Provider List — tên + avatar cho Opened by / Verified by. */
  people: readonly TaskAssignee[];
  /** Tắt ở form Thêm: dòng chưa tồn tại thì chưa có người tạo. */
  showSystemInfo: boolean;
  /** Dòng chuyển từ Google Sheet sang: không có người tạo trong portal. */
  fromSheet?: boolean;
  /**
   * Dòng Backlog / form gửi vào Backlog: chưa ai duyệt, nên không có ô Reviewed.
   * Hai ô Verified vẫn hiện trống để người xem biết chưa ai xác nhận.
   */
  hideReview?: boolean;
  /** Chỉ xem: dòng Backlog của người khác, với người không có quyền duyệt. */
  disabled?: boolean;
  /** Verified by / Verified date khi bỏ tick Reviewed — xem `providerFieldPatch`. */
  unreviewedValues?: ProviderFormValues;
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

  // Verified by lưu TÊN ("Ngan Nguyen") chứ không lưu email, nên avatar phải tra
  // ngược tên → tài khoản.
  const directory = useMemo(() => {
    const nameByEmail = new Map<string, string>();
    const emailByName = new Map<string, string>();
    for (const person of people) {
      const name = person.name?.trim();
      if (!name) continue;
      nameByEmail.set(person.email, name);
      emailByName.set(name.toLowerCase(), person.email);
    }
    return { nameByEmail, emailByName };
  }, [people]);

  // State → City → ZIP: chỉ được chọn trong danh sách của Mỹ (user chốt 26/10).
  // Dữ liệu City / ZIP tải theo bang đang chọn.
  const address: AddressParts = {
    state: textValue(values.state),
    city: textValue(values.city),
    zip_code: textValue(values.zip_code),
  };
  const stateCode = usStateCode(address.state);
  const { places, failed: placesFailed } = useStatePlaces(stateCode);
  const cityOptions = useMemo<PlaceOption[]>(
    () => (places ? placeCities(places).map((city) => ({ value: city, label: city })) : []),
    [places]
  );
  const allZips = useMemo(() => (places ? stateZips(places) : []), [places]);
  const zipOptions = useMemo<PlaceOption[]>(() => {
    if (!places) return [];
    const cityZips = new Set(placeZipsForCity(places, address.city));
    // ZIP của City đang chọn lên đầu; các ZIP khác của bang vẫn chọn được ở dưới —
    // ZIP của thành phố gộp (The Woodlands…) chỉ là ước lượng, không được chặn.
    if (cityZips.size === 0) {
      return allZips.map((item) => ({ value: item.zip, label: item.zip, hint: item.city }));
    }
    return [
      ...[...cityZips].sort().map((zip) => ({ value: zip, label: zip, group: address.city })),
      ...allZips
        .filter((item) => !cityZips.has(item.zip))
        .map((item) => ({
          value: item.zip,
          label: item.zip,
          hint: item.city,
          group: `Other ${stateCode} ZIPs`,
        })),
    ];
  }, [places, allZips, address.city, stateCode]);

  const visibleColumns = columns.filter((column) => !column.archived_at);
  const editableColumns = visibleColumns.filter((column) => !isReadOnlyProviderColumn(column));
  const columnsByKey = new Map(editableColumns.map((column) => [column.key, column]));
  const visibleKeys = new Set(visibleColumns.map((column) => column.key));
  const leftoverColumns = editableColumns.filter((column) => !LAYOUT_KEYS.has(column.key));
  const mapQuery = ["street", "city", "state", "zip_code"]
    .map((key) => String(values[key] ?? "").trim())
    .filter(Boolean)
    .join(", ");
  // Link Map đứng ở cuối hàng địa chỉ (user 26/10) — bên phải nhãn của ô địa
  // chỉ cuối cùng còn hiện, thường là ZIP: điền xong cả hàng rồi mới mở bản đồ.
  const addressKeys = ADDRESS_ROW_KEYS.filter((key) => columnsByKey.has(key));
  const mapCellKey = addressKeys[addressKeys.length - 1];
  const mapLink = <MapLink query={mapQuery} />;

  function optionsFor(column: TableColumn): TableColumnOption[] {
    if (isProviderSpecialtyField(column.key)) {
      return specialtyOptions(column, optionsByColumn.get(column.id) ?? []);
    }
    return optionsByColumn.get(column.id) ?? [];
  }

  function handleChange(column: TableColumn, value: unknown) {
    onChange(providerFieldPatch(column, value, { columns, viewerName, unreviewed: unreviewedValues }));
  }

  /** Ô State / City / ZIP là dropdown lọc dây chuyền; ô khác trả null. */
  function renderPlaceField(column: TableColumn): ReactNode {
    if (column.key === "state") {
      return (
        <PlaceSelectField
          label={columnLabel(column, column.key === mapCellKey ? mapLink : undefined)}
          ariaLabel={column.label}
          value={address.state}
          options={STATE_OPTIONS}
          disabled={disabled}
          onChange={(next) => onChange(stateChangePatch(next, address))}
        />
      );
    }
    if (column.key !== "city" && column.key !== "zip_code") return null;
    // Không tải được danh sách thì quay về ô gõ tay, đừng chặn người nhập.
    if (placesFailed) return null;
    const isCity = column.key === "city";
    return (
      <PlaceSelectField
        label={columnLabel(column, column.key === mapCellKey ? mapLink : undefined)}
        ariaLabel={column.label}
        value={isCity ? address.city : address.zip_code}
        options={isCity ? cityOptions : zipOptions}
        disabled={disabled || !stateCode || !places}
        placeholder={!stateCode ? "Pick a state" : !places ? "Loading…" : "—"}
        onChange={(next) =>
          onChange(
            isCity ? cityChangePatch(next, address, places) : zipChangePatch(next, address, places)
          )
        }
      />
    );
  }

  function renderCell(key: string, span: Span): ReactNode {
    if (key === STATUS_CELL) {
      const flagKeys = hideReview ? ["accepting_new_patients"] : ["accepting_new_patients", "needs_review"];
      const flags = flagKeys.flatMap((flagKey) => {
        const column = columnsByKey.get(flagKey);
        return column ? [column] : [];
      });
      // Admin ẩn cả hai cờ thì bỏ luôn ô, đừng để lại một nhãn trống.
      if (flags.length === 0) return null;
      return (
        <div key={STATUS_CELL} className={`${SPAN_CLASS[span]} min-w-0`}>
          <span className={LABEL_CLASS}>Status</span>
          <div className="flex min-h-9 flex-wrap items-center gap-x-5 gap-y-1.5">
            {flags.map((column) => (
              <FlagCheckbox
                key={column.id}
                column={column}
                value={values[column.key]}
                disabled={disabled}
                onChange={(value) => handleChange(column, value)}
              />
            ))}
          </div>
        </div>
      );
    }
    const column = columnsByKey.get(key);
    if (!column) return null;
    const placeField = renderPlaceField(column);
    if (placeField) {
      return (
        <div key={column.id} className={`${SPAN_CLASS[span]} min-w-0`}>
          {placeField}
        </div>
      );
    }
    return (
      <div key={column.id} className={`${SPAN_CLASS[span]} min-w-0`}>
        <ProviderEditField
          column={column}
          value={values[column.key]}
          options={optionsFor(column)}
          disabled={disabled}
          labelAction={key === mapCellKey ? mapLink : undefined}
          onChange={(value) => handleChange(column, value)}
        />
      </div>
    );
  }

  const groups = FORM_GROUPS.map((group) =>
    group.map((cell) => renderCell(cell.key, cell.span)).filter(Boolean)
  );
  if (leftoverColumns.length > 0) {
    groups.push(
      leftoverColumns.map((column) => (
        <div
          key={column.id}
          className={`${SPAN_CLASS[customFieldSpan(column, values[column.key])]} min-w-0`}
        >
          <ProviderEditField
            column={column}
            value={values[column.key]}
            options={optionsFor(column)}
            disabled={disabled}
            onChange={(value) => handleChange(column, value)}
          />
        </div>
      ))
    );
  }

  // Hàng cuối, kiểu ô "Opened by" của drawer Task: ai tạo, ngày nào; ai verify,
  // ngày nào. Không có "Last updated": mọi lần sửa đã nằm ở tab Activity. Mỗi
  // ô vẫn theo cột trong /config — admin xoá cột nào thì ô đó biến mất.
  const labelFor = (key: string, fallback: string) =>
    visibleColumns.find((column) => column.key === key)?.label ?? fallback;
  const recordCells: ReactNode[] = [];
  if (showSystemInfo && visibleKeys.has("created_by_email")) {
    const email = textValue(values.created_by_email).toLowerCase();
    recordCells.push(
      <ReadOnlyCell key="created_by_email" label={labelFor("created_by_email", "Opened by")}>
        {email ? (
          <PersonValue
            email={email}
            name={directory.nameByEmail.get(email) ?? formatEmailAsName(email)}
          />
        ) : fromSheet ? (
          <>
            <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#626f86]" />
            <span className="min-w-0 truncate">Google Sheet</span>
          </>
        ) : null}
      </ReadOnlyCell>
    );
  }
  if (showSystemInfo && visibleKeys.has("created_at")) {
    const createdAt = textValue(values.created_at);
    recordCells.push(
      <ReadOnlyCell
        key="created_at"
        label={labelFor("created_at", "Created date")}
        title={createdAt ? formatTableDateTimeFull(createdAt) : undefined}
      >
        {createdAt ? formatTableDate(createdAt) : null}
      </ReadOnlyCell>
    );
  }
  if (visibleKeys.has("verified_by")) {
    const name = textValue(values.verified_by);
    recordCells.push(
      <ReadOnlyCell key="verified_by" label={labelFor("verified_by", "Verified by")}>
        {name ? (
          <PersonValue email={directory.emailByName.get(name.toLowerCase()) ?? null} name={name} />
        ) : null}
      </ReadOnlyCell>
    );
  }
  if (visibleKeys.has("date")) {
    const verifiedOn = textValue(values.date);
    recordCells.push(
      <ReadOnlyCell key="date" label={labelFor("date", "Verified date")}>
        {verifiedOn || null}
      </ReadOnlyCell>
    );
  }
  groups.push(recordCells);

  // Admin ẩn hết cột của một nhóm thì bỏ luôn nhóm đó, kể cả đường kẻ của nó.
  const filledGroups = groups.filter((cells) => cells.length > 0);

  return (
    <div className="grid grid-cols-6 gap-3 md:grid-cols-12">
      {filledGroups.map((cells, index) => (
        <Fragment key={index}>
          {index > 0 ? (
            <div aria-hidden="true" className="col-span-6 my-0.5 border-t border-[#dfe1e6] md:col-span-12" />
          ) : null}
          {cells}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * New Patient / Reviewed: một ô tick thường (UI kiểu Task: ô tick hơn toggle).
 * Ô Reviewed trên form ngược nghĩa với cột `needs_review` — `providerFormValues`
 * đã đảo sẵn, ở đây chỉ đọc đúng giá trị form.
 */
function FlagCheckbox({
  column,
  value,
  disabled = false,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  const checked = isReviewedColumn(column)
    ? value === true
    : value === true || isTruthyProviderValue(value);
  return (
    <label
      className={`inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium text-[#172b4d] ${
        disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 cursor-pointer accent-[#0c66e4] disabled:cursor-not-allowed"
      />
      {column.label}
      {column.required ? <span className="text-[#bf2600]">*</span> : null}
    </label>
  );
}

/** Nhãn của một ô: tên cột, dấu * khi bắt buộc, và thứ đứng bên phải (link Map). */
function columnLabel(column: TableColumn, labelAction?: ReactNode): ReactNode {
  const labelText = (
    <>
      {column.label}
      {column.required ? <span className="text-[#bf2600]"> *</span> : null}
    </>
  );
  return labelAction ? (
    <span className="mb-1 flex items-center justify-between gap-2">
      <span className="text-xs font-bold uppercase tracking-wide text-[#6b778c]">{labelText}</span>
      {labelAction}
    </span>
  ) : (
    <span className={LABEL_CLASS}>{labelText}</span>
  );
}

function ProviderEditField({
  column,
  value,
  options,
  disabled = false,
  labelAction,
  onChange,
}: {
  column: TableColumn;
  value: unknown;
  options: readonly TableColumnOption[];
  disabled?: boolean;
  /** Thứ nằm bên phải nhãn, như link Map ở ô cuối hàng địa chỉ. */
  labelAction?: ReactNode;
  onChange: (value: unknown) => void;
}) {
  const label = columnLabel(column, labelAction);

  if (isNewPatientColumn(column) || isReviewedColumn(column) || column.type === "checkbox") {
    return (
      <div>
        <span className={LABEL_CLASS} aria-hidden="true">&nbsp;</span>
        <div className="flex min-h-9 items-center">
          <FlagCheckbox column={column} value={value} disabled={disabled} onChange={onChange} />
        </div>
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
        ariaLabel={column.label}
        selected={selected}
        options={options}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (column.type === "dropdown") {
    return (
      <label className="block min-w-0">
        {label}
        <select
          autoComplete="off"
          className={INPUT_CLASS}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
        >
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
          autoComplete="new-password"
          rows={2}
          className={TEXTAREA_CLASS}
          disabled={disabled}
          value={stringValue}
          onChange={(event) => onChange(event.target.value)}
          placeholder="—"
        />
      ) : (
        <div className="flex items-center gap-1.5">
          <input
            autoComplete="new-password"
            className={INPUT_CLASS}
            disabled={disabled}
            type={column.type === "number" ? "number" : column.type === "date" ? "date" : column.type === "link" ? "url" : "text"}
            value={stringValue}
            onChange={(event) => onChange(event.target.value)}
            placeholder="—"
          />
          {column.type === "link" && stringValue ? (
            <a
              href={/^https?:\/\//i.test(stringValue) ? stringValue : `https://${stringValue}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded border-2 border-[#b3d4ff] bg-[#deebff] text-[#0055cc] transition hover:bg-[#cce0ff]"
              aria-label={`Open ${column.label}`}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      )}
    </label>
  );
}

function MultiSelectField({
  label,
  ariaLabel,
  selected,
  options,
  disabled = false,
  onChange,
}: {
  label: ReactNode;
  ariaLabel: string;
  selected: string[];
  options: readonly TableColumnOption[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  // Menu vẽ ra document.body với toạ độ fixed (portal). Để `absolute` trong vùng
  // cuộn của dialog thì ô nằm sát đáy — ACA/Medicare Plans — bị footer cắt mất
  // nửa danh sách. Hook tự lật menu lên trên khi bên dưới không đủ chỗ, và lo
  // luôn bấm ra ngoài / Escape / cuộn trang.
  const { isOpen: open, toggle, triggerRef, menuRef, menuStyle } = useAnchoredMenu({
    estimatedHeight: 330,
  });
  const selectedSet = new Set(selected.map((item) => item.toLowerCase()));

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.label.toLowerCase().includes(normalizedQuery));
  }, [options, query]);

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
    <div className="relative min-w-0">
      {label}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${selected.length > 0 ? selected.join(", ") : "none"}`}
        onClick={toggle}
        disabled={disabled}
        className={`${SELECT_TRIGGER_CLASS} min-h-9 py-1 ${
          open ? "border-[#0c66e4]" : "border-[#dfe1e6] hover:border-[#c1c7d0]"
        }`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {selected.length === 0 ? (
            <span className="font-normal text-[#97a0af]">—</span>
          ) : (
            <>
              {selected.slice(0, 3).map((item) => (
                <span key={item} className={CHIP_CLASS} style={chipStyle(item)}>
                  {item}
                </span>
              ))}
              {selected.length > 3 ? (
                <span className="rounded bg-[#f1f2f4] px-1.5 py-0.5 text-[10.5px] font-bold text-[#44546f]">
                  +{selected.length - 3}
                </span>
              ) : null}
            </>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#626f86] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? createPortal(
        // z trên dialog Provider (z-[180]); rộng đúng bằng ô.
        <div
          ref={menuRef}
          style={{ ...menuStyle, width: menuStyle.minWidth }}
          className="z-[200] flex flex-col overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_12px_32px_rgba(9,30,66,0.18)]"
        >
          <div className="border-b border-[#edf0f4] p-1.5">
            <div className="flex h-8 items-center gap-2 rounded-md bg-[#f7f8f9] px-2">
              <Search className="h-3.5 w-3.5 text-[#8590a2]" />
              <input
                autoFocus
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search…"
                className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none placeholder:text-[#8590a2]"
              />
            </div>
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-56 overflow-y-auto p-1">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-[#626f86]">No matching values</p>
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
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
                      checked ? "bg-[#e9f2ff]" : "hover:bg-[#f7f8f9]"
                    }`}
                  >
                    <span
                      className={`flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded border ${
                        checked ? "border-[#0c66e4] bg-[#0c66e4] text-white" : "border-[#c7d1e0] bg-white"
                      }`}
                    >
                      {checked ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span
                      className={CHIP_CLASS}
                      style={{ backgroundColor: palette.background, color: palette.foreground }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>
          {/* "N selected · Clear" nằm trong menu thay vì một dòng riêng dưới ô:
              dòng đó cộng thêm chiều cao cho mọi ô nhiều lựa chọn của form. */}
          <div className="flex items-center justify-between border-t border-[#edf0f4] bg-[#fafbfc] px-2.5 py-1.5 text-xs text-[#626f86]">
            <span>{selected.length} selected</span>
            {selected.length > 0 ? (
              <button
                type="button"
                className="font-semibold text-[#0c66e4] hover:underline"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

type PlaceOption = { value: string; label: string; hint?: string; group?: string };

const STATE_OPTIONS: PlaceOption[] = US_STATES.map((state) => ({
  value: state.code,
  label: state.code,
  hint: state.name,
}));

/** TX có ~2.600 ZIP: vẽ hết một lần là cả nghìn nút DOM cho một menu. Gõ để lọc. */
const PLACE_RENDER_LIMIT = 200;

/**
 * Dropdown chọn MỘT giá trị trong danh sách có sẵn (State / City / ZIP), có ô
 * tìm. Không gõ được giá trị ngoài danh sách. Giá trị cũ không có trong danh
 * sách (dữ liệu chuyển từ Sheet) vẫn hiện nguyên trên ô cho tới khi chọn lại.
 */
function PlaceSelectField({
  label,
  ariaLabel,
  value,
  options,
  disabled = false,
  placeholder = "—",
  onChange,
}: {
  label: ReactNode;
  ariaLabel: string;
  value: string;
  options: readonly PlaceOption[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const { isOpen: open, toggle, triggerRef, menuRef, menuStyle, closeMenu } = useAnchoredMenu({
    estimatedHeight: 330,
  });

  const filtered = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(wanted) || option.hint?.toLowerCase().includes(wanted)
    );
  }, [options, query]);
  const visible = filtered.slice(0, PLACE_RENDER_LIMIT);

  function choose(next: string) {
    onChange(next);
    setQuery("");
    setActive(0);
    closeMenu();
  }

  function moveActive(next: number) {
    const index = Math.max(0, Math.min(next, visible.length - 1));
    setActive(index);
    menuRef.current
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }

  return (
    <div className="relative min-w-0">
      {label}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${ariaLabel}: ${value || "none"}`}
        onClick={toggle}
        disabled={disabled}
        className={`${SELECT_TRIGGER_CLASS} h-9 ${
          open ? "border-[#0c66e4]" : "border-[#dfe1e6] hover:border-[#c1c7d0]"
        }`}
      >
        <span className={`min-w-0 truncate ${value ? "text-[#172b4d]" : "font-normal text-[#97a0af]"}`}>
          {value || placeholder}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[#626f86] transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? createPortal(
        // z trên dialog Provider (z-[180]). Ô State hẹp nên menu rộng tối thiểu
        // 240px — đủ cho "TX · Texas" và ô tìm.
        <div
          ref={menuRef}
          style={{ ...menuStyle, minWidth: Math.max(Number(menuStyle.minWidth) || 0, 240) }}
          className="z-[200] flex flex-col overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_12px_32px_rgba(9,30,66,0.18)]"
        >
          <div className="border-b border-[#edf0f4] p-1.5">
            <div className="flex h-8 items-center gap-2 rounded-md bg-[#f7f8f9] px-2">
              <Search className="h-3.5 w-3.5 text-[#8590a2]" />
              <input
                autoFocus
                autoComplete="off"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    moveActive(active + 1);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    moveActive(active - 1);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const option = visible[active];
                    if (option) choose(option.value);
                  }
                }}
                placeholder="Search…"
                aria-label={`Search ${ariaLabel}`}
                className="min-w-0 flex-1 bg-transparent text-sm text-[#172b4d] outline-none placeholder:text-[#8590a2]"
              />
            </div>
          </div>
          <div role="listbox" aria-label={ariaLabel} className="max-h-60 overflow-y-auto p-1">
            {visible.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-[#626f86]">No matching values</p>
            ) : (
              visible.map((option, index) => {
                const selected = option.value.toLowerCase() === value.trim().toLowerCase();
                const groupHeader =
                  option.group && option.group !== visible[index - 1]?.group ? option.group : null;
                return (
                  <Fragment key={`${option.group ?? ""}:${option.value}`}>
                    {groupHeader ? (
                      <p className="px-2 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[#8590a2]">
                        {groupHeader}
                      </p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      data-index={index}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option.value)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                        index === active ? "bg-[#f1f2f4]" : ""
                      } ${selected ? "font-semibold text-[#0c66e4]" : "text-[#172b4d]"}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {option.hint ? (
                        <span className="shrink-0 truncate text-xs text-[#8590a2]">{option.hint}</span>
                      ) : null}
                      {selected ? <Check className="h-3.5 w-3.5 shrink-0" /> : null}
                    </button>
                  </Fragment>
                );
              })
            )}
          </div>
          <div className="flex items-center justify-between border-t border-[#edf0f4] bg-[#fafbfc] px-2.5 py-1.5 text-xs text-[#626f86]">
            <span>
              {filtered.length > visible.length
                ? `${visible.length} of ${filtered.length} — type to narrow`
                : `${filtered.length} values`}
            </span>
            {value ? (
              <button
                type="button"
                className="font-semibold text-[#0c66e4] hover:underline"
                onClick={() => choose("")}
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}
