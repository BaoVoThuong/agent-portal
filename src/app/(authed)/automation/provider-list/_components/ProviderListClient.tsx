"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { resolveLayout, serializeLayout, type LayoutEntry } from "@/lib/table-config/layout";
import {
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
import { isPortalRow, type ProviderRow } from "@/lib/providers/types";
import { AddProviderDialog } from "./AddProviderDialog";
import { ProviderTable } from "./ProviderTable";
import { ProviderTableSettingsButton } from "./ProviderTableSettingsButton";
import { ProviderToolbar } from "./ProviderToolbar";

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
  const [hiddenColumnKeys, setHiddenColumnKeys] = useState<Set<string>>(() => new Set());
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [addOpen, setAddOpen] = useState(false);
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
        setHiddenColumnKeys(
          new Set(
            resolved
              .filter((column) => column.hidden && !column.hidden_default && !column.pinned)
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
            hidden: !column.hidden_default && !column.pinned && hiddenKeys.has(column.key),
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

  const rows = useMemo(() => {
    const filtered = filterProviders(applyProviderFilters(providers, filters), query);
    return sortKey ? sortProviders(filtered, sortKey, sortDir) : filtered;
  }, [providers, filters, query, sortKey, sortDir]);

  const manualCount = useMemo(
    () => providers.filter((provider) => isPortalRow(provider)).length,
    [providers]
  );

  async function patchProvider(id: string, patch: Record<string, unknown>) {
    const response = await fetch(`/api/automation/provider-list/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as
      | { provider?: ProviderRow; warning?: string; error?: string }
      | null;
    if (!response?.ok || !payload?.provider) {
      setNotice({ tone: "error", text: payload?.error ?? "Could not save the change." });
      // Ném lại để ô tự bật viền đỏ và giữ giá trị cũ.
      throw new Error(payload?.error ?? "Could not save the change.");
    }
    const saved = payload.provider;
    setProviders((current) => current.map((row) => (row.id === id ? saved : row)));
    setNotice(payload.warning ? { tone: "info", text: payload.warning } : null);
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
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">Provider List</h1>
              <p className="mt-1 text-xs font-medium text-[#6b778c]">
                {providers.length} providers · {manualCount} added in the portal ·{" "}
                {providers.length - manualCount} from the Google Sheet, replaced every
                night at 02:00 CT.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ProviderTableSettingsButton
                columns={layoutColumns}
                hiddenColumnKeys={hiddenColumnKeys}
                onToggleColumn={toggleColumn}
              />
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0c66e4] px-4 text-sm font-bold text-white transition hover:bg-[#0055cc]"
              >
                <Plus className="h-4 w-4" /> Add address
              </button>
            </div>
          </header>

          <ProviderToolbar
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

      <div className="min-h-0 min-w-0 flex-1 px-6 pb-6">
        <div className="mx-auto flex h-full min-h-0 max-w-[1760px] flex-col gap-2">
          <ProviderTable
            providers={rows.slice(0, visibleCount)}
            columns={visibleColumns}
            columnOptions={columnOptions}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            onPatch={patchProvider}
          />
          {rows.length > visibleCount ? (
            <button
              type="button"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
              className="mx-auto rounded-lg border border-[#dfe1e6] bg-white px-4 py-2 text-sm font-bold text-[#42526e] transition hover:border-[#b8c5d6] hover:bg-[#f8fafc]"
            >
              Show more · {visibleCount} of {rows.length}
            </button>
          ) : null}
        </div>
      </div>

      <AddProviderDialog
        open={addOpen}
        columns={columns}
        columnOptions={columnOptions}
        onClose={() => setAddOpen(false)}
        onCreate={createProvider}
      />
    </main>
  );
}
