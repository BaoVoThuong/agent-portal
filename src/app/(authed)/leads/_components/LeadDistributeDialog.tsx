"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
};

type WeightsPayload = {
  /** API trả kèm; dùng để biết payload đang giữ là của product nào. */
  product: LeadProduct;
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

/**
 * Ngoài component có chủ đích: nó không đụng state nào, nên effect gọi được mà
 * không vướng luật "đừng setState thẳng trong effect" của React Compiler — và
 * nhờ vậy phần fetch chỉ có MỘT bản, thay vì một bản trong effect và một bản
 * trong loadWeights như trước.
 */
async function fetchWeights(product: LeadProduct): Promise<WeightsPayload> {
  const response = await fetch(
    `/api/leads/assignment-weights?product=${product}`,
    { cache: "no-store" }
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Could not load the ratios.");
  return payload as WeightsPayload;
}
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
  nameByEmail,
  sourceId,
  onClose,
  onDistributed,
}: {
  open: boolean;
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
  // Ai nhận lead do DANH SÁCH NÀY quyết, không do quyền RBAC. Nên ô "Thêm
  // agent" phải mở ra mọi tài khoản đang hoạt động, chứ không chỉ những người
  // đã có quyền lead — nếu không thì cái quyết định lại nằm ở Role Manager.
  const [roster, setRoster] = useState<{ email: string; name: string | null }[]>([]);

  const [rosterError, setRosterError] = useState(false);
  // Mỗi lần đổi product là một request mới. Response của product cũ về sau
  // response của product mới thì phải bị bỏ, nếu không bảng hiện tỉ lệ của
  // product mày vừa rời khỏi.
  const weightsRequest = useRef(0);

  const loadWeights = useCallback(async (forProduct: LeadProduct) => {
    const seq = weightsRequest.current + 1;
    weightsRequest.current = seq;
    try {
      const next = await fetchWeights(forProduct);
      if (seq !== weightsRequest.current) return;
      setWeights(next);
      setDraft(next.weights.map((row) => ({ ...row })));
      setEnabled(next.enabled);
      setError(null);
    } catch (loadError) {
      if (seq !== weightsRequest.current) return;
      setError(loadError instanceof Error ? loadError.message : "Could not load the ratios.");
    }
  }, []);

  // Pool và roster không phụ thuộc product, nên chúng nạp MỘT LẦN khi mở và
  // không chạy lại mỗi lần bấm đổi product. Trước đây cả ba chạy tuần tự trong
  // một effect: bảng agent phải đợi cả pool lẫn roster xong mới hiện, dù nó
  // không cần cái nào trong hai.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/leads/distribute", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) throw new Error(payload?.error ?? "Could not read the pool.");
        setPool(payload as PoolPayload);
      } catch (poolError) {
        if (!cancelled) {
          setError(poolError instanceof Error ? poolError.message : "Could not read the pool.");
        }
      }
    })();

    void (async () => {
      try {
        const response = await fetch("/api/leads/assignment-roster", { cache: "no-store" });
        const payload = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !Array.isArray(payload?.accounts)) {
          throw new Error("roster");
        }
        setRoster(payload.accounts);
        setRosterError(false);
      } catch {
        // Hỏng im lặng thì ô "Thêm agent" biến mất không dấu vết và trông y hệt
        // "đã thêm hết mọi người rồi". Nói ra để còn biết mà thử lại.
        if (!cancelled) setRosterError(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Fetch inline với .then(), giống LeadAddDialog/LeadImportDialog: React
  // Compiler chặn việc gọi một hàm có setState thẳng trong thân effect, kể cả
  // khi setState đó nằm sau await. loadWeights vẫn dùng cho lần nạp lại sau khi
  // lưu — chỗ đó là event handler nên không vướng.
  useEffect(() => {
    if (!open) return;
    const seq = weightsRequest.current + 1;
    weightsRequest.current = seq;
    void fetchWeights(product)
      .then((next) => {
        if (seq !== weightsRequest.current) return;
        setWeights(next);
        setDraft(next.weights.map((row) => ({ ...row })));
        setEnabled(next.enabled);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (seq !== weightsRequest.current) return;
        setError(loadError instanceof Error ? loadError.message : "Could not load the ratios.");
      });
  }, [open, product]);

  if (!open) return null;

  // Suy ra thay vì lưu: payload mang theo product của chính nó, nên "chưa có
  // payload của product đang xem" CHÍNH LÀ đang tải. Một cờ loading riêng phải
  // set đồng bộ trong effect, và nó cũng là thứ nữa có thể lệch khỏi sự thật.
  const loadingWeights = error === null && weights?.product !== product;

  const active = draft.filter((row) => row.is_active && row.weight > 0);
  const totalWeight = active.reduce((sum, row) => sum + row.weight, 0);
  // Recomputed from the draft so the percentages move as someone types, instead
  // of showing the numbers that were true when the dialog opened.
  const shareOf = (row: WeightRow) =>
    row.is_active && row.weight > 0 && totalWeight > 0
      ? Math.round((row.weight / totalWeight) * 1000) / 10
      : 0;
  const dirty =
    weights !== null &&
    (enabled !== weights.enabled ||
      JSON.stringify(draft.map((r) => [r.agent_email, r.weight, r.is_active, r.position])) !==
        JSON.stringify(weights.weights.map((r) => [r.agent_email, r.weight, r.is_active, r.position])));

  const notListed = roster.filter(
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
      if (!response.ok) throw new Error(payload?.error ?? "Could not save.");
      await loadWeights(product);
      setNotice("Ratios saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save.");
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
        `Reset the ${PRODUCT_LABEL[product]} rotation?\n\nThe part-finished cycle is discarded and the next run starts from the top.`
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
        throw new Error(payload?.error ?? "Could not reset.");
      }
      await loadWeights(product);
      setNotice("Rotation reset.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Could not reset.");
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
      if (!response.ok) throw new Error(payload?.error ?? "Could not distribute.");
      setResult(payload as DistributeResult);
      const poolResponse = await fetch("/api/leads/distribute", { cache: "no-store" });
      if (poolResponse.ok) setPool((await poolResponse.json()) as PoolPayload);
      onDistributed();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Could not distribute.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091e42]/40 p-4 sm:p-6"
      onClick={onClose}
    >
      {/* Cao cố định: thêm/xoá agent, hiện lỗi, hay đổi product đều không được
          làm modal co giãn dưới tay người đang bấm. max-h vẫn giữ để màn hình
          thấp không bị tràn. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Distribute pool"
        className="flex h-[680px] max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#dfe1e6] px-5 py-3">
          <h2 className="text-base font-bold text-[#172b4d]">Distribute pool by ratio</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
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
                  No leads are waiting in the pool.
                </span>
              ) : (
                <>
                  <span className="font-semibold text-[#172b4d]">
                    {pool.pending} unassigned lead{pool.pending === 1 ? "" : "s"}
                  </span>
                  <span className="text-[#6b778c]">
                    {" — "}
                    {LEAD_PRODUCTS.filter((key) => pool.byProduct[key] > 0)
                      .map((key) => `${PRODUCT_LABEL[key]} ${pool.byProduct[key]}`)
                      .join(" · ")}
                  </span>
                  {pool.remaining > 0 ? (
                    <span className="mt-1 block text-xs text-[#974f0c]">
                      {pool.remaining} more will need another run.
                    </span>
                  ) : null}
                </>
              )
            ) : (
              <span className="text-[#6b778c]">Reading the pool…</span>
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

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span className="font-semibold text-[#172b4d]">
              Auto-assign on import ({PRODUCT_LABEL[product]})
            </span>
          </label>

          {/* Cao cố định và tự cuộn: danh sách 2 người hay 13 người thì phần
              còn lại của modal vẫn nằm nguyên chỗ cũ. Header dính lại khi cuộn. */}
          <div className="h-64 overflow-y-auto rounded border border-[#dfe1e6]">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 z-10 bg-[#f7f8fa] text-xs font-bold uppercase text-[#6b778c]">
                <tr>
                  <th className="px-3 py-2">Agent</th>
                  <th className="w-24 px-3 py-2">Weight</th>
                  <th className="w-20 px-3 py-2">Share</th>
                  <th className="w-24 px-3 py-2 text-center">Receiving</th>
                  <th className="w-16 px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loadingWeights && draft.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[#6b778c]">
                      Loading agents…
                    </td>
                  </tr>
                ) : draft.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-[#6b778c]">
                      No agents for {PRODUCT_LABEL[product]} yet. Add one below.
                    </td>
                  </tr>
                ) : (
                  draft.map((row) => (
                    <tr key={row.agent_email} className="border-t border-[#ebecf0]">
                      <td className="px-3 py-2">
                        <span className="font-medium text-[#172b4d]">
                          {personLabel(row.agent_email, nameByEmail)}
                        </span>
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
                          aria-label={`${row.agent_email} is receiving leads`}
                          checked={row.is_active}
                          onChange={(event) =>
                            update(row.agent_email, { is_active: event.target.checked })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        {/* Tạm dừng và xoá là hai việc khác nhau nên là hai
                            nút khác nhau: một cái để người ta quay lại được
                            bằng một cú tick, một cái để dọn hẳn. */}
                        <button
                          type="button"
                          aria-label={`Remove ${row.agent_email} from the list`}
                          title="Remove from the distribution list"
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

          {rosterError ? (
            <p className="rounded border border-[#ffe380] bg-[#fffae6] px-3 py-2 text-sm text-[#974f0c]">
              Could not load the account list. Close and reopen this dialog to
              try again.
            </p>
          ) : null}
          {notListed.length > 0 ? (
            <div className="flex items-center gap-2">
              <select
                className={`${INPUT_CLASS} max-w-xs`}
                value={addEmail}
                onChange={(event) => setAddEmail(event.target.value)}
              >
                <option value="">Add agent…</option>
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
                    },
                  ]);
                  setAddEmail("");
                }}
                className="h-9 rounded border border-[#dfe1e6] px-3 text-sm font-semibold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-40"
              >
                Add
              </button>
            </div>
          ) : null}

          {active.length > 0 ? (
            <p className="rounded border border-[#b8d4ff] bg-[#e9f2ff] px-3 py-2 text-sm text-[#0c3d91]">
              Next 10 {PRODUCT_LABEL[product]} leads:{" "}
              <strong>
                {(dirty ? null : weights?.preview)
                  ? weights!.preview
                      .map((row) => `${personLabel(row.email, nameByEmail)} ${row.count}`)
                      .join(" · ")
                  : "save to refresh the preview"}
              </strong>
            </p>
          ) : (
            <p className="rounded border border-[#ffe380] bg-[#fffae6] px-3 py-2 text-sm text-[#974f0c]">
              Nobody is receiving {PRODUCT_LABEL[product]} — those leads stay in the pool.
            </p>
          )}

          {result ? (
            <p className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Assigned <strong>{result.assigned}</strong>
              {result.unassigned > 0 ? (
                <>
                  {" · left in the pool "}
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
            title="Discard the part-finished cycle"
            className="inline-flex h-9 items-center gap-1.5 rounded px-2 text-sm font-semibold text-[#6b778c] transition hover:text-[#172b4d] disabled:opacity-40"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset rotation
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || loadingWeights || !dirty}
              className="inline-flex h-9 items-center rounded border border-[#dfe1e6] bg-white px-3 text-sm font-bold text-[#42526e] transition hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-40"
            >
              Save ratios
            </button>
            <button
              type="button"
              onClick={() => void distribute()}
              // Distributing with unsaved edits would use the stored ratio, not
              // the one on screen — which is the one the admin is reading.
              disabled={busy || loadingWeights || dirty || !pool || pool.pending === 0}
              title={dirty ? "Save your changes before distributing." : undefined}
              className="inline-flex h-9 items-center gap-2 rounded bg-[#0c66e4] px-4 text-sm font-bold text-white shadow-sm transition hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Shuffle className="h-4 w-4" />
              {busy ? "Distributing…" : `Distribute ${pool?.pending ?? 0}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
