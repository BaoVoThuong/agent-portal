"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Shuffle, Trash2, X } from "lucide-react";
import { LEAD_PRODUCTS, type LeadProduct } from "@/lib/leads/types";
import { personLabel } from "@/lib/tasks/people";

type WeightRow = {
  agent_email: string;
  weight: number;
  position: number;
  is_active: boolean;
  /** Computed by the API from the live totals — never stored. */
  share: number;
  /** False when the account can no longer take leads at all. */
  eligible: boolean;
};

type WeightsPayload = {
  enabled: boolean;
  weights: WeightRow[];
  preview: { email: string; count: number }[];
};

type PoolPayload = {
  pending: number;
  remaining: number;
  byProduct: Record<LeadProduct, number>;
};

type DistributeResult = {
  assigned: number;
  unassigned: number;
  results: Record<string, { assigned: number; unassigned: number; reason?: string }>;
};

const PRODUCT_LABEL: Record<LeadProduct, string> = { pc: "P&C", health: "Health" };
const INPUT_CLASS =
  "h-9 w-full rounded border border-[#dfe1e6] bg-white px-2 text-sm outline-none focus:border-[#0c66e4]";

/**
 * Ratio setup lives here rather than on a config screen on purpose: the numbers
 * only mean something next to the leads they are about to move. Someone opening
 * this sees how many leads are waiting, sets the split, watches the preview
 * change, and only then distributes.
 */
export function LeadDistributeDialog({
  open,
  assignees,
  nameByEmail,
  sourceId,
  onClose,
  onDistributed,
}: {
  open: boolean;
  assignees: { email: string; name: string | null }[];
  nameByEmail: Map<string, string>;
  sourceId: string;
  onClose: () => void;
  onDistributed: () => void;
}) {
  const [product, setProduct] = useState<LeadProduct>("health");
  const [pool, setPool] = useState<PoolPayload | null>(null);
  const [weights, setWeights] = useState<WeightsPayload | null>(null);
  const [draft, setDraft] = useState<WeightRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DistributeResult | null>(null);

  const loadWeights = useCallback(async (forProduct: LeadProduct) => {
    const response = await fetch(
      `/api/leads/assignment-weights?product=${forProduct}`,
      { cache: "no-store" }
    );
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.error ?? "Không tải được tỉ lệ.");
    const next = payload as WeightsPayload;
    setWeights(next);
    setDraft(next.weights.map((row) => ({ ...row })));
    setEnabled(next.enabled);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        setError(null);
        const poolResponse = await fetch("/api/leads/distribute", { cache: "no-store" });
        const poolPayload = await poolResponse.json().catch(() => null);
        if (cancelled) return;
        if (!poolResponse.ok) throw new Error(poolPayload?.error ?? "Không đọc được pool.");
        setPool(poolPayload as PoolPayload);
        await loadWeights(product);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Không tải được dữ liệu.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, product, loadWeights]);

  if (!open) return null;

  const active = draft.filter((row) => row.is_active && row.weight > 0 && row.eligible);
  const totalWeight = active.reduce((sum, row) => sum + row.weight, 0);
  // Recomputed from the draft so the percentages move as someone types, instead
  // of showing the numbers that were true when the dialog opened.
  const shareOf = (row: WeightRow) =>
    row.is_active && row.weight > 0 && row.eligible && totalWeight > 0
      ? Math.round((row.weight / totalWeight) * 1000) / 10
      : 0;
  const dirty =
    weights !== null &&
    (enabled !== weights.enabled ||
      JSON.stringify(draft.map((r) => [r.agent_email, r.weight, r.is_active, r.position])) !==
        JSON.stringify(weights.weights.map((r) => [r.agent_email, r.weight, r.is_active, r.position])));

  const notListed = assignees.filter(
    (person) => !draft.some((row) => row.agent_email === person.email.toLowerCase())
  );

  function update(email: string, patch: Partial<WeightRow>) {
    setDraft((current) =>
      current.map((row) => (row.agent_email === email ? { ...row, ...patch } : row))
    );
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/leads/assignment-weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product,
          enabled,
          weights: draft.map((row) => ({
            agent_email: row.agent_email,
            weight: row.weight,
            position: row.position,
            is_active: row.is_active,
          })),
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Không lưu được.");
      await loadWeights(product);
      setNotice("Đã lưu tỉ lệ.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Không lưu được.");
    } finally {
      setBusy(false);
    }
  }

  async function resetCursor() {
    if (busy) return;
    // The cursor holds the unfinished part of the current cycle. Zeroing it is
    // not undoable and shifts who is next, so it asks first.
    if (
      !window.confirm(
        "Đặt lại vòng xoay cho " +
          PRODUCT_LABEL[product] +
          "?\n\nPhần dư của chu kỳ hiện tại bị bỏ, và lượt chia kế tiếp bắt đầu lại từ đầu."
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/leads/assignment-weights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset_cursor", product }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Không đặt lại được.");
      }
      await loadWeights(product);
      setNotice("Đã đặt lại vòng xoay.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Không đặt lại được.");
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    if (busy || !pool || pool.pending === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/leads/distribute", {
        method: "POST",
        headers: { "x-lead-client-source": sourceId },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Không chia được.");
      setResult(payload as DistributeResult);
      const poolResponse = await fetch("/api/leads/distribute", { cache: "no-store" });
      if (poolResponse.ok) setPool((await poolResponse.json()) as PoolPayload);
      onDistributed();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Không chia được.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chia pool"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <h2 className="text-base font-bold text-[#172b4d]">Chia pool theo tỉ lệ</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded p-1.5 text-[#42526e] transition hover:bg-[#f4f5f7]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <div className="rounded border border-[#dfe1e6] bg-[#f7f8fa] px-4 py-3 text-sm">
            {pool ? (
              pool.pending === 0 ? (
                <span className="font-semibold text-[#42526e]">
                  Không còn lead nào ở pool.
                </span>
              ) : (
                <>
                  <span className="font-semibold text-[#172b4d]">
                    {pool.pending} lead chưa gán
                  </span>
                  <span className="text-[#6b778c]">
                    {" — "}
                    {LEAD_PRODUCTS.filter((key) => pool.byProduct[key] > 0)
                      .map((key) => `${PRODUCT_LABEL[key]} ${pool.byProduct[key]}`)
                      .join(" · ")}
                  </span>
                  {pool.remaining > 0 ? (
                    <span className="mt-1 block text-xs text-[#974f0c]">
                      Còn {pool.remaining} lead nữa sẽ cần bấm thêm lượt.
                    </span>
                  ) : null}
                </>
              )
            ) : (
              <span className="text-[#6b778c]">Đang đọc pool…</span>
            )}
          </div>

          <div className="inline-flex rounded bg-[#f4f5f7] p-0.5">
            {LEAD_PRODUCTS.map((key) => (
              <button
                key={key}
                type="button"
                aria-current={product === key ? "page" : undefined}
                onClick={() => {
                  setProduct(key);
                  setResult(null);
                  setNotice(null);
                }}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  product === key
                    ? "bg-white text-[#0c66e4] shadow-sm"
                    : "text-[#5e6c84] hover:text-[#172b4d]"
                }`}
              >
                {PRODUCT_LABEL[key]}
              </button>
            ))}
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <span className="font-semibold text-[#172b4d]">
                Tự chia khi import {PRODUCT_LABEL[product]}
              </span>
              <span className="mt-0.5 block text-xs text-[#6b778c]">
                Tắt thì lead import vào vẫn ở pool và chỉ được chia khi bấm nút bên dưới.
              </span>
            </span>
          </label>

          <p className="text-xs text-[#6b778c]">
            Bỏ tick <strong>Đang nhận</strong> để tạm dừng một người mà vẫn giữ
            chỗ của họ trong vòng xoay. Dùng thùng rác để bỏ hẳn khỏi danh sách.
          </p>
          <div className="overflow-hidden rounded border border-[#dfe1e6]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f7f8fa] text-xs font-bold uppercase text-[#6b778c]">
                <tr>
                  <th className="px-3 py-2">Agent</th>
                  <th className="w-24 px-3 py-2">Trọng số</th>
                  <th className="w-20 px-3 py-2">Tỉ lệ</th>
                  <th className="w-24 px-3 py-2 text-center">Đang nhận</th>
                  <th className="w-16 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {draft.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[#6b778c]">
                      Chưa có agent nào cho {PRODUCT_LABEL[product]}. Thêm bên dưới.
                    </td>
                  </tr>
                ) : (
                  draft.map((row) => (
                    <tr key={row.agent_email} className="border-t border-[#ebecf0]">
                      <td className="px-3 py-2">
                        <span className="font-medium text-[#172b4d]">
                          {personLabel(row.agent_email, nameByEmail)}
                        </span>
                        {!row.eligible ? (
                          // The row survives in the table but can never be
                          // picked; saying so beats a ratio that quietly does
                          // not add up to what the admin typed.
                          <span className="mt-0.5 block text-xs font-semibold text-[#bf2600]">
                            Tài khoản này không nhận được lead (đã tắt hoặc mất quyền).
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          className={INPUT_CLASS}
                          value={row.weight}
                          onChange={(event) =>
                            update(row.agent_email, {
                              weight: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 font-semibold text-[#42526e]">
                        {shareOf(row)}%
                      </td>
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${row.agent_email} đang nhận lead`}
                          checked={row.is_active}
                          onChange={(event) =>
                            update(row.agent_email, { is_active: event.target.checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {/* Bỏ tick "Đang nhận" là tạm dừng — dòng còn đó, con trỏ
                            xoay vòng của người này còn nguyên, bật lại là chạy
                            tiếp. Xoá là bỏ hẳn khỏi danh sách. Hai việc khác
                            nhau nên là hai nút khác nhau. */}
                        <button
                          type="button"
                          aria-label={`Xoá ${row.agent_email} khỏi danh sách`}
                          title="Xoá khỏi danh sách chia"
                          onClick={() =>
                            setDraft((current) =>
                              current.filter((item) => item.agent_email !== row.agent_email)
                            )
                          }
                          className="rounded p-1 text-[#97a0af] transition hover:bg-[#ffebe6] hover:text-[#bf2600]"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {notListed.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                className={`${INPUT_CLASS} max-w-xs`}
                value={addEmail}
                onChange={(event) => setAddEmail(event.target.value)}
              >
                <option value="">Thêm agent…</option>
                {notListed.map((person) => (
                  <option key={person.email} value={person.email}>
                    {personLabel(person.email, nameByEmail)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addEmail}
                onClick={() => {
                  setDraft((current) => [
                    ...current,
                    {
                      agent_email: addEmail.toLowerCase(),
                      weight: 1,
                      position: current.length + 1,
                      is_active: true,
                      share: 0,
                      eligible: true,
                    },
                  ]);
                  setAddEmail("");
                }}
                className="h-9 rounded border border-[#dfe1e6] px-3 text-sm font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-40"
              >
                Thêm
              </button>
            </div>
          ) : null}

          {active.length > 0 ? (
            <p className="rounded border border-[#b8d4ff] bg-[#e9f2ff] px-3 py-2 text-sm text-[#0c3d91]">
              Trong 10 lead {PRODUCT_LABEL[product]} kế tiếp:{" "}
              <strong>
                {(dirty ? null : weights?.preview)
                  ? weights!.preview
                      .map((row) => `${personLabel(row.email, nameByEmail)} ${row.count}`)
                      .join(" · ")
                  : "lưu tỉ lệ để xem lại phân bổ"}
              </strong>
            </p>
          ) : (
            <p className="rounded border border-[#ffe380] bg-[#fffae6] px-3 py-2 text-sm text-[#974f0c]">
              Chưa có ai nhận {PRODUCT_LABEL[product]} — lead sẽ ở lại pool.
            </p>
          )}

          {result ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Đã chia <strong>{result.assigned}</strong>
              {result.unassigned > 0 ? (
                <>
                  {" · còn ở pool "}
                  <strong>{result.unassigned}</strong>
                  {Object.values(result.results)
                    .map((entry) => entry.reason)
                    .filter(Boolean)
                    .map((reason) => ` — ${reason}`)
                    .join("")}
                </>
              ) : null}
            </p>
          ) : null}
          {notice ? (
            <p className="text-sm font-semibold text-emerald-700">{notice}</p>
          ) : null}
          {error ? (
            <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-[#dfe1e6] px-5 py-3">
          <button
            type="button"
            onClick={() => void resetCursor()}
            disabled={busy}
            title="Bỏ phần dư của chu kỳ hiện tại"
            className="inline-flex h-9 items-center gap-1.5 rounded px-2 text-sm font-semibold text-[#6b778c] transition hover:text-[#172b4d] disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Đặt lại vòng xoay
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !dirty}
              className="inline-flex h-9 items-center rounded border border-[#dfe1e6] bg-white px-3 text-sm font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-40"
            >
              Lưu tỉ lệ
            </button>
            <button
              type="button"
              onClick={() => void distribute()}
              // Distributing with unsaved edits would use the stored ratio, not
              // the one on screen — which is the one the admin is reading.
              disabled={busy || dirty || !pool || pool.pending === 0}
              title={dirty ? "Lưu tỉ lệ trước khi chia." : undefined}
              className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Shuffle className="h-4 w-4" />
              {busy ? "Đang chia…" : `Chia ${pool?.pending ?? 0} lead`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
