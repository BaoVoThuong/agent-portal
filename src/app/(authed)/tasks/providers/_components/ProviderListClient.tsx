"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Download, Plus, Upload } from "lucide-react";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { resolveLayout, serializeLayout, type LayoutEntry } from "@/lib/table-config/layout";
import { saveUserTableLayout } from "@/lib/table-config/save-layout";
import {
  initialHiddenProviderColumnKeys,
  toggleHiddenProviderListColumn,
  visibleProviderListColumns,
} from "@/lib/providers/list-columns";
import {
  DEFAULT_PROVIDER_FILTERS,
  applyProviderFilters,
  filterProviders,
  keepCitiesInSelectedStates,
  providerFacetOptions,
  providerFilterOptions,
  sortProviders,
  type ProviderFilters,
  type ProviderSortDir,
} from "@/lib/providers/search";
import type { ProviderRow } from "@/lib/providers/types";
import type { TaskAssignee } from "@/lib/tasks/assignees";
import { providerCarrierOptions } from "@/lib/providers/carriers";
import { AddProviderDialog } from "./AddProviderDialog";
import { ProviderImportDialog } from "./ProviderImportDialog";
import { ProviderTable } from "./ProviderTable";
import { ProviderEditDialog, type ProviderReviewAction } from "./ProviderEditDialog";
import {
  PAGE_ACTIONS_CLASS,
  PAGE_HEADER_CLASS,
  PAGE_PRIMARY_BUTTON_CLASS,
  PAGE_TITLE_CLASS,
  pageSecondaryButtonClass,
} from "../../../_shared/page-header-styles";
import { ProviderTableSettingsButton } from "./ProviderTableSettingsButton";
import { ProviderToolbar, type ProviderView } from "./ProviderToolbar";
// Dựng lại CHÍNH component của Provider Finder, không chép code sang đây.
// Trang riêng `/automation/provider-finder` đã bị ẩn (chỉ còn chuyển hướng về
// đây), nên tab này là lối vào DUY NHẤT của tính năng tìm theo khoảng cách.
import ProviderFinderClient from "./ProviderFinderClient";

/** Opened by + Created date luôn hiện ở tab Backlog: ai gửi, gửi lúc nào. */
const BACKLOG_INFO_COLUMN_KEYS = new Set(["created_by_email", "created_at"]);

/** Dựng dần: 889 dòng × hơn chục cột là quá nhiều nút DOM cho một lần vẽ. */
const PAGE_SIZE = 200;

export function ProviderListClient({
  initialProviders,
  initialBacklog,
  loadError,
  columns,
  columnOptions,
  viewerName,
  currentEmail,
  people,
  canExport,
  canImport,
  canManage,
  canAdd,
  canReview,
}: {
  initialProviders: ProviderRow[];
  /** Dòng chờ duyệt (`pending`) — tab Backlog. */
  initialBacklog: ProviderRow[];
  loadError: string | null;
  columns: TableColumn[];
  columnOptions: TableColumnOption[];
  /** Tên người đang đăng nhập, để form điền sẵn Verified by khi đánh dấu đã soát. */
  viewerName: string;
  /** Email người đang đăng nhập (chữ thường), cho phần comment của dialog. */
  currentEmail: string;
  /** Người xem được Provider List — tên + avatar trong form. */
  people: TaskAssignee[];
  /** Hai quyền tách riêng: Export chỉ đọc, Import ghi đè hàng loạt. */
  canExport: boolean;
  canImport: boolean;
  /** Xoá address, và thêm / nhập thẳng vào danh sách — tầng Provider List - Manage. */
  canManage: boolean;
  /** Thêm address. Không có `canManage` thì dòng vào Backlog. */
  canAdd: boolean;
  /** Verify / Update existing / Reject dòng Backlog. */
  canReview: boolean;
}) {
  const [providers, setProviders] = useState<ProviderRow[]>(initialProviders);
  const [backlog, setBacklog] = useState<ProviderRow[]>(initialBacklog);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<ProviderFilters>(DEFAULT_PROVIDER_FILTERS);
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
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editingProvider, setEditingProvider] = useState<ProviderRow | null>(null);
  // Tab nằm trong state, không phải điều hướng: đổi tab mà chạy lại server
  // component thì phải nạp lại cả 889 dòng chỉ để xem ô tìm kiếm theo địa chỉ.
  const [view, setView] = useState<ProviderView>("list");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(
    loadError ? { tone: "error", text: loadError } : null
  );

  // Link từ chuông thông báo: /tasks/providers?provider=<id> mở thẳng dialog của
  // dòng đó — tìm ở danh sách rồi tới Backlog; ?view=backlog mở tab Backlog.
  // Bảng đã nạp đủ mọi dòng còn hoạt động, nên không cần gọi API; không thấy là
  // dòng đã bị xoá. Xong thì bỏ tham số để đóng dialog không mở lại.
  const searchParams = useSearchParams();
  const linkedProviderId = searchParams.get("provider");
  const linkedView = searchParams.get("view");
  useEffect(() => {
    if (!linkedProviderId && linkedView !== "backlog") return;
    const inList = linkedProviderId
      ? providers.find((provider) => provider.id === linkedProviderId)
      : undefined;
    const inBacklog = linkedProviderId
      ? backlog.find((provider) => provider.id === linkedProviderId)
      : undefined;
    const timer = window.setTimeout(() => {
      if (linkedProviderId) {
        setView(inBacklog ? "backlog" : "list");
        const linked = inList ?? inBacklog;
        if (linked) setEditingProvider(linked);
        else setNotice({ tone: "info", text: "That provider is no longer in the list." });
      } else {
        setView("backlog");
      }
      // Chỉ bỏ param đã xử lý. Router navigation sẽ chạy lại Server Component
      // và truy vấn hàng nghìn provider ngay lúc người dùng mở dialog.
      const url = new URL(window.location.href);
      url.searchParams.delete("provider");
      url.searchParams.delete("view");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
    // Chỉ chạy khi link đổi, không chạy lại mỗi lần danh sách nạp lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedProviderId, linkedView]);

  const nameByEmail = useMemo(
    () =>
      new Map(
        people.flatMap((person) =>
          person.name?.trim() ? [[person.email, person.name.trim()] as const] : []
        )
      ),
    [people]
  );

  const layoutHydratedRef = useRef(false);
  const layoutUpdatedAtRef = useRef<string | null>(null);
  const layoutSaveSequenceRef = useRef(0);

  // Cài đặt bảng theo từng người, dùng chung API user_table_layout với Task
  // List và Lead Management. `hidden_default` của admin vẫn thắng; đây chỉ là lựa
  // chọn riêng về những cột còn lại.
  // Cờ "đã tải" chỉ bật SAU KHI áp xong layout — xem chú thích cùng chỗ ở
  // LeadsClient: bật trước thì lần chạy bị huỷ làm layout không bao giờ được áp.
  useEffect(() => {
    if (layoutHydratedRef.current) return;
    let alive = true;

    void fetch("/api/config/layout?scope=provider")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { layout?: unknown; updated_at?: unknown } | null) => {
        if (!alive) return;
        layoutHydratedRef.current = true;
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
        const saved = await saveUserTableLayout("provider", layout, layoutUpdatedAtRef.current);
        if (saved.ok && saved.updatedAt) layoutUpdatedAtRef.current = saved.updatedAt;
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
  // Thanh lọc dùng lựa chọn faceted: mỗi ô chỉ còn giá trị có dòng khớp các bộ
  // lọc còn lại. Tab Finder vẫn cần đủ mọi giá trị nên giữ `filterOptions`.
  const facetOptions = useMemo(
    () => providerFacetOptions(providers, filters),
    [providers, filters]
  );
  const finderCarrierOptions = useMemo(
    () => providerCarrierOptions(providers),
    [providers]
  );

  const rows = useMemo(() => {
    const filtered = filterProviders(applyProviderFilters(providers, filters), query);
    return sortKey ? sortProviders(filtered, sortKey, sortDir) : filtered;
  }, [providers, filters, query, sortKey, sortDir]);

  // Backlog chỉ có ô tìm kiếm: vài chục dòng chờ duyệt không cần bộ lọc.
  const backlogRows = useMemo(() => {
    const filtered = filterProviders(backlog, query);
    return sortKey ? sortProviders(filtered, sortKey, sortDir) : filtered;
  }, [backlog, query, sortKey, sortDir]);

  // Cột như danh sách, cộng Opened by + Created date dù người xem đang ẩn chúng:
  // ở Backlog, ai gửi và gửi lúc nào là thứ người duyệt cần trước tiên.
  const backlogColumns = useMemo(() => {
    const shown = new Set(visibleColumns.map((column) => column.key));
    return [
      ...visibleColumns,
      ...layoutColumns.filter(
        (column) =>
          BACKLOG_INFO_COLUMN_KEYS.has(column.key) && !column.archived_at && !shown.has(column.key)
      ),
    ];
  }, [visibleColumns, layoutColumns]);

  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers]
  );

  const views = [
    { key: "list" as const, label: "List" },
    { key: "backlog" as const, label: "Backlog", count: backlog.length },
    { key: "finder" as const, label: "Finder Tool" },
  ];

  const hasMoreRows = visibleCount < rows.length;
  const renderNextRows = useCallback(() => {
    setVisibleCount((current) => Math.min(current + PAGE_SIZE, rows.length));
  }, [rows.length]);

  async function exportRows() {
    if (exporting) return;
    setExporting(true);
    try {
      // Gửi id qua thân request chứ không trên URL: 458 id trong query string
      // là vượt giới hạn độ dài và server trả 431.
      const response = await fetch("/api/automation/provider-list/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: visibleColumns.map((column) => column.key),
          ids: rows.map((row) => row.id),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not export the file.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "provider-list.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setNotice({
        tone: "error",
        text: exportError instanceof Error ? exportError.message : "Could not export the file.",
      });
    } finally {
      setExporting(false);
    }
  }

  /** Nhập xong thì nạp lại cả bảng: dòng mới và dòng vừa sửa không nằm trong state cũ. */
  async function reloadProviders() {
    const response = await fetch("/api/automation/provider-list").catch(() => null);
    const payload = await response?.json().catch(() => null);
    if (!response?.ok || !payload?.providers) {
      setNotice({
        tone: "error",
        text: "Import finished, but the table could not reload. Refresh the page.",
      });
      return;
    }
    setProviders(payload.providers as ProviderRow[]);
    setBacklog((payload.backlog ?? []) as ProviderRow[]);
  }

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
    // Dòng nằm ở danh sách hoặc ở Backlog; thay đúng chỗ nó đang ở.
    setProviders((current) => current.map((row) => (row.id === id ? saved : row)));
    setBacklog((current) => current.map((row) => (row.id === id ? saved : row)));
    setEditingProvider((current) => current?.id === id ? saved : current);
    setNotice(null);
    return saved;
  }

  /** Xoá = archive: dòng biến khỏi bảng nhưng vẫn nằm trong database. */
  async function archiveProvider(id: string) {
    const response = await fetch(`/api/automation/provider-list/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response?.ok) {
      throw new Error(payload?.error ?? "Could not archive the address.");
    }
    const wasPending = backlog.some((row) => row.id === id);
    setProviders((current) => current.filter((row) => row.id !== id));
    setBacklog((current) => current.filter((row) => row.id !== id));
    setNotice({ tone: "info", text: wasPending ? "Withdrawn from the Backlog." : "Address archived." });
  }

  /** Verify / Update existing / Reject một dòng Backlog — xem review/route.ts. */
  async function reviewProvider(id: string, action: ProviderReviewAction, reason?: string) {
    const response = await fetch(`/api/automation/provider-list/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    }).catch(() => null);
    const payload = (await response?.json().catch(() => null)) as
      | { provider?: ProviderRow; removedBacklogId?: string; error?: string }
      | null;
    if (!response?.ok) {
      throw new Error(payload?.error ?? "Could not review this row.");
    }
    setBacklog((current) => current.filter((row) => row.id !== id));
    const reviewed = payload?.provider;
    if (reviewed) {
      // Verify: dòng mới vào danh sách. Update existing: dòng cũ vừa được sửa.
      setProviders((current) =>
        current.some((row) => row.id === reviewed.id)
          ? current.map((row) => (row.id === reviewed.id ? reviewed : row))
          : [reviewed, ...current]
      );
    }
    setNotice({
      tone: "info",
      text:
        action === "approve"
          ? "Verified — the address is in the list."
          : action === "merge"
            ? "The existing address was updated."
            : "Rejected.",
    });
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
    if (created.pending) {
      // Không có Manage: dòng chờ duyệt — đưa người gửi tới đúng chỗ nó nằm.
      setBacklog((current) => [created, ...current]);
      setView("backlog");
      setNotice({ tone: "info", text: "Sent to the Backlog. A manager verifies it before it shows in the list." });
      return;
    }
    setProviders((current) => [created, ...current]);
    setNotice({ tone: "info", text: "Address added." });
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d]">
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className={PAGE_HEADER_CLASS}>
            <div>
              <h1 className={PAGE_TITLE_CLASS}>
                Provider List
              </h1>
            </div>
            <div className={PAGE_ACTIONS_CLASS}>
              {/* Nút này chỉ có nghĩa với bảng; tab tìm theo địa chỉ không thêm
                  dòng. Nút chọn cột đã xuống cuối hàng lọc bên dưới. */}
              {view === "list" && canExport ? (
                <button
                  type="button"
                  onClick={() => void exportRows()}
                  disabled={exporting || rows.length === 0}
                  className={pageSecondaryButtonClass()}
                >
                  <Download className="h-4 w-4" />
                  {exporting ? "Exporting…" : "Export"}
                </button>
              ) : null}
              {view !== "finder" && canImport ? (
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className={pageSecondaryButtonClass()}
                >
                  <Upload className="h-4 w-4" /> Import
                </button>
              ) : null}
              {view !== "finder" && canAdd ? (
                <button
                  type="button"
                  onClick={() => setAddOpen(true)}
                  className={PAGE_PRIMARY_BUTTON_CLASS}
                >
                  <Plus className="h-4 w-4" /> Add address
                </button>
              ) : null}
            </div>
          </header>

          <ProviderToolbar
            views={views}
            view={view}
            onViewChange={setView}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              setVisibleCount(PAGE_SIZE);
            }}
            filters={filters}
            onFilters={(next) => {
              setFilters(keepCitiesInSelectedStates(providers, next));
              setVisibleCount(PAGE_SIZE);
            }}
            options={facetOptions}
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
                nameByEmail={nameByEmail}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={toggleSort}
                onOpenProvider={setEditingProvider}
                hasMore={hasMoreRows}
                onEndReached={renderNextRows}
              />
            </>
          ) : view === "backlog" ? (
            <ProviderTable
              providers={backlogRows}
              columns={backlogColumns}
              columnOptions={columnOptions}
              nameByEmail={nameByEmail}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={toggleSort}
              onOpenProvider={setEditingProvider}
              emptyText={query ? "No Backlog rows match the current search." : "Nothing is waiting for review."}
              renderTag={(provider) =>
                provider.duplicate_of ? (
                  <span
                    title="Matches an address already in the list"
                    className="rounded bg-[#ffece0] px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.02em] text-[#a54800]"
                  >
                    Duplicate
                  </span>
                ) : null
              }
            />
          ) : (
            <ProviderFinderClient
              carrierOptions={finderCarrierOptions}
              stateOptions={filterOptions.state}
              cityOptions={filterOptions.city}
            />
          )}
        </div>
      </div>

      <ProviderImportDialog
        key={importOpen ? "provider-import-open" : "provider-import-closed"}
        open={importOpen}
        columns={columns}
        viewerName={viewerName}
        goesToBacklog={!canManage}
        onClose={() => setImportOpen(false)}
        onImported={(result) => {
          void reloadProviders();
          if (result.submitted > 0) setView("backlog");
        }}
      />

      <AddProviderDialog
        // Dựng lại form mỗi lần mở: ngày trong ô Verified date phải là ngày mở
        // form, không phải ngày tab này được nạp lần đầu.
        key={addOpen ? "provider-add-open" : "provider-add-closed"}
        open={addOpen}
        columns={columns}
        columnOptions={columnOptions}
        viewerName={viewerName}
        people={people}
        goesToBacklog={!canManage}
        onClose={() => setAddOpen(false)}
        onCreate={createProvider}
      />

      <ProviderEditDialog
        key={editingProvider?.id ?? "provider-edit-closed"}
        provider={editingProvider}
        columns={columns}
        columnOptions={columnOptions}
        viewerName={viewerName}
        currentEmail={currentEmail}
        people={people}
        canReview={canReview}
        duplicateOf={
          editingProvider?.duplicate_of
            ? providerById.get(editingProvider.duplicate_of) ?? null
            : null
        }
        onClose={() => setEditingProvider(null)}
        onSave={(patch) =>
          editingProvider
            ? patchProvider(editingProvider.id, patch)
            : Promise.reject(new Error("The provider is no longer open."))
        }
        onArchive={
          editingProvider &&
          // Dòng Backlog: người gửi rút lại được; người duyệt dùng Reject.
          (editingProvider.pending
            ? !canReview &&
              editingProvider.created_by_email?.trim().toLowerCase() === currentEmail
            : canManage)
            ? () => archiveProvider(editingProvider.id)
            : undefined
        }
        onReview={
          editingProvider?.pending && canReview
            ? (action, reason) => reviewProvider(editingProvider.id, action, reason)
            : undefined
        }
        onOpenProvider={setEditingProvider}
      />
    </main>
  );
}
