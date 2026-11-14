"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useBodyScrollLock } from "@/app/(authed)/_shared/useBodyScrollLock";
import type {
  LicensingAppointment,
  LicensingCarrierOption,
  LicensingProduct,
} from "@/lib/health-licensing/types";
import { US_STATES } from "@/lib/us-states";
import { CARRIER_CHIP_CLASS, CarrierChip, carrierChipStyle } from "./CarrierChip";
import {
  BADGE,
  GHOST_BUTTON,
  LABEL,
  PanelTab,
  PRIMARY_BUTTON,
  RecordDialog,
  STATUS_PILL,
} from "./dialog-chrome";
import { HistoryFeed } from "./HistoryFeed";
import { formatDay, formatTimestamp, STATUS_LABEL } from "./licensing-view";

type Selection = Record<string, string[]>;

function selectionFrom(products: readonly LicensingProduct[], inState: readonly LicensingAppointment[]): Selection {
  const out: Selection = {};
  for (const p of products) out[p.columnId] = inState.filter((a) => a.columnId === p.columnId).map((a) => a.optionId);
  return out;
}

/**
 * Chi tiết một bang, khung y như dialog sửa Provider: mỗi sản phẩm là một ô chọn
 * nhiều, chip hãng mang màu cấu hình ở Table Configuration. Bấm chip mở chi tiết
 * hãng (trạng thái, ngày, ghi chú, agent).
 */
export function StateDetailDialog({
  stateCode,
  appointments,
  products,
  options,
  canManage,
  historyVersion,
  onClose,
  onOpen,
  onSaved,
}: {
  stateCode: string;
  appointments: readonly LicensingAppointment[];
  products: readonly LicensingProduct[];
  options: readonly LicensingCarrierOption[];
  canManage: boolean;
  historyVersion: number;
  onClose: () => void;
  onOpen: (appointment: LicensingAppointment) => void;
  onSaved: (message: string) => void;
}) {
  useBodyScrollLock(true);
  const inState = useMemo(() => appointments.filter((a) => a.stateCode === stateCode), [appointments, stateCode]);
  const saved = useMemo(() => selectionFrom(products, inState), [products, inState]);
  const [draft, setDraft] = useState<Selection>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activityCount, setActivityCount] = useState<number | null>(null);

  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const appointmentByOption = useMemo(() => new Map(inState.map((a) => [a.optionId, a])), [inState]);
  const changes = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const p of products) {
      const before = new Set(saved[p.columnId] ?? []);
      const after = new Set(draft[p.columnId] ?? []);
      for (const id of after) if (!before.has(id)) added++;
      for (const id of before) if (!after.has(id)) removed++;
    }
    return { added, removed };
  }, [products, saved, draft]);
  const dirty = changes.added + changes.removed > 0;

  const count = (status: LicensingAppointment["status"]) => inState.filter((a) => a.status === status).length;
  const live = inState.filter((a) => a.status !== "terminated");
  const agentCount = new Set(inState.flatMap((a) => a.agents.map((agent) => agent.accountId))).size;
  const lastEdited = inState.filter((a) => a.updatedByName).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const changed: Selection = {};
      for (const p of products) {
        const before = [...(saved[p.columnId] ?? [])].sort().join();
        const after = [...(draft[p.columnId] ?? [])].sort().join();
        if (before !== after) changed[p.columnId] = draft[p.columnId] ?? [];
      }
      const response = await fetch(`/api/health-licensing/states/${stateCode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: changed }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not save. Try again.");
        return;
      }
      onSaved("Changes saved");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const subtitle = (
    <>
      <span className="font-mono font-semibold text-[#44546f]">{stateCode}</span>
      <span className={`${BADGE} ${STATUS_PILL.active}`}>{count("active")} active</span>
      {count("pending") ? <span className={`${BADGE} ${STATUS_PILL.pending}`}>{count("pending")} pending</span> : null}
      {count("terminated") ? (
        <span className={`${BADGE} ${STATUS_PILL.terminated}`}>{count("terminated")} terminated</span>
      ) : null}
      <span aria-hidden="true" className="text-[#c1c7d0]">·</span>
      <span>{new Set(live.map((a) => a.carrier)).size} carriers</span>
      <span aria-hidden="true" className="text-[#c1c7d0]">·</span>
      <span>
        {agentCount} agent{agentCount === 1 ? "" : "s"}
      </span>
      {lastEdited?.updatedByName ? (
        <>
          <span aria-hidden="true" className="text-[#c1c7d0]">·</span>
          <span title={formatTimestamp(lastEdited.updatedAt)}>
            Edited <time suppressHydrationWarning>{formatTimestamp(lastEdited.updatedAt).split(",").slice(0, 2).join(",")}</time>{" "}
            by {lastEdited.updatedByName}
          </span>
        </>
      ) : null}
    </>
  );

  const footer = (
    <>
      {dirty ? (
        <span className="text-sm text-[#626f86]">
          {[changes.added ? `${changes.added} to add` : "", changes.removed ? `${changes.removed} to remove` : ""]
            .filter(Boolean)
            .join(" · ")}
        </span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {canManage ? (
          <>
            <button type="button" onClick={onClose} disabled={busy} className={GHOST_BUTTON}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={PRIMARY_BUTTON}>
              {busy ? "Saving…" : "Save changes"}
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className={GHOST_BUTTON}>
            Close
          </button>
        )}
      </div>
    </>
  );

  return (
    <RecordDialog
      label={`${US_STATES[stateCode] ?? stateCode} licensing`}
      title={US_STATES[stateCode] ?? stateCode}
      subtitle={subtitle}
      busy={busy}
      onClose={onClose}
      footer={footer}
      panel={
        <>
          <PanelTab label="Activity" count={activityCount} />
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <HistoryFeed stateCode={stateCode} version={historyVersion} onCount={(n) => setActivityCount(n)} />
          </div>
        </>
      }
    >
      {/* Mỗi sản phẩm một hàng: nhãn trái, ô chọn hãng chiếm phần còn lại — lưới
          2 cột để trống ô lẻ (UHC) và cao lệch nhau khi một ô nhiều hãng. */}
      <div className="divide-y divide-[#ebecf0]">
        {products.map((product) => {
          const chosen = draft[product.columnId]?.length ?? 0;
          return (
            <div
              key={product.columnId}
              className="grid grid-cols-1 gap-1.5 py-2.5 first:pt-0 last:pb-0 md:grid-cols-[200px_minmax(0,1fr)] md:items-start md:gap-4"
            >
              <div className="flex items-center gap-2 md:min-h-9">
                <span className={`${LABEL} !mb-0`}>{product.label}</span>
                <span className="rounded-full bg-[#f1f2f4] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-[#626f86]">
                  {chosen}
                </span>
              </div>
              <CarrierMultiField
                selected={draft[product.columnId] ?? []}
                options={options.filter((o) => o.columnId === product.columnId)}
                optionById={optionById}
                appointmentByOption={appointmentByOption}
                canEdit={canManage && !busy}
                dirty={dirty}
                onChange={(ids) => setDraft((cur) => ({ ...cur, [product.columnId]: ids }))}
                onOpen={(appointment) => {
                  if (dirty) {
                    setError("Save or cancel your carrier changes before opening a carrier.");
                    return;
                  }
                  onOpen(appointment);
                }}
              />
            </div>
          );
        })}
        {products.length === 0 ? (
          <p className="text-sm text-[#626f86]">No products yet. Add them in Table Configuration → State Licensing Map.</p>
        ) : null}
      </div>
      {canManage && products.length ? (
        <p className="mt-4 text-xs text-[#6b778c]">
          Click a carrier for its status, date, note and agents. New carriers save as Active.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]">
          {error}
        </p>
      ) : null}
    </RecordDialog>
  );
}

/** Ô chọn nhiều kiểu ACA plans của Provider: chip màu trong khung, bấm khung để mở danh sách. */
/** Chiều cao gần đúng của menu: ô tìm + danh sách max-h-60 + link cuối. */
const MENU_HEIGHT = 340;

function CarrierMultiField({
  selected,
  options,
  optionById,
  appointmentByOption,
  canEdit,
  dirty,
  onChange,
  onOpen,
}: {
  selected: string[];
  options: readonly LicensingCarrierOption[];
  optionById: ReadonlyMap<string, LicensingCarrierOption>;
  appointmentByOption: ReadonlyMap<string, LicensingAppointment>;
  canEdit: boolean;
  dirty: boolean;
  onChange: (ids: string[]) => void;
  onOpen: (appointment: LicensingAppointment) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const chosen = new Set(selected);
  const ordered = options.filter((o) => chosen.has(o.id));
  const q = query.trim().toLowerCase();
  const listed = options.filter((o) => !q || o.label.toLowerCase().includes(q));

  function toggle(id: string) {
    onChange(chosen.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  }

  // Ô ở cuối dialog: mở xuống thì bị vùng cuộn của dialog cắt mất, nên đo chỗ
  // trống trong khung cuộn gần nhất rồi mở lên khi bên dưới không đủ.
  const [dropUp, setDropUp] = useState(false);
  function toggleMenu() {
    if (!open && wrapRef.current) {
      const box = wrapRef.current.getBoundingClientRect();
      let top = 0;
      let bottom = window.innerHeight;
      for (let parent = wrapRef.current.parentElement; parent; parent = parent.parentElement) {
        const overflowY = getComputedStyle(parent).overflowY;
        if (overflowY === "auto" || overflowY === "scroll" || overflowY === "hidden") {
          const frame = parent.getBoundingClientRect();
          top = Math.max(top, frame.top);
          bottom = Math.min(bottom, frame.bottom);
          break;
        }
      }
      const below = bottom - box.bottom;
      const above = box.top - top;
      setDropUp(below < MENU_HEIGHT && above > below);
    }
    setOpen((cur) => !cur);
  }

  return (
    <div ref={wrapRef} className="relative">
      <div
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
        aria-expanded={canEdit ? open : undefined}
        onClick={() => canEdit && toggleMenu()}
        onKeyDown={(event) => {
          if (canEdit && (event.key === "Enter" || event.key === " ") && event.target === event.currentTarget) {
            event.preventDefault();
            toggleMenu();
          }
        }}
        className={`flex min-h-9 w-full items-center gap-2 rounded-lg border-2 bg-white px-2 py-1 text-left text-sm font-semibold outline-none transition max-md:min-h-11 ${
          open ? "border-[#0c66e4]" : "border-[#dfe1e6]"
        } ${canEdit ? "cursor-pointer hover:border-[#c1c7d0] focus-visible:border-[#0c66e4]" : "bg-[#f4f5f7]"}`}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {ordered.length ? (
            ordered.map((option) => {
              const appointment = appointmentByOption.get(option.id);
              const details = appointment
                ? [
                    appointment.status !== "active" ? STATUS_LABEL[appointment.status] : "",
                    appointment.appointedOn ? `Appointed ${formatDay(appointment.appointedOn)}` : "",
                    appointment.agents.length ? `${appointment.agents.length} agent(s)` : "",
                    appointment.note ?? "",
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "Not saved yet";
              return (
                <CarrierChip
                  key={option.id}
                  option={option}
                  status={appointment?.status}
                  title={appointment ? `${details || "Active"} — click for details` : details}
                  onClick={appointment && !dirty ? () => onOpen(appointment) : undefined}
                  trailing={
                    canEdit ? (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Remove ${option.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(option.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.stopPropagation();
                            toggle(option.id);
                          }
                        }}
                        className="-mr-0.5 ml-0.5 rounded-sm opacity-60 hover:opacity-100"
                      >
                        <X className="h-3 w-3" strokeWidth={3} />
                      </span>
                    ) : null
                  }
                />
              );
            })
          ) : (
            <span className="font-normal text-[#97a0af]">{canEdit ? "Select carriers" : "—"}</span>
          )}
        </div>
        {canEdit ? <ChevronDown className="h-4 w-4 shrink-0 text-[#626f86]" /> : null}
      </div>

      {open ? (
        <div
          className={`absolute left-0 right-0 z-20 overflow-hidden rounded-lg border border-[#dfe1e6] bg-white shadow-[0_8px_24px_rgba(9,30,66,0.18)] ${
            dropUp ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
          }`}
        >
          <div className="relative border-b border-[#ebecf0] p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#626f86]" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search carriers"
              aria-label="Search carriers"
              className="h-8 w-full rounded border border-[#dfe1e6] pl-8 pr-2 text-sm outline-none focus:border-[#0c66e4]"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {listed.map((option) => {
              const on = chosen.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggle(option.id)}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left hover:bg-[#f4f5f7] max-md:h-11"
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      on ? "border-[#0c66e4] bg-[#0c66e4] text-white" : "border-[#c1c7d0] bg-white"
                    }`}
                  >
                    {on ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                  </span>
                  <span className={CARRIER_CHIP_CLASS} style={carrierChipStyle(option)}>
                    {option.label}
                  </span>
                </button>
              );
            })}
            {listed.length === 0 ? (
              <p className="px-2 py-2 text-sm text-[#97a0af]">
                {options.length ? "No carrier matches." : "No carriers yet. Add them in Table Configuration."}
              </p>
            ) : null}
          </div>
          <Link
            href="/config?scope=licensing"
            className="block border-t border-[#ebecf0] px-3 py-2 text-xs font-semibold text-[#0c66e4] hover:bg-[#e9f2ff]"
          >
            Manage carriers in Table Configuration
          </Link>
        </div>
      ) : null}
      {/* optionById giữ chip của hãng đã bị archive giữa chừng khỏi bị mất nhãn. */}
      {selected.some((id) => !optionById.has(id)) ? (
        <p className="mt-1 text-xs text-[#bf2600]">A selected carrier was removed in Table Configuration.</p>
      ) : null}
    </div>
  );
}
