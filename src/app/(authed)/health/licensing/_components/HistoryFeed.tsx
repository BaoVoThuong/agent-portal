"use client";

import { useEffect, useState } from "react";
import type { LicensingHistoryEntry } from "@/lib/health-licensing/types";
import { Initials } from "./AppointmentDialog";
import { formatTimestamp } from "./licensing-view";

type Page = { entries: LicensingHistoryEntry[]; nextBeforeId: number | null };

type Scope = { stateCode?: string | null; appointmentId?: string | null };

async function fetchPage(scope: Scope, beforeId: number | null): Promise<Page> {
  const params = new URLSearchParams();
  if (scope.stateCode) params.set("state", scope.stateCode);
  if (scope.appointmentId) params.set("appointment", scope.appointmentId);
  if (beforeId) params.set("before", String(beforeId));
  const response = await fetch(`/api/health-licensing/history?${params}`, { cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as Partial<Page> & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not load the history.");
  return { entries: payload.entries ?? [], nextBeforeId: payload.nextBeforeId ?? null };
}

/** Lịch sử, mới nhất trước. `version` đổi thì tải lại (sau mỗi lần lưu). */
export function HistoryFeed({
  stateCode = null,
  appointmentId = null,
  version,
  onCount,
}: {
  stateCode?: string | null;
  appointmentId?: string | null;
  version: number;
  /** Số dòng đã tải (để hiện trên tab), null khi còn trang cũ hơn. */
  onCount?: (count: number, hasMore: boolean) => void;
}) {
  const [result, setResult] = useState<{ key: string; page: Page | null; error: string | null }>({
    key: "",
    page: null,
    error: null,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  const key = `${stateCode ?? ""}:${appointmentId ?? ""}:${version}`;

  useEffect(() => {
    let alive = true;
    fetchPage({ stateCode, appointmentId }, null).then(
      (page) => {
        if (!alive) return;
        setResult({ key, page, error: null });
        onCount?.(page.entries.length, page.nextBeforeId !== null);
      },
      (error: Error) => alive && setResult({ key, page: null, error: error.message }),
    );
    return () => {
      alive = false;
    };
    // onCount chỉ là chỗ báo số; đổi hàm không cần tải lại.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCode, appointmentId, key]);

  async function loadMore() {
    if (!result.page?.nextBeforeId) return;
    setLoadingMore(true);
    try {
      const next = await fetchPage({ stateCode, appointmentId }, result.page.nextBeforeId);
      setResult((cur) =>
        cur.page ? { ...cur, page: { entries: [...cur.page.entries, ...next.entries], nextBeforeId: next.nextBeforeId } } : cur,
      );
    } catch (error) {
      setResult((cur) => ({ ...cur, error: (error as Error).message }));
    } finally {
      setLoadingMore(false);
    }
  }

  if (result.key !== key && !result.error) return <p className="text-sm text-[#97a0af]">Loading…</p>;
  if (result.error && !result.page) return <p className="text-sm font-semibold text-[#bf2600]">{result.error}</p>;
  const entries = result.page?.entries ?? [];
  if (!entries.length) return <p className="text-sm text-[#97a0af]">No changes yet.</p>;

  return (
    <div className="flex flex-col gap-4">
      {entries.map((entry) => (
        <HistoryRow key={entry.id} entry={entry} />
      ))}
      {result.page?.nextBeforeId ? (
        <button
          type="button"
          className="self-start rounded px-2 py-1 text-sm font-semibold text-[#0c66e4] transition hover:bg-[#e9f2ff] disabled:opacity-50"
          onClick={() => void loadMore()}
          disabled={loadingMore}
        >
          {loadingMore ? "Loading…" : "Show older changes"}
        </button>
      ) : null}
    </div>
  );
}

function HistoryRow({ entry }: { entry: LicensingHistoryEntry }) {
  const actor = entry.actorName ?? "System";
  const parts = entry.carrier ? entry.summary.split(entry.carrier) : [entry.summary];
  return (
    <div className="flex gap-2.5">
      <Initials name={actor} size={28} />
      <div className="min-w-0 flex-1 text-sm text-[#42526e]">
        <div>
          <span className="font-semibold text-[#172b4d]">{actor}</span>{" "}
          {entry.carrier && parts.length > 1 ? (
            <>
              {parts[0]}
              <span className="font-semibold text-[#172b4d]">{entry.carrier}</span>
              {parts.slice(1).join(entry.carrier)}
            </>
          ) : (
            entry.summary
          )}
        </div>
        {entry.changes.length ? (
          <ul className="mt-1 space-y-0.5 text-[13px] text-[#44546f]">
            {entry.changes.map((change, i) => (
              <li key={i} className="break-words">
                {change}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-0.5 text-xs text-[#97a0af]">{formatTimestamp(entry.at)}</div>
      </div>
    </div>
  );
}
