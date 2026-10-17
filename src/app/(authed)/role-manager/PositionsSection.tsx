"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toast } from "../_shared/Toast";
import { useBodyScrollLock } from "../_shared/useBodyScrollLock";
import {
  POSITION_KIND_LABELS,
  POSITION_KINDS,
  positionLockReason,
  type PositionKind,
  type PositionRecord,
} from "@/lib/admin/positions";

type PositionForm = { id: string | null; name: string; kind: PositionKind };

const inputClass =
  "w-full rounded-md border border-[#cfd6e3] px-3 py-2 text-sm text-[#16233a] outline-none placeholder:text-[#98a2b3] focus:border-[#1b5d9e] focus:ring-2 focus:ring-[#1b5d9e]/15";

/**
 * Role Manager → Positions: the catalog an admin picks from in Account
 * Manager. A Position describes the job; the Role still decides every
 * permission. Built-in positions and positions anyone holds are locked.
 */
export function PositionsSection({ initialPositions }: { initialPositions: PositionRecord[] }) {
  const router = useRouter();
  const [positions, setPositions] = useState(initialPositions);
  const [form, setForm] = useState<PositionForm | null>(null);
  const [toDelete, setToDelete] = useState<PositionRecord | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(Boolean(form) || Boolean(toDelete));

  // A 409 means someone was given the Position since the page loaded; reload
  // so its row shows the holder and the lock.
  async function reload() {
    try {
      const response = await fetch("/api/admin/positions", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && Array.isArray(result.positions)) setPositions(result.positions);
    } catch {
      // The error toast already says what happened; a stale list is harmless.
    }
  }

  async function send(url: string, init: RequestInit, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(url, init);
      const result = await response.json();
      if (!response.ok) {
        setError(result.error ?? "Unable to save position.");
        if (response.status === 409) await reload();
        return false;
      }
      setPositions(result.positions ?? positions);
      setMessage(success);
      router.refresh();
      return true;
    } catch {
      setError("Unable to save position. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form) return;
    const body = JSON.stringify({ name: form.name, kind: form.kind });
    const ok = await send(
      form.id ? `/api/admin/positions/${form.id}` : "/api/admin/positions",
      {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      form.id ? "Position updated." : "Position created.",
    );
    if (ok) setForm(null);
  }

  async function handleDelete() {
    if (!toDelete) return;
    const ok = await send(`/api/admin/positions/${toDelete.id}`, { method: "DELETE" }, "Position deleted.");
    if (ok) setToDelete(null);
  }

  return (
    <>
      <section className="overflow-hidden rounded-lg border border-[#d8dee7] bg-white">
        <div className="flex flex-col gap-4 border-b border-[#e4e9f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[#16233a]">Positions</h2>
            <p className="mt-1 text-xs text-[#667085]">
              A position describes someone&apos;s job. Their role still decides what they can do.
              Positions are assigned in Account Manager.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMessage(null);
              setForm({ id: null, name: "", kind: "other" });
            }}
            className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155]"
          >
            Create Position
          </button>
        </div>
        <div className="divide-y divide-[#edf1f7]">
          {positions.map((position) => {
            const lockReason = positionLockReason(position);
            const disabledCount = position.holders.filter((holder) => !holder.is_active).length;
            const activeCount = position.holders.length - disabledCount;
            const summary = `${activeCount} account${activeCount === 1 ? "" : "s"}${
              disabledCount > 0 ? ` · +${disabledCount} disabled` : ""
            }`;
            const expanded = expandedId === position.id;

            return (
              <div
                key={position.id}
                className="grid items-start gap-4 px-5 py-4 lg:grid-cols-[260px_minmax(0,1fr)_200px]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[#16233a]">{position.name}</h3>
                    {position.system_key && (
                      <span className="rounded bg-[#eef4ff] px-2 py-0.5 text-[11px] font-semibold text-[#1b5d9e]">
                        Built-in
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-[#667085]">
                    Group: {POSITION_KIND_LABELS[position.kind]}
                  </p>
                </div>

                <div className="min-w-0">
                  {position.holders.length === 0 ? (
                    <p className="text-xs font-medium text-[#667085]">{summary}</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : position.id)}
                        className="text-xs font-medium text-[#667085] underline-offset-2 hover:text-[#245a94] hover:underline"
                      >
                        {summary}
                      </button>
                      {expanded && (
                        <ul className="mt-2 space-y-1">
                          {position.holders.map((holder) => (
                            <li
                              key={holder.user_id}
                              className="flex items-center gap-2 text-xs text-[#344054]"
                              title={holder.email}
                            >
                              <span className="truncate">{holder.name?.trim() || holder.email}</span>
                              {!holder.is_active && (
                                <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                                  Disabled
                                </span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-start justify-start gap-2 lg:justify-end">
                  <button
                    type="button"
                    disabled={busy || Boolean(lockReason)}
                    title={lockReason ?? undefined}
                    onClick={() => {
                      setError(null);
                      setMessage(null);
                      setForm({ id: position.id, name: position.name, kind: position.kind });
                    }}
                    className="rounded-md border border-[#cfd6e3] px-3 py-2 text-xs font-semibold text-[#245a94] transition hover:bg-[#f3f6fa] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={busy || Boolean(lockReason)}
                    title={lockReason ?? undefined}
                    onClick={() => {
                      setError(null);
                      setMessage(null);
                      setToDelete(position);
                    }}
                    className="rounded-md border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
          {positions.length === 0 && (
            <div className="px-5 py-12 text-center text-sm text-[#667085]">No positions yet.</div>
          )}
        </div>
      </section>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <form
            onSubmit={handleSubmit}
            className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-semibold text-[#16233a]">
              {form.id ? "Edit Position" : "Create Position"}
            </h2>
            <label className="mt-4 block text-sm font-medium text-[#344054]">
              Name
              <input
                className={`mt-1 ${inputClass}`}
                value={form.name}
                maxLength={80}
                required
                autoFocus
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </label>
            <label className="mt-4 block text-sm font-medium text-[#344054]">
              Group
              <select
                className={`mt-1 bg-white ${inputClass}`}
                value={form.kind}
                onChange={(event) => setForm({ ...form, kind: event.target.value as PositionKind })}
              >
                {POSITION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {POSITION_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-[#163f6b] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0f3155] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Saving..." : "Save Position"}
              </button>
            </div>
          </form>
        </div>
      )}

      {toDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f2349]/35 px-4">
          <div className="w-full max-w-[420px] rounded-lg border border-[#d8dee7] bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[#16233a]">Delete Position</h2>
            <p className="mt-1 text-sm text-[#667085]">
              This permanently deletes the position{" "}
              <span className="font-semibold text-[#16233a]">{toDelete.name}</span>.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setToDelete(null)}
                className="rounded-md border border-[#cfd6e3] px-4 py-2 text-sm font-semibold text-[#344054] hover:bg-[#f4f7fb]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Toast message={error} tone="error" onDismiss={() => setError(null)} />
      <Toast
        message={message}
        tone="success"
        onDismiss={() => setMessage(null)}
        stackIndex={error ? 1 : 0}
      />
    </>
  );
}
