# Plan: Gộp Dropdown Values (Custom + Category + Option Sets) về `/config`

Ngày: 2026-08-03 · Branch: `config` · Người code: TBD (đọc kỹ trước khi chọn tay/tự động)

> Plan **self-contained**. Quyết định gốc: `docs/superpowers/specs/2026-08-03-consolidate-dropdown-values-design.md`
> (đã qua review đối kháng 2-agent, mục "Kết quả review đối kháng" + "Quyết định kiến trúc (ĐÃ CHỐT)").
> Q1 + Q2 trong spec: user chọn **(a) sửa luôn cả 2** bug có sẵn (Consent 2-value guard, category broadcast).

---

## 0. Scope & Non-goals

**Kiến trúc đã chốt (không phải "1 picker chung" — đã bị bác bỏ sau debate):**
- **KHÔNG** migrate schema (`task_categories`, `enrollment_option_sets`, `enrollment_options` giữ nguyên 100%).
- **KHÔNG** đổi RBAC (`isManager` đã nhất quán, verify độc lập 2 lần).
- **2 khối** trong tab "Dropdown Values" của `/config`:
  - Khối 1: `ConfigValueSection` mở rộng — gộp Custom dropdown + CS Category (2 shape giống nhau: label+color+archive), **nâng cấp thêm** màu+sửa-tên-inline cho Custom (đóng lỗ hổng tính năng, API đã hỗ trợ sẵn PATCH label+color).
  - Khối 2: `ConfigOptionSetSection` (component mới) — port gần như nguyên vẹn `OptionSetManager`, giữ đủ 2-pane nav, inline edit, checkbox Terminal/QC, và **bắt buộc giữ** cảnh báo archive theo usage-count.
- Loại **CS Status/Priority** khỏi mọi danh sách (dropdown system nhưng hardcode enum, không có nơi lưu).
- Kèm 2 fix nhân tiện (đã chốt làm): Consent 2-value guard (Q1), category broadcast realtime (Q2).
- Xoá UI setup cũ khỏi `/tasks` (nút Categories + `CategoryManager`) và `/enrollment` (nút Option sets + `OptionSetManager`).

---

## 1. Bối cảnh code hiện tại (đã đọc + verify từng dòng, không suy đoán)

### 1.1 `ConfigValueSection` hiện tại (`ConfigClient.tsx:789-~890`)
```ts
function ConfigValueSection({ scope, columns, options, busy, run, refreshScope }: {...}) {
  const dropdownColumns = columns.filter(
    (column) => column.type === "dropdown" && !column.is_system
  );
  const [columnId, setColumnId] = useState(dropdownColumns[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const selectedColumn = dropdownColumns.find((column) => column.id === columnId);
  const optionRows = options.filter((option) => option.column_id === columnId);
  ...
  // form: DropdownSelect(cột) + input(label) + Add → POST /api/config/columns/[id]/options {label}
  // rows: chỉ hiện label + nút Archive → DELETE /api/config/columns/[id]/options/[optionId]
  // KHÔNG có input màu, KHÔNG có sửa tên inline — dù API đã hỗ trợ (xem 1.4)
}
```

### 1.2 CS Category (`task_categories`, KHÔNG liên kết `table_column`)
- Type: `export type TaskCategory = { id: string; name: string; color: string | null };` (`lib/tasks/types.ts:90`).
- API: `GET/POST /api/tasks/categories` (đã đọc, đầy đủ), `PATCH/DELETE /api/tasks/categories/[id]` (đã đọc — PATCH hỗ trợ `name`/`color`/`is_active`, DELETE = soft `is_active=false`). **Không route nào gọi broadcast** — đây là Q2 cần sửa.
- UI hiện tại `CategoryManager.tsx`: modal riêng trên `/tasks`, chỉ add+delete (không dùng PATCH dù API có).
- Trigger site `TaskBoardClient.tsx`:
  - State (dòng 128): `const [managingCategories, setManagingCategories] = useState(false);`
  - `reloadCategories` (dòng 509-512): `async () => { const res = await fetch("/api/tasks/categories"); if (res.ok) setCategories(...); }` — set vào state `categories` (đã tồn tại, dùng ở nhiều nơi khác: filter, badge, tạo task — **GIỮ NGUYÊN state này**, chỉ bỏ nguồn trigger reload thủ công).
  - Nút (dòng 1240-1249, nằm trong `{isManager && (<> ... </>)}`):
    ```tsx
    <button type="button" onClick={() => setManagingCategories(true)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#d8dee8] bg-white px-3 text-sm font-bold text-[#42526e] shadow-sm transition hover:border-[#0c66e4] hover:text-[#0c66e4]">
      <Tag className="h-4 w-4" />
      Categories
    </button>
    ```
  - Render (dòng 1454-1458):
    ```tsx
    <CategoryManager open={managingCategories} onClose={() => setManagingCategories(false)} onChanged={reloadCategories} />
    ```
  - Realtime hiện tại (dòng 468-484): subscribe `TASKS_TOPIC`, `schedule()` chỉ gọi `refetchTasks()` + `loadOverview` — **KHÔNG** gọi `reloadCategories()`. Sau khi dời UI sang `/config` (trang khác), sửa category sẽ không tự đồng bộ vào tab `/tasks` đang mở trừ khi wire `reloadCategories` vào broadcast handler này (làm ở Part E, đi kèm Q2).

### 1.3 Enrollment Option Sets
- Đã đọc đầy đủ `OptionSetManager` (`EnrollmentClient.tsx:3117-3374`, hàm hoàn chỉnh, ~260 dòng) — 2-pane (list set bên trái, bảng value bên phải: label input onBlur, color input onBlur, checkbox Terminal/QC chỉ áp dụng khi `setKey==="stage"`, nút Archive mở `ConfirmDialog` có đếm usage).
- `optionUsageCounts` (dòng 563-581, trong `EnrollmentClient` chính — **KHÔNG** trong `OptionSetManager`):
  ```ts
  // How many live records reference each option — shown in the archive
  // confirm dialog so an admin can see the blast radius before archiving
  // (this is what silently broke the ACA Payment "Auto pay" option earlier).
  const optionUsageCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (id: string | null) => { if (!id) return; counts.set(id, (counts.get(id) ?? 0) + 1); };
    for (const record of records) {
      bump(record.stage_id); bump(record.carrier_id); bump(record.platform_id);
      bump(record.consent_id); bump(record.payment_status_id); bump(record.aca_status_id);
    }
    return counts;
  }, [records]);
  ```
  Tính từ **toàn bộ `records` đã load ở client**. `/config` KHÔNG load enrollment records → phải tính lại ở SERVER bằng 1 query gọn (Part C), không load nguyên `records`.
- Trigger site `EnrollmentClient.tsx`:
  - State (dòng 452): `const [managingOptions, setManagingOptions] = useState(false);`
  - `reloadOptions` (dòng 671-679): fetch `/api/enrollment/option-sets?program=${program}` → `setOptions(data.options)`. **Chỉ 1 caller** = `onChanged={reloadOptions}` của `OptionSetManager` (dòng 969) — sau khi xoá modal, hàm này sẽ dead **trừ khi** wire vào realtime handler (giống category).
  - Nút (dòng 841-842, trong khối `canManageOptions ? (...)`): icon `Settings2`, text "Option sets".
  - Render (dòng 962-969): `{managingOptions ? (<OptionSetManager program={program} optionSets={optionSets} optionsBySet={optionsBySet} optionUsageCounts={optionUsageCounts} onClose={...} onChanged={reloadOptions} />) : null}`.
  - Realtime hiện tại (dòng ~720-723): subscribe `ENROLLMENT_TOPIC`, `schedule()` chỉ gọi `refetch()` (records) — **KHÔNG** gọi `reloadOptions()`. Cùng vấn đề như category — cần wire vào Part F.

### 1.4 API `table_column_option` — PATCH đã có sẵn (custom dropdown), UI chưa từng gọi
- `/api/config/columns/[id]/options/[optionId]` PATCH (đã đọc đầy đủ) — nhận `label`, `color`, `position`; validate `column.type==="dropdown" && !column.is_system`. **API đã sẵn sàng cho việc thêm sửa-tên/màu vào UI** — không cần đổi backend cho phần Custom.

### 1.5 `EnrollmentConsentToggle` (bug có sẵn, Q1)
```ts
// EnrollmentClient.tsx:1898-1922 (đã đọc đầy đủ, trích đúng)
function EnrollmentConsentToggle({ optionId, options, field = false, onChange }) {
  const yesOption = options.find((option) => option.label.trim().toLowerCase() === "yes") ?? null;
  const otherOption = options.find((option) => option.id !== yesOption?.id) ?? null;
  if (!yesOption || !otherOption) {
    return <EnrollmentOptionMenu optionId={optionId} options={options} emptyLabel="No consent" field={field} onChange={onChange} />;
  }
  // ... render toggle Yes/otherOption
}
```
`otherOption` = **option đầu tiên khác `yesOption`** trong mảng — nếu có ≥3 option active, option thứ 3 trở đi **không bao giờ** render được qua toggle này (không rơi về `EnrollmentOptionMenu` vì điều kiện fallback chỉ check "thiếu", không check "thừa"). Cách sửa ĐÚNG NHẤT theo spec: chặn ở **nguồn** (UI thêm option Consent) — không cho thêm option thứ 3 trở lên — thay vì sửa component toggle (an toàn hơn, không đụng luồng nhập liệu đang chạy).

### 1.6 `/config/page.tsx` hiện tại (đọc lại đầy đủ, đã qua nhiều đợt sửa trước)
```ts
export default async function ConfigPage() {
  const admin = await loadConfigAdmin();
  if (!admin.ok) redirect(...);
  const supabase = getSupabaseAdmin();
  const [columns, options, agents, candidates, assignees, memberResult] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase.from("agent_members").select("agent_email,cs_email,is_assistant").eq("is_assistant", true),
  ]);
  if (memberResult.error) throw new Error(memberResult.error.message);
  return (
    <ConfigClient
      initialColumns={columns} initialOptions={options} initialAgents={agents}
      candidates={candidates} assignees={assignees}
      initialMembers={(memberResult.data ?? []).map(...)}
    />
  );
}
```

---

# PART A — Mở rộng `ConfigValueSection`: gộp Custom + Category, thêm màu/sửa-tên

File `src/app/(authed)/config/_components/ConfigClient.tsx`.

### A1. Props mới
```ts
// BEFORE
function ConfigValueSection({
  scope, columns, options, busy, run, refreshScope,
}: {
  scope: TableScope; columns: TableColumn[]; options: TableColumnOption[];
  busy: boolean; run: (...) => Promise<void>; refreshScope: (scope?: TableScope) => Promise<void>;
}) {

// AFTER
function ConfigValueSection({
  scope, columns, options, categories, busy, run, refreshScope, onCategoriesChange,
}: {
  scope: TableScope; columns: TableColumn[]; options: TableColumnOption[];
  categories: TaskCategory[];
  busy: boolean; run: (...) => Promise<void>; refreshScope: (scope?: TableScope) => Promise<void>;
  onCategoriesChange: Dispatch<SetStateAction<TaskCategory[]>>;
}) {
```
(`TaskCategory` import từ `@/lib/tasks/types` — thêm vào import block đầu file nếu chưa có.)

### A2. Danh sách cột trong picker — nhận thêm "category" (KHÔNG nhận Status/Priority)
```ts
// BEFORE
  const dropdownColumns = columns.filter(
    (column) => column.type === "dropdown" && !column.is_system
  );

// AFTER
  // Nhận thêm CS Category (is_system nhưng có nơi lưu qua task_categories).
  // KHÔNG nhận Status/Priority — cũng is_system+dropdown nhưng giá trị hardcode
  // trong TASK_STATUSES/TASK_PRIORITIES (TS enum), không có bảng nào để sửa.
  const dropdownColumns = columns.filter(
    (column) =>
      column.type === "dropdown" &&
      (!column.is_system || (scope === "cs" && column.key === "category"))
  );
```

### A3. Xác định nguồn giá trị theo cột đang chọn + form/list thống nhất
```ts
// BEFORE
  const [columnId, setColumnId] = useState(dropdownColumns[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const selectedColumn = dropdownColumns.find((column) => column.id === columnId);
  const optionRows = options.filter((option) => option.column_id === columnId);
  const dropdownColumnOptions: SelectOption<string>[] = dropdownColumns.map((column) => ({
    value: column.id, label: column.label,
  }));

// AFTER
  const [columnId, setColumnId] = useState(dropdownColumns[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("");
  const selectedColumn = dropdownColumns.find((column) => column.id === columnId);
  const isCategoryColumn = Boolean(selectedColumn?.is_system && selectedColumn.key === "category");
  // Chuẩn hoá về 1 shape {id,label,color} bất kể nguồn — custom hay category.
  const valueRows = isCategoryColumn
    ? categories.map((c) => ({ id: c.id, label: c.name, color: c.color }))
    : options
        .filter((option) => option.column_id === columnId)
        .map((o) => ({ id: o.id, label: o.label, color: o.color }));
  const dropdownColumnOptions: SelectOption<string>[] = dropdownColumns.map((column) => ({
    value: column.id, label: column.label,
  }));

  async function refreshCategories() {
    const response = await fetch("/api/tasks/categories", { cache: "no-store" });
    if (response.ok) onCategoriesChange((await response.json()).categories as TaskCategory[]);
  }

  async function addValue() {
    if (!selectedColumn) return;
    if (isCategoryColumn) {
      await requestJson("/api/tasks/categories", {
        method: "POST",
        body: JSON.stringify({ name: label, color: color || null }),
      });
      await refreshCategories();
    } else {
      await requestJson(`/api/config/columns/${selectedColumn.id}/options`, {
        method: "POST",
        body: JSON.stringify({ label, color: color || null }),
      });
      await refreshScope(scope);
    }
  }

  async function renameValue(id: string, nextLabel: string) {
    if (isCategoryColumn) {
      await requestJson(`/api/tasks/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name: nextLabel }) });
      await refreshCategories();
    } else {
      await requestJson(`/api/config/columns/${columnId}/options/${id}`, { method: "PATCH", body: JSON.stringify({ label: nextLabel }) });
      await refreshScope(scope);
    }
  }

  async function recolorValue(id: string, nextColor: string) {
    if (isCategoryColumn) {
      await requestJson(`/api/tasks/categories/${id}`, { method: "PATCH", body: JSON.stringify({ color: nextColor }) });
      await refreshCategories();
    } else {
      await requestJson(`/api/config/columns/${columnId}/options/${id}`, { method: "PATCH", body: JSON.stringify({ color: nextColor }) });
      await refreshScope(scope);
    }
  }

  async function archiveValue(id: string) {
    if (isCategoryColumn) {
      await requestJson(`/api/tasks/categories/${id}`, { method: "DELETE" });
      await refreshCategories();
    } else {
      await requestJson(`/api/config/columns/${columnId}/options/${id}`, { method: "DELETE" });
      await refreshScope(scope);
    }
  }
```
> `requestJson` đã có sẵn trong file (dùng chung toàn `ConfigClient.tsx`) — không viết lại.
> `/api/tasks/categories` DELETE hiện tại: kiểm tra route thật — `[id]/route.ts` DELETE soft `is_active=false`, KHÔNG cần body. Khớp cách gọi trên.

### A4. Render — thêm input màu, đổi label input thành sửa-được, dùng `valueRows`
Thay khối `<form>` (thêm mới) + list `optionRows.map(...)` bằng bản dùng `label`/`color` state cho form thêm, và `valueRows.map(...)` với input label (onBlur=rename) + input color (onBlur=recolor) + nút Archive cho list — theo đúng pattern `EditableInput`/color-input đã dùng ở `OptionSetManager` (input `type="color"`, `onBlur` gọi `renameValue`/`recolorValue`). Nút Add gọi `addValue()` thay vì gọi thẳng `requestJson` như cũ; sau khi thêm thành công reset `label`/`color`.

Đổi copy mô tả đầu section (bỏ câu "System dropdowns stay in Enrollment option sets and Task Categories for now" — không còn đúng):
```tsx
<p className="mt-1 text-sm text-[#6b778c]">
  Custom dropdown values and Categories. Enrollment option sets (Stage, Carrier, ...) are below.
</p>
```

---

# PART B — Component mới `ConfigOptionSetSection`

File `ConfigClient.tsx` (thêm hàm mới, đặt cạnh `ConfigValueSection`).

Port gần như nguyên khối JSX + logic từ `OptionSetManager` (`EnrollmentClient.tsx:3117-3374`), điều chỉnh:
- Bỏ wrapper modal (`fixed inset-0 z-[70] ...`) + `<header>` có nút X đóng — nhúng thẳng làm `<section>` giống style `ConfigAssistantSection`/`ConfigValueSection`.
- Bỏ prop `onClose`.
- **Thêm guard Consent (Q1)**: nút Add disabled thêm điều kiện `|| (setKey === "consent" && setOptions.filter(o=>!o.archived_at).length >= 2)`; nút Archive trong row disabled thêm điều kiện tương tự nếu archive sẽ làm active count < 2 (chỉ áp dụng khi `setKey==="consent"`).

```ts
function ConfigOptionSetSection({
  program,
  optionSets,
  optionsBySet,
  optionUsageCounts,
  busy,
  run,
  onChanged,
}: {
  program: EnrollmentProgram;
  optionSets: EnrollmentOptionSet[];
  optionsBySet: EnrollmentOptionsBySet;
  optionUsageCounts: Map<string, number>;
  busy: boolean;
  run: (action: () => Promise<void>, success: string) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [setKey, setSetKey] = useState<EnrollmentOptionSetKey>(optionSets[0]?.key ?? "stage");
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#0C66E4");
  const [isTerminal, setIsTerminal] = useState(false);
  const [triggersQc, setTriggersQc] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<EnrollmentOption | null>(null);
  const setOptions = sortEnrollmentOptionsByLabel(optionsBySet[setKey] ?? []);
  const activeConsentCount = setOptions.filter((o) => !o.archived_at).length;
  const isConsentSet = setKey === "consent";

  async function addOption() {
    await run(async () => {
      await requestJson("/api/enrollment/option-sets", {
        method: "POST",
        body: JSON.stringify({ program, set_key: setKey, label, color, is_terminal: isTerminal, triggers_qc: triggersQc }),
      });
      setLabel(""); setIsTerminal(false); setTriggersQc(false);
      await onChanged();
    }, "Option added.");
  }

  async function patchOption(id: string, patch: Record<string, unknown>) {
    await requestJson(`/api/enrollment/option-sets/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    await onChanged();
  }

  async function archiveOption(id: string) {
    await requestJson(`/api/enrollment/option-sets/${id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <section className="overflow-hidden rounded border border-[#dfe1e6] bg-white shadow-sm">
      <div className="border-b border-[#dfe1e6] px-6 py-4">
        <h2 className="text-lg font-bold">Option sets — {program === "medicare" ? "Medicare" : "ACA"}</h2>
        <p className="mt-1 text-sm text-[#6b778c]">Archive options instead of deleting them from historical records.</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="border-b border-[#dfe1e6] bg-[#f7f8fa] p-3 md:border-b-0 md:border-r">
          {optionSets.map((set) => (
            <button key={set.id} type="button" onClick={() => setSetKey(set.key)}
              className={`mb-1 flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm font-bold ${
                set.key === setKey ? "bg-[#e9f2ff] text-[#0c66e4]" : "text-[#42526e] hover:bg-white"
              }`}>
              {set.label}
              <span>{(optionsBySet[set.key] ?? []).length}</span>
            </button>
          ))}
        </nav>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-2 border-b border-[#dfe1e6] pb-4 md:grid-cols-[minmax(0,1fr)_110px_120px_120px_auto]">
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder={`New ${ENROLLMENT_OPTION_LABELS[setKey]}`}
              className="h-10 rounded border border-[#dfe1e6] px-3 text-sm font-semibold outline-none focus:border-[#0c66e4]" />
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              className="h-10 w-full rounded border border-[#dfe1e6] bg-white p-1" />
            <label className="flex items-center justify-center gap-2 rounded border border-[#dfe1e6] px-2 text-xs font-bold text-[#42526e]">
              <input type="checkbox" disabled={setKey !== "stage"} checked={setKey === "stage" && isTerminal}
                onChange={(e) => setIsTerminal(e.target.checked)} />
              Terminal
            </label>
            <label className="flex items-center justify-center gap-2 rounded border border-[#dfe1e6] px-2 text-xs font-bold text-[#42526e]">
              <input type="checkbox" disabled={setKey !== "stage"} checked={setKey === "stage" && triggersQc}
                onChange={(e) => setTriggersQc(e.target.checked)} />
              QC
            </label>
            <button type="button" disabled={busy || !label.trim() || (isConsentSet && activeConsentCount >= 2)}
              onClick={() => void addOption()}
              title={isConsentSet && activeConsentCount >= 2 ? "Consent supports exactly 2 active options (Yes / other)." : undefined}
              className="h-10 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white disabled:opacity-40">
              Add
            </button>
          </div>
          <div className="mt-4 overflow-auto rounded-lg border border-[#dfe1e6]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[#f7f8fa] text-xs font-bold uppercase text-[#6b778c]">
                <tr>
                  <th className="border-b border-r border-[#dfe1e6] px-3 py-2 text-left">Label</th>
                  <th className="border-b border-r border-[#dfe1e6] px-3 py-2 text-left">Color</th>
                  <th className="border-b border-r border-[#dfe1e6] px-3 py-2 text-left">Rules</th>
                  <th className="border-b border-[#dfe1e6] px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {setOptions.map((option) => {
                  const wouldDropBelowTwo = isConsentSet && !option.archived_at && activeConsentCount <= 2;
                  return (
                    <tr key={option.id}>
                      <td className="border-b border-r border-[#dfe1e6] px-3 py-2">
                        <input defaultValue={option.label}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== option.label) void patchOption(option.id, { label: v }); }}
                          className="h-8 w-full rounded border border-[#dfe1e6] px-2 font-semibold outline-none focus:border-[#0c66e4]" />
                      </td>
                      <td className="border-b border-r border-[#dfe1e6] px-3 py-2">
                        <input type="color" defaultValue={option.color ?? "#97A0AF"}
                          onBlur={(e) => void patchOption(option.id, { color: e.target.value })}
                          className="h-8 w-full rounded border border-[#dfe1e6] bg-white p-1" />
                      </td>
                      <td className="border-b border-r border-[#dfe1e6] px-3 py-2 text-xs font-semibold text-[#42526e]">
                        {setKey === "stage" ? (
                          <div className="flex flex-wrap gap-2">
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={option.is_terminal}
                                onChange={(e) => void patchOption(option.id, { is_terminal: e.target.checked })} />
                              Terminal
                            </label>
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" checked={option.triggers_qc}
                                onChange={(e) => void patchOption(option.id, { triggers_qc: e.target.checked })} />
                              QC
                            </label>
                          </div>
                        ) : "Standard option"}
                      </td>
                      <td className="border-b border-[#dfe1e6] px-3 py-2 text-right">
                        <button type="button" disabled={wouldDropBelowTwo}
                          title={wouldDropBelowTwo ? "Consent needs at least 2 active options." : undefined}
                          onClick={() => setConfirmArchive(option)}
                          className="text-xs font-bold text-[#bf2600] hover:underline disabled:opacity-40 disabled:no-underline">
                          Archive
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {confirmArchive ? (
        <ConfirmDialog
          title={`Archive "${confirmArchive.label}"?`}
          description={
            (optionUsageCounts.get(confirmArchive.id) ?? 0) > 0
              ? `${optionUsageCounts.get(confirmArchive.id)} record(s) currently use this option. Archiving removes it from pickers going forward — those records keep showing it, but nobody can select it for a new record until it's restored.`
              : "No live records currently use this option. It will be removed from pickers going forward."
          }
          confirmLabel="Archive"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => { const id = confirmArchive.id; setConfirmArchive(null); void archiveOption(id); }}
        />
      ) : null}
    </section>
  );
}
```
> Cần import thêm vào `ConfigClient.tsx`: `sortEnrollmentOptionsByLabel`, `ENROLLMENT_OPTION_LABELS` (từ `@/lib/enrollment/options`), `EnrollmentOptionSet`, `EnrollmentOption`, `EnrollmentOptionSetKey`, `EnrollmentOptionsBySet`, `EnrollmentProgram` (từ `@/lib/enrollment/types`).
>
> **Đã verify: `ConfirmDialog` KHÔNG export** — định nghĩa `function ConfirmDialog(...)` cục bộ trong `EnrollmentClient.tsx:3659-3696` (không `export`). Copy nguyên hàm này (37 dòng, đã trích đủ dưới) vào `ConfigClient.tsx` làm helper cục bộ — KHÔNG đổi `EnrollmentClient.tsx` để export nó (tránh động vào file không cần thiết cho feature này):
> ```tsx
> function ConfirmDialog({
>   title, description, confirmLabel, onCancel, onConfirm,
> }: { title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
>   return (
>     <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#091e42]/50 p-4">
>       <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl">
>         <h2 className="text-lg font-bold text-[#172b4d]">{title}</h2>
>         <p className="mt-2 text-sm leading-6 text-[#5e6c84]">{description}</p>
>         <div className="mt-5 flex justify-end gap-2">
>           <button type="button" onClick={onCancel} className="rounded px-3 py-2 text-sm font-bold text-[#42526e] transition hover:bg-[#f4f5f7]">Cancel</button>
>           <button type="button" onClick={onConfirm} className="rounded bg-[#ca3521] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#ae2a19]">{confirmLabel}</button>
>         </div>
>       </div>
>     </div>
>   );
> }
> ```

---

# PART C — `/config/page.tsx`: fetch category + option sets + usage counts

```ts
// BEFORE (import)
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";
import { loadConfigAdmin } from "@/lib/table-config/access";
import {
  fetchAllTableColumnOptions,
  fetchAllTableColumns,
} from "@/lib/table-config/queries";
import { ConfigClient } from "./_components/ConfigClient";

// AFTER — thêm
import {
  fetchTaskAgentCandidates,
  fetchTaskAgents,
  fetchTaskAssignees,
} from "@/lib/tasks/assignees";
import { loadConfigAdmin } from "@/lib/table-config/access";
import {
  fetchAllTableColumnOptions,
  fetchAllTableColumns,
} from "@/lib/table-config/queries";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import type { TaskCategory } from "@/lib/tasks/types";
import { ConfigClient } from "./_components/ConfigClient";
```

```ts
// BEFORE
  const supabase = getSupabaseAdmin();
  const [columns, options, agents, candidates, assignees, memberResult] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase.from("agent_members").select("agent_email,cs_email,is_assistant").eq("is_assistant", true),
  ]);
  if (memberResult.error) throw new Error(memberResult.error.message);

// AFTER
  const supabase = getSupabaseAdmin();
  const [
    columns, options, agents, candidates, assignees, memberResult,
    categoriesResult, acaOptionData, medicareOptionData, usageCountResult,
  ] = await Promise.all([
    fetchAllTableColumns(supabase),
    fetchAllTableColumnOptions(supabase),
    fetchTaskAgents(),
    fetchTaskAgentCandidates(),
    fetchTaskAssignees(),
    supabase.from("agent_members").select("agent_email,cs_email,is_assistant").eq("is_assistant", true),
    supabase.from("task_categories").select("id,name,color").eq("is_active", true).order("position", { ascending: true }),
    fetchEnrollmentOptionData("aca"),
    fetchEnrollmentOptionData("medicare"),
    // Đếm usage TỐI GIẢN — KHÔNG load nguyên enrollment records (spec Rủi ro #1).
    supabase
      .from("enrollment_records")
      .select("program,stage_id,carrier_id,platform_id,consent_id,payment_status_id,aca_status_id")
      .is("archived_at", null),
  ]);
  if (memberResult.error) throw new Error(memberResult.error.message);
  if (categoriesResult.error) throw new Error(categoriesResult.error.message);
  if (usageCountResult.error) throw new Error(usageCountResult.error.message);

  function buildUsageCounts(program: "aca" | "medicare"): Record<string, number> {
    const counts: Record<string, number> = {};
    const bump = (id: string | null) => { if (id) counts[id] = (counts[id] ?? 0) + 1; };
    for (const row of usageCountResult.data ?? []) {
      const record = row as { program: string; stage_id: string | null; carrier_id: string | null; platform_id: string | null; consent_id: string | null; payment_status_id: string | null; aca_status_id: string | null };
      if (record.program !== program) continue;
      bump(record.stage_id); bump(record.carrier_id); bump(record.platform_id);
      bump(record.consent_id); bump(record.payment_status_id); bump(record.aca_status_id);
    }
    return counts;
  }
```

```tsx
// BEFORE
  return (
    <ConfigClient
      initialColumns={columns} initialOptions={options} initialAgents={agents}
      candidates={candidates} assignees={assignees}
      initialMembers={(memberResult.data ?? []).map(...)}
    />
  );

// AFTER
  return (
    <ConfigClient
      initialColumns={columns} initialOptions={options} initialAgents={agents}
      candidates={candidates} assignees={assignees}
      initialMembers={(memberResult.data ?? []).map(...)}
      initialCategories={(categoriesResult.data ?? []) as TaskCategory[]}
      initialOptionData={{ aca: acaOptionData, medicare: medicareOptionData }}
      enrollmentUsageCounts={{ aca: buildUsageCounts("aca"), medicare: buildUsageCounts("medicare") }}
    />
  );
```

---

# PART D — `ConfigClient.tsx`: wiring state + render 2 khối trong tab Dropdown Values

### D1. Props + state mới
**Đã verify: `fetchEnrollmentOptionData(program)` trả sẵn `{ sets, options, optionsBySet }`** (`lib/enrollment/options.ts:57-62`) — lưu nguyên khối, KHÔNG tự group lại tay.

Thêm vào props: `initialCategories: TaskCategory[]`, `initialOptionData: Record<"aca"|"medicare", { sets: EnrollmentOptionSet[]; options: EnrollmentOption[]; optionsBySet: EnrollmentOptionsBySet }>`, `enrollmentUsageCounts: Record<"aca"|"medicare", Record<string, number>>`.

Thêm state (cạnh `const [members, setMembers] = useState(initialMembers);`):
```ts
const [categories, setCategories] = useState(initialCategories);
const [optionData, setOptionData] = useState(initialOptionData);
```
`enrollmentUsageCounts` giữ nguyên prop tĩnh (không cần state — lý do đã ghi ở PART B/C, không đổi trong phiên làm việc của admin).

Thêm hàm refresh option sets theo scope hiện tại (gọi lại API cũ, trả nguyên `{sets,options,optionsBySet}` giống lúc SSR):
```ts
async function refreshOptionData(program: "aca" | "medicare") {
  const response = await fetch(`/api/enrollment/option-sets?program=${program}`, { cache: "no-store" });
  if (!response.ok) return;
  const data = (await response.json()) as { sets: EnrollmentOptionSet[]; options: EnrollmentOption[]; optionsBySet: EnrollmentOptionsBySet };
  setOptionData((cur) => ({ ...cur, [program]: data }));
}
```
(`GET /api/enrollment/option-sets` gọi `fetchEnrollmentOptionData(program)` y hệt SSR — response shape khớp state, không cần transform.)

### D2. Render trong tab "value" — thêm khối theo scope
```tsx
// BEFORE
{tab === "value" ? (
  <ConfigValueSection scope={scope} columns={activeColumns} options={activeOptions} busy={busy} run={run} refreshScope={refreshScope} />
) : null}

// AFTER
{tab === "value" ? (
  <div className="space-y-4">
    <ConfigValueSection
      scope={scope} columns={activeColumns} options={activeOptions} categories={categories}
      busy={busy} run={run} refreshScope={refreshScope} onCategoriesChange={setCategories}
    />
    {scope === "aca" || scope === "medicare" ? (
      <ConfigOptionSetSection
        program={scope}
        optionSets={optionData[scope].sets}
        optionsBySet={optionData[scope].optionsBySet}
        optionUsageCounts={new Map(Object.entries(enrollmentUsageCounts[scope]))}
        busy={busy} run={run}
        onChanged={() => refreshOptionData(scope)}
      />
    ) : null}
  </div>
) : null}
```

---

# PART E — Xoá Category UI khỏi `TaskBoardClient.tsx` + Q2 fix

### E1. Xoá state, nút, render (như Part F của plan trước — cùng pattern)
- Xoá dòng 128: `const [managingCategories, setManagingCategories] = useState(false);`
- Xoá khối nút (dòng 1240-1249, bên trong `{isManager && (<>...`) — **CHỈ** xoá đúng nút Categories, giữ nguyên các nút khác trong cùng fragment (SLA Rules, v.v.).
- Xoá render (dòng 1454-1458): `<CategoryManager .../>`.
- Xoá import `CategoryManager`.
- `reloadCategories` (dòng 509-512): **GIỮ LẠI** hàm, nhưng đổi người gọi — wire vào realtime handler (E2) thay vì modal.

### E2. Wire `reloadCategories` vào realtime handler (đi kèm Q2)
```ts
// BEFORE (dòng ~472-478)
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refetchTasks();
        if (isManager && view === "overview") void loadOverview(true);
      }, 300);
    };

// AFTER
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refetchTasks();
        void reloadCategories();
        if (isManager && view === "overview") void loadOverview(true);
      }, 300);
    };
```

### E3. Q2 — thêm broadcast vào 3 route category
```ts
// src/app/api/tasks/categories/route.ts — POST, sau khi insert thành công
import { broadcastTasksChanged } from "@/lib/tasks/realtime"; // thêm import
// ...
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await broadcastTasksChanged();               // NEW
  return NextResponse.json({ category: data });
```
```ts
// src/app/api/tasks/categories/[id]/route.ts — PATCH và DELETE, mỗi hàm sau update thành công
import { broadcastTasksChanged } from "@/lib/tasks/realtime"; // thêm import
// PATCH: sau `if (error) ...; return NextResponse.json(...)` → thêm await broadcastTasksChanged() trước return
// DELETE: tương tự
```

---

# PART F — Xoá Option Sets UI khỏi `EnrollmentClient.tsx` + wire `reloadOptions` vào realtime

### F1. Xoá state, nút, render, hàm
- Xoá dòng 452: `const [managingOptions, setManagingOptions] = useState(false);`
- Xoá nút (dòng 841-842 + `Settings2` icon liên quan trong khối `canManageOptions ? (...)`) — chỉ xoá đúng nút "Option sets", giữ các control khác cùng khối nếu có.
- Xoá render (dòng 962-969): `{managingOptions ? (<OptionSetManager .../>) : null}`.
- Xoá hẳn hàm `OptionSetManager` (dòng 3117-3374, ~260 dòng) sau khi verify không còn caller nào khác trong file (`grep -n "OptionSetManager" EnrollmentClient.tsx` chỉ nên còn 0 kết quả).
- `reloadOptions` (dòng 671-679): **GIỮ LẠI** hàm.

### F2. Wire `reloadOptions` vào realtime handler
```ts
// BEFORE (khối schedule trong ENROLLMENT_TOPIC subscription, ~dòng 715-723)
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 300);
    };

// AFTER
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refetch();
        void reloadOptions();
      }, 300);
    };
```
> `/api/enrollment/option-sets*` đã gọi `broadcastEnrollmentChanged()` sẵn (đọc ở review trước) — không cần sửa API, chỉ cần wire listener này.

---

## 2. Verification

```bash
npx tsc --noEmit
npx vitest run
npm run lint
grep -rn "CategoryManager\|OptionSetManager\|managingCategories\|managingOptions" src   # chỉ còn định nghĩa/import nếu CategoryManager.tsx bị xoá hẳn; nếu xoá file thì phải 0 kết quả
```
**KHÔNG chạy `next build`/xoá `.next`** nếu nghi ngờ dev server đang chạy song song (bài học từ đợt trước — corrupt cache).

Test tay:
- `/config` → Dropdown Values, scope=cs: picker có "Category" lẫn custom dropdown; thêm/sửa tên/đổi màu/archive category từ đây; xác nhận Status/Priority KHÔNG xuất hiện trong picker.
- scope=aca: khối Option sets hiện đủ 6 set; thử archive 1 option có usage → thấy đúng số lượng cảnh báo; thử Consent — thêm option thứ 3 phải bị chặn nút Add (tooltip giải thích), thử archive khi chỉ còn 2 active phải bị chặn.
- scope=medicare: chỉ 2 set (stage, carrier).
- Mở `/tasks` + `/config` 2 tab — sửa category ở `/config`, xác nhận tab `/tasks` tự cập nhật list category (không cần F5) trong ~1s.
- Mở `/enrollment` + `/config` 2 tab tương tự — sửa option set ở `/config`, xác nhận `/enrollment` tự cập nhật badge màu/label.
- Xác nhận `/tasks` không còn nút "Categories", `/enrollment` không còn nút "Option sets".

## 3. Ghi changelog (mẫu, điền sau khi code xong)

```
## 2026-08-03 — Consolidate dropdown values (Custom + Category + Option Sets) into /config
- **Loại**: feat, refactor-logic, fix
- **Cái gì**: gộp quản lý mọi dropdown value (custom column + CS Category + Enrollment Option Sets) vào `/config` → tab Dropdown Values, 2 khối theo scope (Custom+Category chung 1 form nâng cấp thêm màu/sửa-tên-inline; Option Sets port gần nguyên vẹn giữ đủ Terminal/QC + cảnh báo usage-count khi archive). Xoá UI setup cũ khỏi `/tasks` (Categories) và `/enrollment` (Option sets). Kèm 2 fix có sẵn: Consent giới hạn đúng 2 giá trị active (chặn bug im lặng trong EnrollmentConsentToggle khi có option thứ 3); category giờ bắn broadcast realtime (route cũ thiếu).
- **Vì sao**: user muốn 1 nơi duy nhất set up mọi dropdown, không rải rác 3 trang. Quyết định kiến trúc (3 khối, không migrate schema, không gộp 1 picker chung) đã qua review đối kháng 2-agent — xem spec.
- **File**: config/_components/ConfigClient.tsx, config/page.tsx, tasks/_components/TaskBoardClient.tsx (xoá Categories UI), tasks/_components/CategoryManager.tsx (xoá file), enrollment/_components/EnrollmentClient.tsx (xoá OptionSetManager + UI), api/tasks/categories/*.ts (+broadcast)
- **Ảnh hưởng**: không đổi schema, không đổi RBAC, không đổi API route nào (trừ thêm broadcast). Admin set up category/option sets chỉ còn ở `/config`.
- **Ref**: docs/superpowers/specs/2026-08-03-consolidate-dropdown-values-design.md, docs/superpowers/plans/2026-08-03-consolidate-dropdown-values.md
```

## 4. Thứ tự code đề xuất
1. Part C (page.tsx fetch) → Part D (ConfigClient wiring cơ bản, chưa render UI) → `tsc --noEmit`.
2. Part A (ConfigValueSection mở rộng) → test tay category qua `/config`.
3. Part B (ConfigOptionSetSection mới) → test tay option sets qua `/config`, đặc biệt Consent guard.
4. Part E (dọn TaskBoardClient + Q2) → Part F (dọn EnrollmentClient) — làm sau cùng, sau khi Part A/B đã chạy tốt qua `/config` (tránh mất khả năng set up giữa chừng nếu Part A/B còn lỗi).
5. Verify toàn bộ (mục 2) + changelog + commit + push.

## 5. Rủi ro / điểm dễ sai
- **Đừng quên Q1 guard áp cho CẢ Add lẫn Archive** — chỉ chặn 1 chiều (vd chỉ chặn Add) vẫn có thể tụt xuống dưới 2 qua đường archive.
- **Thứ tự xoá UI cũ** — làm sau cùng (Part E/F), sau khi UI mới ở `/config` đã chạy được, tránh có lúc không ai set up được category/option nếu giữa chừng lỗi.
- **`.next` cache** — không chạy `next build` nếu nghi dev server đang chạy song song (đã có sự cố thật ở đợt trước).
