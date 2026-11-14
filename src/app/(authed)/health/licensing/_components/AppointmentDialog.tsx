"use client";

import { useMemo, useState } from "react";
import { FileSpreadsheet, X } from "lucide-react";
import { useBodyScrollLock } from "@/app/(authed)/_shared/useBodyScrollLock";
import { TaskSelect } from "@/app/(authed)/tasks/_components/TaskSelect";
import type {
  LicensingAgentOption,
  LicensingAppointment,
  LicensingCarrierOption,
  LicensingProduct,
  LicensingStatus,
} from "@/lib/health-licensing/types";
import { US_STATES } from "@/lib/us-states";
import { CARRIER_CHIP_CLASS, CarrierChip, carrierChipStyle } from "./CarrierChip";
import {
  BADGE,
  DANGER_BUTTON,
  GHOST_BUTTON,
  GroupDivider,
  INPUT,
  INVALID_RING,
  LABEL,
  PanelTab,
  PRIMARY_BUTTON,
  ReadOnlyCell,
  RecordDialog,
  SELECT_BUTTON,
  STATUS_PILL,
  TEXTAREA,
} from "./dialog-chrome";
import { HistoryFeed } from "./HistoryFeed";
import { formatDay, formatTimestamp, STATUS_LABEL } from "./licensing-view";
import { avatarColor, initials } from "./styles";

const STATE_OPTIONS = Object.entries(US_STATES)
  .sort((a, b) => a[1].localeCompare(b[1]))
  .map(([code, name]) => ({ value: code, label: `${name} (${code})`, keywords: [code] }));
const STATUS_OPTIONS = (["active", "pending", "terminated"] as const).map((value) => ({
  value,
  label: STATUS_LABEL[value],
}));
const MENU = "min-w-full !z-[200]";

type Draft = {
  stateCode: string;
  columnId: string;
  optionId: string;
  status: LicensingStatus;
  appointedOn: string;
  note: string;
  agents: Array<{ accountId: string; name: string; appointedOn: string }>;
};

const shortDate = (iso: string) => formatTimestamp(iso).split(",").slice(0, 2).join(",");

/** Thêm / xem / sửa một appointment. Khung y như dialog sửa Provider. */
export function AppointmentDialog({
  appointment,
  preset,
  products,
  options,
  appointments,
  agents,
  canManage,
  historyVersion,
  onClose,
  onSaved,
}: {
  /** null = thêm mới. */
  appointment: LicensingAppointment | null;
  preset?: { stateCode?: string; columnId?: string };
  products: readonly LicensingProduct[];
  options: readonly LicensingCarrierOption[];
  /** Để biết hãng nào đã có ở bang đang chọn. */
  appointments: readonly LicensingAppointment[];
  agents: readonly LicensingAgentOption[];
  canManage: boolean;
  historyVersion: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  useBodyScrollLock(true);
  const isNew = appointment === null;
  const readOnly = !canManage;
  const [draft, setDraft] = useState<Draft>(() =>
    appointment
      ? {
          stateCode: appointment.stateCode,
          columnId: appointment.columnId,
          optionId: appointment.optionId,
          status: appointment.status,
          appointedOn: appointment.appointedOn ?? "",
          note: appointment.note ?? "",
          agents: appointment.agents.map((a) => ({ accountId: a.accountId, name: a.name, appointedOn: a.appointedOn ?? "" })),
        }
      : {
          stateCode: preset?.stateCode ?? "",
          columnId: preset?.columnId ?? products[0]?.columnId ?? "",
          optionId: "",
          status: "active",
          appointedOn: "",
          note: "",
          agents: [],
        },
  );
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<"state" | "carrier">>(new Set());
  const [activityCount, setActivityCount] = useState<number | null>(null);

  const productOptions = products.map((p) => ({ value: p.columnId, label: p.label }));
  const productLabel = (columnId: string) => products.find((p) => p.columnId === columnId)?.label ?? "Product";
  const optionById = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  // Hãng của sản phẩm đang chọn; hãng đã có ở bang này thì khoá (mỗi ô một hãng một lần).
  const taken = useMemo(
    () => new Set(appointments.filter((a) => a.stateCode === draft.stateCode).map((a) => a.optionId)),
    [appointments, draft.stateCode],
  );
  const carrierOptions = options
    .filter((o) => o.columnId === draft.columnId)
    .map((o) => ({ value: o.id, label: o.label, disabled: taken.has(o.id) }));

  // Agent đang gắn nhưng không còn là Agent vẫn phải hiện (và bỏ được).
  const agentOptions = useMemo(() => {
    const list = new Map(agents.map((a) => [a.accountId, a.name]));
    for (const a of appointment?.agents ?? []) if (!list.has(a.accountId)) list.set(a.accountId, a.name);
    return [...list.entries()].map(([value, label]) => ({ value, label }));
  }, [agents, appointment]);
  const nameById = useMemo(() => new Map(agentOptions.map((o) => [o.value, o.label])), [agentOptions]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((cur) => ({ ...cur, [key]: value }));
  function setAgentIds(ids: string[]) {
    setDraft((cur) => ({
      ...cur,
      agents: ids.map(
        (id) =>
          cur.agents.find((a) => a.accountId === id) ?? {
            accountId: id,
            name: nameById.get(id) ?? "Former account",
            appointedOn: cur.appointedOn,
          },
      ),
    }));
  }

  async function save() {
    if (isNew) {
      const missing = new Set<"state" | "carrier">();
      if (!draft.stateCode) missing.add("state");
      if (!draft.optionId) missing.add("carrier");
      setInvalid(missing);
      if (missing.size) {
        setError("Fill in the required fields.");
        return;
      }
    }
    setBusy("save");
    setError(null);
    try {
      const details = {
        status: draft.status,
        appointedOn: draft.appointedOn || null,
        note: draft.note,
        agents: draft.agents.map((a) => ({ accountId: a.accountId, appointedOn: a.appointedOn || null })),
      };
      const response = await fetch(
        isNew ? "/api/health-licensing/appointments" : `/api/health-licensing/appointments/${appointment.id}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isNew ? { ...details, stateCode: draft.stateCode, optionId: draft.optionId } : details),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not save. Try again.");
        return;
      }
      onSaved(isNew ? "Appointment added" : "Changes saved");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!appointment) return;
    setBusy("remove");
    setError(null);
    try {
      const response = await fetch(`/api/health-licensing/appointments/${appointment.id}`, { method: "DELETE" });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not remove. Try again.");
        setConfirmRemove(false);
        return;
      }
      onSaved("Appointment removed");
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const currentOption = appointment ? optionById.get(appointment.optionId) ?? {
    id: appointment.optionId,
    label: appointment.carrier,
    color: appointment.color,
  } : null;

  const subtitle = isNew ? (
    <span>Add a carrier to a state, with its status, date, note and agents.</span>
  ) : (
    <>
      <span className="min-w-0 truncate">
        {productLabel(appointment.columnId)} · {US_STATES[appointment.stateCode] ?? appointment.stateCode}
      </span>
      <span className={`${BADGE} ${STATUS_PILL[appointment.status]}`}>{STATUS_LABEL[appointment.status]}</span>
    </>
  );

  const footer = confirmRemove ? (
    <div className="flex min-w-0 flex-wrap items-center gap-2" role="alert">
      <span className="text-sm font-semibold text-[#bf2600]">
        Remove this carrier from the state? It stays in Activity. To keep it as ended, set the status to Terminated.
      </span>
      <button type="button" onClick={() => void remove()} disabled={busy !== null} className={DANGER_BUTTON}>
        {busy === "remove" ? "Removing…" : "Yes, remove"}
      </button>
      <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy !== null} className={GHOST_BUTTON}>
        Keep
      </button>
    </div>
  ) : (
    <>
      {!isNew && canManage ? (
        <button
          type="button"
          onClick={() => setConfirmRemove(true)}
          disabled={busy !== null}
          className={`${GHOST_BUTTON} !text-[#c9372c] hover:!bg-[#ffeceb]`}
        >
          Remove
        </button>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {readOnly ? (
          <button type="button" onClick={onClose} className={GHOST_BUTTON}>
            Close
          </button>
        ) : (
          <>
            <button type="button" onClick={onClose} disabled={busy !== null} className={GHOST_BUTTON}>
              Cancel
            </button>
            <button type="button" onClick={() => void save()} disabled={busy !== null} className={PRIMARY_BUTTON}>
              {busy === "save" ? "Saving…" : isNew ? "Create" : "Save changes"}
            </button>
          </>
        )}
      </div>
    </>
  );

  return (
    <RecordDialog
      label={isNew ? "New appointment" : `Appointment ${appointment.carrier}`}
      title={isNew ? "New appointment" : appointment.carrier}
      subtitle={subtitle}
      busy={busy !== null}
      wide={!isNew}
      onClose={onClose}
      footer={footer}
      panel={
        isNew ? undefined : (
          <>
            <PanelTab label="Activity" count={activityCount} />
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <HistoryFeed appointmentId={appointment.id} version={historyVersion} onCount={(n) => setActivityCount(n)} />
            </div>
          </>
        )
      }
    >
      <div className="grid grid-cols-12 gap-3">
        {isNew ? (
          <>
            <div className="col-span-12 md:col-span-4">
              <span className={LABEL}>
                State <span className="text-[#bf2600]">*</span>
              </span>
              <TaskSelect
                label="State"
                value={draft.stateCode}
                searchable
                options={STATE_OPTIONS}
                placeholder="Select state"
                onChange={(value) => setDraft((cur) => ({ ...cur, stateCode: value, optionId: "" }))}
                buttonClassName={`${SELECT_BUTTON} ${invalid.has("state") ? INVALID_RING : ""}`}
                menuClassName={MENU}
              />
            </div>
            <div className="col-span-6 md:col-span-4">
              <span className={LABEL}>
                Product <span className="text-[#bf2600]">*</span>
              </span>
              <TaskSelect
                label="Product"
                value={draft.columnId}
                options={productOptions}
                placeholder="Select product"
                onChange={(value) => setDraft((cur) => ({ ...cur, columnId: value, optionId: "" }))}
                buttonClassName={SELECT_BUTTON}
                menuClassName={MENU}
              />
            </div>
            <div className="col-span-6 md:col-span-4">
              <span className={LABEL}>
                Carrier <span className="text-[#bf2600]">*</span>
              </span>
              <TaskSelect
                label="Carrier"
                value={draft.optionId}
                searchable
                options={carrierOptions}
                placeholder={carrierOptions.length ? "Select carrier" : "No carriers for this product"}
                disabled={!carrierOptions.length}
                onChange={(value) => set("optionId", value)}
                renderOption={(option) => {
                  const carrier = optionById.get(option.value);
                  return carrier ? (
                    <span className={CARRIER_CHIP_CLASS} style={carrierChipStyle(carrier)}>
                      {carrier.label}
                      {option.disabled ? " · already added" : ""}
                    </span>
                  ) : (
                    option.label
                  );
                }}
                buttonClassName={`${SELECT_BUTTON} ${invalid.has("carrier") ? INVALID_RING : ""}`}
                menuClassName={MENU}
              />
            </div>
          </>
        ) : (
          <>
            <ReadOnlyCell label="Carrier" className="col-span-12 md:col-span-4">
              {currentOption ? <CarrierChip option={currentOption} /> : null}
            </ReadOnlyCell>
            <ReadOnlyCell label="State" className="col-span-6 md:col-span-4">
              {US_STATES[appointment.stateCode] ?? appointment.stateCode} ({appointment.stateCode})
            </ReadOnlyCell>
            <ReadOnlyCell label="Product" className="col-span-6 md:col-span-4">
              {productLabel(appointment.columnId)}
            </ReadOnlyCell>
          </>
        )}
        <div className="col-span-6 md:col-span-4">
          <span className={LABEL}>Status</span>
          <TaskSelect
            label="Status"
            value={draft.status}
            disabled={readOnly}
            options={STATUS_OPTIONS}
            onChange={(value) => set("status", value as LicensingStatus)}
            renderOption={(option) => (
              <span className={`${BADGE} ${STATUS_PILL[option.value as LicensingStatus]}`}>{option.label}</span>
            )}
            buttonClassName={SELECT_BUTTON}
            menuClassName={MENU}
          />
        </div>
        <label className="col-span-6 md:col-span-4">
          <span className={LABEL}>Appointed on</span>
          <input
            type="date"
            value={draft.appointedOn}
            disabled={readOnly}
            onChange={(e) => set("appointedOn", e.target.value)}
            className={INPUT}
          />
        </label>

        <GroupDivider />

        <label className="col-span-12">
          <span className={LABEL}>Note</span>
          <textarea
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder={readOnly ? "—" : "Product limits, counties, contract status…"}
            maxLength={1000}
            disabled={readOnly}
            className={TEXTAREA}
          />
        </label>

        <GroupDivider />

        <div className="col-span-12">
          <span className={LABEL}>Agents</span>
          {readOnly ? null : (
            <TaskSelect
              label="Agents"
              multi
              searchable
              values={draft.agents.map((a) => a.accountId)}
              options={agentOptions}
              placeholder={agentOptions.length ? "Add agents" : "No active Agents"}
              summaryLabel="agents"
              disabled={!agentOptions.length}
              onValuesChange={setAgentIds}
              buttonClassName={SELECT_BUTTON}
              menuClassName={MENU}
            />
          )}
          {draft.agents.length ? (
            <ul className={`${readOnly ? "" : "mt-2"} divide-y divide-[#ebecf0] rounded-lg border border-[#dfe1e6]`}>
              {draft.agents.map((agent) => (
                <li key={agent.accountId} className="flex items-center gap-2 px-3 py-1.5">
                  <Initials name={agent.name} size={24} />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#172b4d]">{agent.name}</span>
                  {readOnly ? (
                    <span className="text-[13px] text-[#626f86]">
                      {agent.appointedOn ? `Since ${formatDay(agent.appointedOn)}` : ""}
                    </span>
                  ) : (
                    <>
                      <input
                        type="date"
                        aria-label={`${agent.name} appointed on`}
                        title="Agent appointed on"
                        value={agent.appointedOn}
                        onChange={(e) =>
                          set(
                            "agents",
                            draft.agents.map((a) => (a.accountId === agent.accountId ? { ...a, appointedOn: e.target.value } : a)),
                          )
                        }
                        className={`${INPUT} !w-[150px] !font-medium max-md:!w-[130px]`}
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${agent.name}`}
                        onClick={() => set("agents", draft.agents.filter((a) => a.accountId !== agent.accountId))}
                        className="shrink-0 rounded p-1 text-[#667085] transition hover:bg-[#e4e7ec] hover:text-[#344054]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : readOnly ? (
            <div className="flex h-9 items-center rounded-lg border border-[#dfe1e6] bg-[#f4f5f7] px-3 text-sm text-[#97a0af]">—</div>
          ) : null}
        </div>

        {appointment ? (
          <>
            <GroupDivider />
            <ReadOnlyCell label="Added by" className="col-span-6 md:col-span-3">
              {appointment.createdByName ? (
                <>
                  <Initials name={appointment.createdByName} size={20} />
                  <span className="min-w-0 truncate">{appointment.createdByName}</span>
                </>
              ) : (
                <>
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-[#626f86]" />
                  <span className="min-w-0 truncate">Appointment list</span>
                </>
              )}
            </ReadOnlyCell>
            <ReadOnlyCell label="Added date" className="col-span-6 md:col-span-3" title={formatTimestamp(appointment.createdAt)}>
              <time suppressHydrationWarning>{shortDate(appointment.createdAt)}</time>
            </ReadOnlyCell>
            <ReadOnlyCell label="Updated by" className="col-span-6 md:col-span-3">
              {appointment.updatedByName ? (
                <>
                  <Initials name={appointment.updatedByName} size={20} />
                  <span className="min-w-0 truncate">{appointment.updatedByName}</span>
                </>
              ) : null}
            </ReadOnlyCell>
            <ReadOnlyCell label="Updated date" className="col-span-6 md:col-span-3" title={formatTimestamp(appointment.updatedAt)}>
              {appointment.updatedByName ? <time suppressHydrationWarning>{shortDate(appointment.updatedAt)}</time> : null}
            </ReadOnlyCell>
          </>
        ) : null}
      </div>
      {error ? (
        <p className="mt-4 rounded-lg border border-[#ffbdad] bg-[#ffebe6] px-3 py-2 text-sm font-semibold text-[#bf2600]">
          {error}
        </p>
      ) : null}
    </RecordDialog>
  );
}

export function Initials({ name, size }: { name: string; size: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), background: avatarColor(name) }}
    >
      {initials(name)}
    </span>
  );
}
