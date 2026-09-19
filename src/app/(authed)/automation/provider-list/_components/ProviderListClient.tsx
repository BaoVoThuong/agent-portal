"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { resolveLayout, serializeLayout, type LayoutEntry } from "@/lib/table-config/layout";
import {
  initialHiddenProviderColumnKeys,
  toggleHiddenProviderListColumn,
  visibleProviderListColumns,
} from "@/lib/providers/list-columns";
import {
  EMPTY_PROVIDER_FILTERS,
  applyProviderFilters,
  filterProviders,
  providerFilterOptions,
  sortProviders,
  type ProviderFilters,
  type ProviderSortDir,
} from "@/lib/providers/search";
import type { ProviderRow } from "@/lib/providers/types";
import { providerCarrierOptions } from "@/lib/providers/carriers";
import { AddProviderDialog } from "./AddProviderDialog";
import { ProviderTable } from "./ProviderTable";
import { ProviderEditDialog } from "./ProviderEditDialog";
import { ProviderTableSettingsButton } from "./ProviderTableSettingsButton";
import { ProviderToolbar } from "./ProviderToolbar";
// Dựng lại CHÍNH component của Provider Finder, không chép code sang đây.
// Trang riêng `/automation/provider-finder` đã bị ẩn (chỉ còn chuyển hướng về
// đây), nên tab này là lối vào DUY NHẤT của tính năng tìm theo khoảng cách —
// component vẫn nằm ở thư mục cũ, đừng tưởng nó mồ côi mà xoá.
import ProviderFinderClient from "../../provider-finder/ProviderFinderClient";

const VIEWS = [
  { key: "list" as const, label: "List" },
  { key: "finder" as const, label: "Finder Tool" },
];

/** Dựng dần: 889 dòng × hơn chục cột là quá nhiều nút DOM cho một lần vẽ. */
const PAGE_SIZE = 200;

export function ProviderListClient({
  initialProviders,
  loadError,
  columns,
  columnOptions,
}: {
  initialProviders: ProviderRow[];
  loadError: string | null;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
}) {
  const [providers, setProviders] = useState<ProviderRow[]>(initialProviders);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ProviderFilters>(EMPTY_PROVIDER_FILTERS);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<ProviderSortDir>("asc");
  const [layoutColumns, setLayoutColumns] = useState<TableColumn[]>(columns);
  // Mới mở bảng: ẩn đúng những cột admin đánh `hidden_default`. Từ đó trở đi
  // người dùng tự bật/tắt được, kể cả những cột đó — xem list-columns.ts.
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Set<string>>(() =>
    initialHiddenProviderColumnKeys(columns)
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [addOpen, setAddOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderRow | null>(null);
  // Tab nằm trong state, không phải điều hướng: đổi tab mà chạy lại server
  // component thì phải nạp lại cả 889 dòng chỉ để xem ô tìm kiếm theo địa chỉ.
  const [view, setView] = useState<"list" | "finder">("list");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(
    loadError ? { tone: "error", text: loadError } : null
  );

  const layoutHydratedRef = useRef(false);
  const layoutUpdatedAtRef = useRef<string | null>(null);
  const layoutSaveSequenceRef = useRef(0);

  // Cài đặt bảng theo từng người, dùng chung API user_table_layout với Task
  // List và Event Leads. `hidden_default` của admin vẫn thắng; đây chỉ là lựa
  // chọn riêng về những cột còn lại.
  useEffect(() => {
    if (layoutHydratedRef.current) return;
    layoutHydratedRef.current = true;
    let alive = true;

    void fetch("/api/config/layout?scope=provider")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { layout?: unknown; updated_at?: unknown } | null) => {
        if (!alive) return;
        layoutUpdatedAtRef.current =
          typeof payload?.updated_at === "string" ? payload.updated_at : null;
        if (!Array.isArray(payload?.layout)) return;

        const resolved = resolveLayout(columns, payload.layout as LayoutEntry[]);
        setLayoutColumns(
          resolved.map((column, index) => ({ ...column, position: (index + 1) * 10 }))
        );
        // Lấy nguyên trạng thái đã lưu: cột `hidden_default` mà người này từng
        // bật lên phải ở lại bật sau khi tải lại trang.
        setHiddenColumnKeys(
          new Set(
            resolved
              .filter((column) => column.hidden && !column.pinned)
              .map((column) => column.key)
          )
        );
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [columns]);

  const saveLayout = useCallback(
    (hiddenKeys: ReadonlySet<string>) => {
      const sequence = ++layoutSaveSequenceRef.current;
      void (async () => {
        // Bấm nhanh nhiều cột thì chỉ ý định cuối cùng được ghi; một phản hồi
        // cũ không được phép đè lên lựa chọn mới hơn.
        if (sequence !== layoutSaveSequenceRef.current) return;
        const layout = serializeLayout(
          layoutColumns.map((column) => ({
            ...column,
            width: null,
            // Ghi đúng lựa chọn hiện tại, kể cả khi nó ngược `hidden_default`:
            // đó chính là thứ phải sống sót qua lần tải trang sau.
            hidden: !column.pinned && hiddenKeys.has(column.key),
          }))
        );
        const response = await fetch("/api/config/layout", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "provider",
            layout,
            expected_updated_at: layoutUpdatedAtRef.current,
          }),
        }).catch(() => null);
        if (!response?.ok) return;
        const payload = (await response.json().catch(() => null)) as
          | { updated_at?: unknown }
          | null;
        if (typeof payload?.updated_at === "string") {
          layoutUpdatedAtRef.current = payload.updated_at;
        }
      })();
    },
    [layoutColumns]
  );

  function toggleColumn(key: string) {
    setHiddenColumnKeys((current) => {
      const next = toggleHiddenProviderListColumn(current, key);
      saveLayout(next);
      return next;
    });
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  }

  const visibleColumns = useMemo(
    () => visibleProviderListColumns(layoutColumns, hiddenColumnKeys),
    [layoutColumns, hiddenColumnKeys]
  );

  // Lựa chọn của bộ lọc rút từ chính dữ liệu: provider không có cột dropdown
  // nào, mọi cột đều là văn bản tự do đến từ Sheet.
  const filterOptions = useMemo(() => providerFilterOptions(providers), [providers]);
  const finderCarrierOptions = useMemo(
    () => providerCarrierOptions(providers),
    [providers]
  );

  const rows = useMemo(() => {
    const filtered = filterProviders(applyProviderFilters(providers, filters), query);
    return sortKey ? sortProviders(filtered, sortKey, sortDir) : filtered;
  }, [providers, filters, query, sortKey, sortDir]);

  const hasMoreRows = visibleCount < rows.length;
  const renderNextRows = useCallback(() => {
    setVisibleCount((current) => Math.min(current + PAGE_SIZE, rows.length));
  }, [rows.length]);

  async function patchProvider(id: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/automation/provider-list/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as
      | { provider?: ProviderRow; error?: string }
      | null;
    if (!response?.ok || !payload?.provider) {
      setNotice({ tone: "error", text: payload?.error ?? "Could not save the change." });
      // Ném lại để ô tự bật viền đỏ và giữ giá trị cũ.
      throw new Error(payload?.error ?? "Could not save the change.");
    }
    const saved = payload.provider;
    setProviders((current) => current.map((row) => (row.id === id ? saved : row)));
    setNotice(null);
  }

  async function createProvider(body: Record<string, unknown>) {
    const response = await fetch("/api/automation/provider-list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as
      | { provider?: ProviderRow; error?: string }
      | null;
    if (!response?.ok || !payload?.provider) {
      throw new Error(payload?.error ?? "Could not add the provider.");
    }
    const created = payload.provider;
    setProviders((current) => [created, ...current]);
    setNotice({ tone: "info", text: "Address added." });
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]">
      <div className="min-w-0 shrink-0 px-6 pb-3 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold leading-tight tracking-[-0.02em] text-[#172b4d]">
                Provider List
              </h1>
            </div>
            <div className="flex items-center gap-2">
              {/* Nút này chỉ có nghĩa với bảng; tab tìm theo địa chỉ không thêm
                  dòng. Nút chọn cột đã xuống cuối hàng lọc bên dưới. */}
              {view === "list" ? (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-[0_2px_5px_rgba(9,30,66,0.16)] transition hover:bg-[#0055cc]"
                >
                  <Plus className="h-4 w-4" /> Add address
                </button>
              ) : null}
            </div>
          </header>

          <ProviderToolbar
            views={VIEWS}
            view={view}
            onViewChange={setView}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              setVisibleCount(PAGE_SIZE);
            }}
            filters={filters}
            onFilters={(next) => {
              setFilters(next);
              setVisibleCount(PAGE_SIZE);
            }}
            options={filterOptions}
            resultCount={rows.length}
            totalCount={providers.length}
            settingsSlot={
              <ProviderTableSettingsButton
                columns={layoutColumns}
                hiddenColumnKeys={hiddenColumnKeys}
                onToggleColumn={toggleColumn}
              />
            }
          />

          {notice ? (
            <p
              className={`rounded border px-3 py-2 text-sm font-semibold ${
                notice.tone === "error"
                  ? "border-[#ffbdad] bg-[#ffebe6] text-[#bf2600]"
                  : "border-[#b3d4ff] bg-[#deebff] text-[#0055cc]"
              }`}
            >
              {notice.text}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={`min-h-0 min-w-0 flex-1 px-6 pb-6 ${
          // Bảng tự cuộn bên trong khung của nó; tab tìm theo địa chỉ thì dài
          // hơn màn hình nên cần khung ngoài cuộn được.
          view === "list" ? "" : "overflow-auto"
        }`}
      >
        <div className="mx-auto flex h-full min-h-0 max-w-[1760px] flex-col gap-2">
          {view === "list" ? (
            <>
              <ProviderTable
                providers={rows.slice(0, visibleCount)}
                columns={visibleColumns}
                columnOptions={columnOptions}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                onOpenProvider={setEditingProvider}
                hasMore={hasMoreRows}
                onEndReached={renderNextRows}
              />
            </>
          ) : (
            <ProviderFinderClient
              carrierOptions={finderCarrierOptions}
              stateOptions={filterOptions.state}
              cityOptions={filterOptions.city}
            />
          )}
        </div>
      </div>

      <AddProviderDialog
        open={addOpen}
        columns={columns}
        columnOptions={columnOptions}
        onClose={() => setAddOpen(false)}
        onCreate={createProvider}
      />

      <ProviderEditDialog
        key={editingProvider?.id ?? "provider-edit-closed"}
        provider={editingProvider}
        columns={columns}
        columnOptions={columnOptions}
        onClose={() => setEditingProvider(null)}
        onSave={(patch) =>
          editingProvider ? patchProvider(editingProvider.id, patch) : Promise.resolve()
        }
      />
    </main>
  );
}
