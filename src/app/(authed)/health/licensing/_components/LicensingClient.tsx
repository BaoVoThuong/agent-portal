"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Columns3, History, Plus } from "lucide-react";
import {
  PAGE_ACTIONS_CLASS,
  PAGE_HEADER_WITH_SUBTITLE_CLASS,
  PAGE_PRIMARY_BUTTON_CLASS,
  PAGE_TITLE_CLASS,
  pageSecondaryButtonClass,
} from "@/app/(authed)/_shared/page-header-styles";
import { Toast, type ToastTone } from "@/app/(authed)/_shared/Toast";
import { useBodyScrollLock } from "@/app/(authed)/_shared/useBodyScrollLock";
import type {
  LicensingAgentOption,
  LicensingAppointment,
  LicensingBoard,
} from "@/lib/health-licensing/types";
import { US_STATES } from "@/lib/us-states";
import { AppointmentDialog } from "./AppointmentDialog";
import { CarrierChip } from "./CarrierChip";
import { GHOST_BUTTON, RecordDialog } from "./dialog-chrome";
import { HistoryFeed } from "./HistoryFeed";
import { LicensingMap } from "./LicensingMap";
import {
  carrierCounts,
  DEFAULT_FILTERS,
  formatDay,
  formatTimestamp,
  isNarrowed,
  narrowMatches,
  stateFills,
  STATUS_LABEL,
  tableStates,
  visibleAppointments,
  type LicensingFilters,
} from "./licensing-view";
import { LicensingToolbar, type LicensingView } from "./LicensingToolbar";
import { StateDetailDialog } from "./StateDetailDialog";
import {
  CARD,
  EMPTY_BOX,
  TD,
  TH,
} from "./styles";

type Modal =
  | { type: "state"; stateCode: string }
  | { type: "edit"; appointment: LicensingAppointment | null; preset?: { stateCode?: string; columnId?: string }; back: string | null }
  | { type: "history" }
  | null;

export default function LicensingClient({
  canManage,
  initialBoard,
  initialAgents,
}: {
  canManage: boolean;
  initialBoard: LicensingBoard;
  initialAgents: LicensingAgentOption[];
}) {
  const [board, setBoard] = useState(initialBoard);
  const [agents, setAgents] = useState(initialAgents);
  const [view, setView] = useState<LicensingView>("map");
  const [filters, setFilters] = useState<LicensingFilters>(DEFAULT_FILTERS);
  const [modal, setModal] = useState<Modal>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [toast, setToast] = useState<{ message: string; tone: ToastTone } | null>(null);

  const { products, options, appointments } = board;
  const activeProducts = products;
  const visible = useMemo(
    () => visibleAppointments(appointments, products, filters, US_STATES),
    [appointments, products, filters],
  );
  const states = useMemo(() => tableStates(visible, products, filters, US_STATES), [visible, products, filters]);
  const fills = useMemo(() => stateFills(appointments, products, filters, US_STATES), [appointments, products, filters]);
  const carriers = useMemo(
    () => carrierCounts(appointments, products, filters, US_STATES),
    [appointments, products, filters],
  );
  const carrierNames = useMemo(() => [...new Set(options.map((o) => o.label))].sort((a, b) => a.localeCompare(b)), [options]);
  const columns = activeProducts.filter((p) => filters.products.length === 0 || filters.products.includes(p.columnId));
  const totalStates = useMemo(
    () =>
      new Set(
        appointments
          .filter((a) => a.status !== "terminated")
          .map((a) => a.stateCode),
      ).size,
    [appointments],
  );
  const filterOptions = useMemo(() => {
    const stateCodes = [...new Set(appointments.map((a) => a.stateCode))].sort((a, b) =>
      (US_STATES[a] ?? a).localeCompare(US_STATES[b] ?? b),
    );
    const agentNames = new Map<string, string>();
    for (const a of appointments) for (const agent of a.agents) agentNames.set(agent.accountId, agent.name);
    return {
      states: stateCodes.map((code) => ({ value: code, label: `${US_STATES[code] ?? code} (${code})`, keywords: [code] })),
      products: activeProducts.map((p) => ({ value: p.columnId, label: p.label })),
      carriers: carrierNames.map((c) => ({ value: c, label: c })),
      agents: [...agentNames.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([value, label]) => ({ value, label })),
    };
  }, [appointments, activeProducts, carrierNames]);
  const narrowed = isNarrowed(filters);
  const matchCtx = { activeProducts: new Set<string>(), stateNames: US_STATES };

  const refresh = useCallback(async () => {
    const response = await fetch("/api/health-licensing", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as {
      board?: LicensingBoard;
      agents?: LicensingAgentOption[];
      error?: string;
    };
    if (!response.ok || !payload.board) {
      setToast({ message: payload.error ?? "Could not reload the map. Refresh the page.", tone: "error" });
      return;
    }
    setBoard(payload.board);
    if (payload.agents) setAgents(payload.agents);
    setHistoryVersion((v) => v + 1);
  }, []);

  async function afterSave(message: string, back: string | null) {
    setModal(back ? { type: "state", stateCode: back } : null);
    setToast({ message, tone: "success" });
    await refresh();
  }

  function openAppointment(appointment: LicensingAppointment) {
    setModal({ type: "edit", appointment, back: null });
  }

  const backState = modal?.type === "state" ? modal.stateCode : null;
  const selectedState =
    modal?.type === "state" ? modal.stateCode : modal && "back" in modal && modal.back ? modal.back : null;

  const chip = (a: LicensingAppointment) => {
    const hit = narrowed && narrowMatches(a, filters, matchCtx);
    const title = [
      a.status !== "active" ? STATUS_LABEL[a.status] : "",
      a.appointedOn ? `Appointed ${formatDay(a.appointedOn)}` : "",
      a.agents.length ? `${a.agents.length} agent(s)` : "",
      a.note ?? "",
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <CarrierChip
        key={a.id}
        option={{ id: a.optionId, label: a.carrier, color: a.color }}
        status={a.status}
        highlighted={hit}
        title={title || undefined}
        onClick={() => openAppointment(a)}
        trailing={
          a.agents.length ? (
            <span className="ml-0.5 rounded-sm bg-white/70 px-1 text-[10px] font-bold tabular-nums">{a.agents.length}</span>
          ) : null
        }
      />
    );
  };

  const cell = (stateCode: string, columnId: string) =>
    visible.filter((a) => a.stateCode === stateCode && a.columnId === columnId);

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7f9fc] text-[#172b4d] max-md:h-auto max-md:min-h-full max-md:overflow-visible">
      <div className="min-w-0 shrink-0 px-6 pb-4 pt-5 max-md:px-3 max-md:pb-3 max-md:pt-3">
        <div className="mx-auto flex max-w-[1760px] flex-col gap-3">
          <header className={PAGE_HEADER_WITH_SUBTITLE_CLASS}>
            <div>
              <h1 className={PAGE_TITLE_CLASS}>State Licensing Map</h1>
              {board.lastUpdate ? (
                <p className="mt-1 text-sm text-[#6b778c]">
                  {/* Giờ định dạng theo múi giờ máy: server (UTC trên Vercel) và
                      trình duyệt ra chuỗi khác nhau, nên bỏ cảnh báo hydrate. */}
                  Last updated <time suppressHydrationWarning>{formatTimestamp(board.lastUpdate.at)}</time>
                  {board.lastUpdate.actorName ? (
                    <>
                      {" "}
                      by <span className="font-semibold text-[#44546f]">{board.lastUpdate.actorName}</span>
                    </>
                  ) : null}
                </p>
              ) : null}
            </div>
            <div className={PAGE_ACTIONS_CLASS}>
              <button type="button" className={pageSecondaryButtonClass()} onClick={() => setModal({ type: "history" })}>
                <History className="h-4 w-4" />
                History
              </button>
              {canManage ? (
                <>
                  {/* Sản phẩm (cột) và hãng (giá trị + màu) quản ở Table Configuration. */}
                  <Link href="/config?scope=licensing" className={pageSecondaryButtonClass()}>
                    <Columns3 className="h-4 w-4" />
                    Products &amp; carriers
                  </Link>
                  <button
                    type="button"
                    className={PAGE_PRIMARY_BUTTON_CLASS}
                    onClick={() => setModal({ type: "edit", appointment: null, back: null })}
                  >
                    <Plus className="h-4 w-4" />
                    Add appointment
                  </button>
                </>
              ) : null}
            </div>
          </header>

          <LicensingToolbar
            view={view}
            onViewChange={setView}
            tableCount={states.length}
            filters={filters}
            onFilters={setFilters}
            options={filterOptions}
            resultCount={states.length}
            totalCount={totalStates}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 px-6 pb-6 max-md:px-3 max-md:pb-4">
        <div className="mx-auto flex h-full min-h-0 max-w-[1760px] flex-col gap-2">
          {view === "map" ? (
            <div className="flex min-h-0 flex-1 gap-3 max-md:flex-col">
              <section className={`${CARD} flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden max-md:min-h-[260px]`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#ebecf0] px-4 py-2.5 text-xs font-semibold text-[#6b778c]">
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-3 w-3 rounded-sm bg-[#579dff]" />
                    Active
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ background: "repeating-linear-gradient(45deg,#85b8ff 0 3px,#e9f2ff 3px 6px)" }}
                    />
                    Pending only
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <i className="inline-block h-3 w-3 rounded-sm bg-[#e4e8ee]" />
                    Not licensed
                  </span>
                  <span className="ml-auto font-medium max-md:hidden">Click a state for details</span>
                </div>
                <LicensingMap
                  fills={fills}
                  selected={selectedState}
                  appointments={appointments}
                  products={products}
                  onSelect={(stateCode) => setModal({ type: "state", stateCode })}
                />
              </section>
              <aside className={`${CARD} flex w-[320px] shrink-0 flex-col overflow-hidden max-md:w-full`}>
                <div className="flex items-center justify-between border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
                  <span>Carriers</span>
                  <span>States</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-1 max-md:max-h-[320px]">
                  {carriers
                    .filter((c) => !filters.query.trim() || c.carrier.toLowerCase().includes(filters.query.trim().toLowerCase()))
                    .map((c) => {
                      const on = filters.carriers.includes(c.carrier);
                      return (
                        <button
                          key={c.carrier}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setFilters((f) => ({
                              ...f,
                              carriers: on ? f.carriers.filter((x) => x !== c.carrier) : [...f.carriers, c.carrier],
                            }))
                          }
                          className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition max-md:py-3 ${
                            on ? "bg-[#e9f2ff] font-semibold text-[#0c66e4]" : "font-medium text-[#42526e] hover:bg-[#f4f5f7]"
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{c.carrier}</span>
                          <span className={`tabular-nums ${on ? "" : "text-[#6b778c]"}`}>{c.states}</span>
                        </button>
                      );
                    })}
                  {carriers.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-[#6b778c]">No appointments yet.</p>
                  ) : null}
                </div>
              </aside>
            </div>
          ) : (
            <>
              <div className={`${CARD} flex min-h-0 flex-1 flex-col overflow-hidden max-md:hidden`}>
                <div className="min-h-0 flex-1 overflow-auto">
                  <table className="w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className={`${TH} w-12 text-right`}>No.</th>
                        <th className={`${TH} w-48`}>State</th>
                        {columns.map((p) => (
                          <th key={p.columnId} className={TH}>
                            {p.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {states.map((stateCode, index) => (
                        <tr
                          key={stateCode}
                          className="group cursor-pointer transition hover:bg-[#f7f8f9]"
                          onClick={() => setModal({ type: "state", stateCode })}
                        >
                          <td className={`${TD} text-right tabular-nums text-[#97a0af]`}>{index + 1}</td>
                          <td className={`${TD} whitespace-nowrap`}>
                            <span className="font-mono text-xs font-bold text-[#97a0af]">{stateCode}</span>{" "}
                            <span className="font-semibold text-[#172b4d] group-hover:text-[#0c66e4]">{US_STATES[stateCode]}</span>
                          </td>
                          {columns.map((p) => {
                            const list = cell(stateCode, p.columnId);
                            return (
                              <td key={p.columnId} className={TD}>
                                <div className="flex min-w-0 flex-wrap items-center gap-1">
                                  {list.length ? list.map(chip) : <span className="text-[#c1c7d0]">—</span>}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {states.length === 0 ? <div className={`m-4 ${EMPTY_BOX}`}>No state matches these filters.</div> : null}
                </div>
              </div>
              <div className="hidden flex-col gap-2 max-md:flex">
                {states.map((stateCode) => (
                  <div
                    key={stateCode}
                    className={`${CARD} cursor-pointer p-3`}
                    onClick={() => setModal({ type: "state", stateCode })}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#97a0af]">{stateCode}</span>
                      <span className="text-base font-semibold text-[#172b4d]">{US_STATES[stateCode]}</span>
                    </div>
                    {columns.map((p) => {
                      const list = cell(stateCode, p.columnId);
                      return list.length ? (
                        <div key={p.columnId} className="border-t border-[#ebecf0] py-2">
                          <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">{p.label}</div>
                          <div className="flex flex-wrap gap-1">{list.map(chip)}</div>
                        </div>
                      ) : null;
                    })}
                  </div>
                ))}
                {states.length === 0 ? <div className={EMPTY_BOX}>No state matches these filters.</div> : null}
              </div>
            </>
          )}
        </div>
      </div>

      {modal?.type === "state" ? (
        <StateDetailDialog
          stateCode={modal.stateCode}
          appointments={appointments}
          products={products}
          options={options}
          canManage={canManage}
          historyVersion={historyVersion}
          onClose={() => setModal(null)}
          onOpen={(appointment) => setModal({ type: "edit", appointment, back: backState })}
          onSaved={(message) => void afterSave(message, backState)}
        />
      ) : null}
      {modal?.type === "edit" ? (
        <AppointmentDialog
          appointment={modal.appointment}
          preset={modal.preset}
          products={products}
          options={options}
          appointments={appointments}
          agents={agents}
          canManage={canManage}
          historyVersion={historyVersion}
          onClose={() => setModal(modal.back ? { type: "state", stateCode: modal.back } : null)}
          onSaved={(message) => void afterSave(message, modal.back)}
        />
      ) : null}
      {modal?.type === "history" ? <HistoryDialog version={historyVersion} onClose={() => setModal(null)} /> : null}

      <Toast message={toast?.message ?? null} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </main>
  );
}

function HistoryDialog({ version, onClose }: { version: number; onClose: () => void }) {
  useBodyScrollLock(true);
  return (
    <RecordDialog
      label="Licensing history"
      title="History"
      subtitle={<span>Every change to appointments and product columns.</span>}
      wide={false}
      onClose={onClose}
      footer={
        <button type="button" onClick={onClose} className={`${GHOST_BUTTON} ml-auto`}>
          Close
        </button>
      }
    >
      <HistoryFeed version={version} />
    </RecordDialog>
  );
}
