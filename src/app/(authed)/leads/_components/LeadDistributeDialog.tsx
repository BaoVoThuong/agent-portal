"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Shuffle, X } from "lucide-react";
import { LEAD_PRODUCTS, type LeadProduct } from "@/lib/leads/types";
import { pickWeighted } from "@/lib/leads/round-robin";
import { personLabel } from "@/lib/tasks/people";
import { Initials } from "../../tasks/_components/board-ui";

type WeightRow = {
  agent_email: string;
  weight: number;
  position: number;
  is_active: boolean;
  /** Computed by the API from the live totals — never stored. */
  share: number;
  /** Vị trí hiện tại trong vòng xoay; dãy xem trước phải bắt đầu từ đây. */
  current_weight: number;
};

type WeightsPayload = {
  /** API trả kèm; dùng để biết payload đang giữ là của product nào. */
  product: LeadProduct;
  enabled: boolean;
  weights: WeightRow[];
  preview: { email: string; count: number }[];
  /** Thứ tự thật của N lượt kế tiếp. */
  sequence: string[];
};

type PoolPayload = {
  pending: number;
  remaining: number;
  byProduct: Record<LeadProduct, number>;
};

type RosterAgent = {
  email: string;
  name: string | null;
  /** Product nào agent này đang phụ trách. */
  products: LeadProduct[];
};

type DistributeResult = {
  assigned: number;
  unassigned: number;
  results: Record<string, { assigned: number; unassigned: number; reason?: string }>;
};

const PRODUCT_LABEL: Record<LeadProduct, string> = { pc: "P&C", health: "Health" };
const TABS: (LeadProduct | "agents")[] = [...LEAD_PRODUCTS, "agents"];
/** Bao nhiêu lượt kế tiếp thì vẽ ra. Mười là số người ta giữ được trong đầu. */
const PREVIEW_SIZE = 10;

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
  // Ba tab: hai product để đặt tỉ lệ, một tab để quyết AI thuộc product nào.
  // Tách ra vì đó là hai câu hỏi khác nhau — "ai" và "bao nhiêu" — và trộn
  // chúng vào một bảng là lý do trước đây phải có nút Add agent trong từng tab.
  const [tab, setTab] = useState<LeadProduct | "agents">("health");
  const product: LeadProduct = tab === "agents" ? "health" : tab;
  const [pool, setPool] = useState<PoolPayload | null>(null);
  const [weights, setWeights] = useState<WeightsPayload | null>(null);
  const [draft, setDraft] = useState<WeightRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<DistributeResult | null>(null);
  // Ai nhận lead do DANH SÁCH NÀY quyết, không do quyền RBAC. Nên ô "Thêm
  // agent" phải mở ra mọi tài khoản đang hoạt động, chứ không chỉ những người
  // đã có quyền lead — nếu không thì cái quyết định lại nằm ở Role Manager.
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [savingAgents, setSavingAgents] = useState(false);

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
        if (!response.ok || !Array.isArray(payload?.agents)) {
          throw new Error("roster");
        }
        setRoster(payload.agents as RosterAgent[]);
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
  }, [open, tab, product]);

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


  // Dãy dựng NGAY TẠI ĐÂY từ trọng số đang gõ, nhưng con trỏ (current_weight)
  // lấy nguyên từ bản đã lưu: lượt chia trước chưa bao giờ dừng đúng ranh giới
  // một chu kỳ, nên bắt đầu lại từ 0 sẽ vẽ một dãy không phải dãy mà việc chia
  // thật sẽ chạy. Dùng chính pickWeighted mà RPC bên DB làm theo.
  const upcoming = pickWeighted(
    active.map((row) => ({
      email: row.agent_email,
      weight: row.weight,
      currentWeight: row.current_weight,
      position: row.position,
    })),
    PREVIEW_SIZE
  ).picks;
  const upcomingCounts = [...new Set(upcoming)]
    .map((email) => ({ email, count: upcoming.filter((item) => item === email).length }))
    .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email));

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

  /**
   * Bật/tắt một agent cho một product.
   *
   * Đi thẳng qua PUT của product đó thay vì gom vào nút Lưu chung: đây là một
   * việc dứt khoát ("người này có làm Health không"), không phải một con số cần
   * cân đi cân lại, nên bắt người ta bấm Lưu sau mỗi cú tick là bước thừa.
   */
  async function toggleAgentProduct(
    agentEmail: string,
    forProduct: LeadProduct,
    next: boolean
  ) {
    if (savingAgents) return;
    setSavingAgents(true);
    setError(null);
    setNotice(null);
    try {
      const current = await fetchWeights(forProduct);
      const rows = current.weights
        .filter((row) => row.agent_email !== agentEmail)
        .map((row) => ({
          agent_email: row.agent_email,
          weight: row.weight,
          position: row.position,
          is_active: row.is_active,
        }));
      if (next) {
        rows.push({
          agent_email: agentEmail,
          weight: 1,
          position: rows.length + 1,
          is_active: true,
        });
      }
      const response = await fetch("/api/leads/assignment-weights", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product: forProduct, weights: rows }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Could not save.");
      }
      setRoster((agents) =>
        agents.map((agent) =>
          agent.email === agentEmail
            ? {
                ...agent,
                products: next
                  ? [...new Set([...agent.products, forProduct])]
                  : agent.products.filter((value) => value !== forProduct),
              }
            : agent
        )
      );
      // Tab tỉ lệ đang mở phải thấy ngay người vừa được thêm/bỏ.
      if (forProduct === product) await loadWeights(product);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not save.");
    } finally {
      setSavingAgents(false);
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
      {/* Kích thước cố định theo viewport: thêm/xoá agent, hiện lỗi hay đổi
          product đều không được làm modal co giãn dưới tay người đang bấm —
          nút Distribute ở footer mà nhảy chỗ là cách làm người ta bấm nhầm. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Distribute pool"
        className="flex h-[calc(100vh-4rem)] max-h-[860px] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
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

          <div className="inline-flex shrink-0 rounded bg-[#f4f5f7] p-0.5">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                aria-current={tab === key ? "page" : undefined}
                onClick={() => {
                  setTab(key);
                  setResult(null);
                  setNotice(null);
                }}
                className={`rounded px-3 py-1.5 text-sm font-semibold transition ${
                  tab === key
                    ? "bg-white text-[#0c66e4] shadow-sm"
                    : "text-[#5e6c84] hover:text-[#172b4d]"
                }`}
              >
                {key === "agents" ? "Agent config" : PRODUCT_LABEL[key]}
              </button>
            ))}
          </div>

          {tab === "agents" ? (
            <>
          {/* Ai thuộc product nào. Danh sách là roster agent đã đăng ký —
              chính bảng task_agents mà Config → Assistant membership → Agents
              hiển thị, đọc qua cùng một hàm fetchTaskAgents(). */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#dfe1e6]">
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_5rem_5rem] gap-2 border-b border-[#dfe1e6] bg-[#f7f8fa] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
              <span>Agent</span>
              <span className="text-center">{PRODUCT_LABEL.pc}</span>
              <span className="text-center">{PRODUCT_LABEL.health}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {roster.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[#6b778c]">
                  {rosterError
                    ? "Could not load the agent list."
                    : "No agents found. Add them under Config → Assistant membership → Agents."}
                </p>
              ) : (
                roster.map((agent) => {
                  const label = personLabel(agent.email, nameByEmail);
                  return (
                    <div
                      key={agent.email}
                      className="grid grid-cols-[minmax(0,1fr)_5rem_5rem] items-center gap-2 border-b border-[#ebecf0] px-3 py-2 transition last:border-b-0 hover:bg-[#f7f8f9]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Initials email={agent.email} label={label} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#172b4d]">
                            {label}
                          </span>
                          <span className="block truncate text-xs text-[#8993a4]">
                            {agent.email}
                          </span>
                        </span>
                      </span>
                      {LEAD_PRODUCTS.map((key) => (
                        <span key={key} className="flex justify-center">
                          <input
                            type="checkbox"
                            aria-label={`${label} covers ${PRODUCT_LABEL[key]}`}
                            disabled={savingAgents}
                            className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4] disabled:opacity-50"
                            checked={agent.products.includes(key)}
                            onChange={(event) =>
                              void toggleAgentProduct(agent.email, key, event.target.checked)
                            }
                          />
                        </span>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <p className="shrink-0 text-xs text-[#6b778c]">
            Agents come from Config → Assistant membership → Agents. Tick a
            product to put someone into that rotation; set how much they get on
            the{" "}
            {PRODUCT_LABEL.pc} and {PRODUCT_LABEL.health} tabs.
          </p>
            </>
          ) : (
            <>
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

          {/* flex-1 nên nó ăn hết chỗ trống còn lại của modal — modal đã cố
              định chiều cao, nên bảng cũng ổn định theo. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#dfe1e6]">
            <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_5rem_7rem_5rem] gap-2 border-b border-[#dfe1e6] bg-[#f7f8fa] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[#6b778c]">
              <span>Agent</span>
              <span>Weight</span>
              <span>Share</span>
              <span className="text-center">Receiving</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingWeights && draft.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[#6b778c]">
                  Loading agents…
                </p>
              ) : draft.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-[#6b778c]">
                  No agents cover {PRODUCT_LABEL[product]} yet — set that up in
                  Agent config.
                </p>
              ) : (
                draft.map((row) => {
                  const label = personLabel(row.agent_email, nameByEmail);
                  const share = shareOf(row);
                  const paused = !row.is_active || row.weight === 0;
                  return (
                    <div
                      key={row.agent_email}
                      className={`grid grid-cols-[minmax(0,1fr)_5rem_7rem_5rem] items-center gap-2 border-b border-[#ebecf0] px-3 py-2 transition last:border-b-0 hover:bg-[#f7f8f9] ${
                        paused ? "opacity-55" : ""
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Initials email={row.agent_email} label={label} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#172b4d]">
                            {label}
                          </span>
                          <span className="block truncate text-xs text-[#8993a4]">
                            {row.agent_email}
                          </span>
                        </span>
                      </span>

                      <input
                        type="number"
                        min={0}
                        aria-label={`Weight for ${label}`}
                        className={INPUT_CLASS}
                        value={row.weight}
                        onChange={(event) =>
                          update(row.agent_email, {
                            weight: Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                          })
                        }
                      />

                      {/* Thanh + số: cùng một thông tin, nhưng thanh cho thấy
                          chênh lệch giữa các dòng nhanh hơn con số. */}
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[#ebecf0]">
                          <span
                            className="block h-full rounded-full bg-[#0c66e4]"
                            style={{ width: `${share}%` }}
                          />
                        </span>
                        <span className="w-10 shrink-0 text-right text-xs font-bold tabular-nums text-[#42526e]">
                          {share}%
                        </span>
                      </span>

                      <span className="flex justify-center">
                        <input
                          type="checkbox"
                          aria-label={`${label} is receiving leads`}
                          className="h-4 w-4 rounded border-[#c1c7d0] text-[#0c66e4] focus:ring-[#0c66e4]"
                          checked={row.is_active}
                          onChange={(event) =>
                            update(row.agent_email, { is_active: event.target.checked })
                          }
                        />
                      </span>

                    </div>
                  );
                })
              )}
            </div>
          </div>

          {active.length > 0 ? (
            <div className="shrink-0 rounded-lg border border-[#b8d4ff] bg-[#e9f2ff] px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#0c3d91]">
                  Next {PRODUCT_LABEL[product]} leads go to
                </span>
                <span className="text-xs font-semibold text-[#42526e]">
                  {upcomingCounts
                    .map((row) => `${personLabel(row.email, nameByEmail)} ${row.count}`)
                    .join(" · ")}
                </span>
              </div>
              <ol className="mt-2 flex items-center gap-1 overflow-x-auto pb-1">
                {upcoming.map((email, index) => {
                  const label = personLabel(email, nameByEmail);
                  return (
                    <li
                      key={`${email}-${index}`}
                      title={`#${index + 1} — ${label}`}
                      className={`flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-2.5 ${
                        index === 0
                          ? "border-[#0c66e4] bg-white shadow-sm"
                          : "border-transparent bg-white/70"
                      }`}
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#dfe1e6] text-[10px] font-bold text-[#42526e]">
                        {index + 1}
                      </span>
                      <span className="max-w-[7rem] truncate text-xs font-semibold text-[#172b4d]">
                        {label}
                      </span>
                    </li>
                  );
                })}
              </ol>
              {dirty ? (
                <p className="mt-1 text-[11px] font-semibold text-[#974f0c]">
                  Preview only — save to make this the real order.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="shrink-0 rounded-lg border border-[#ffe380] bg-[#fffae6] px-3 py-2 text-sm text-[#974f0c]">
              Nobody is receiving {PRODUCT_LABEL[product]} — those leads stay in
              the pool.
            </p>
          )}

          {rosterError ? (
            <p className="rounded border border-[#ffe380] bg-[#fffae6] px-3 py-2 text-sm text-[#974f0c]">
              Could not load the account list. Close and reopen this dialog to
              try again.
            </p>
          ) : null}
            </>
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
