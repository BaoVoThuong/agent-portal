import { redirect } from "next/navigation";
import { getTimeOffActor } from "@/lib/time-off/access";
import { monthBounds } from "@/lib/time-off/business-days";
import { fetchTimeOffDashboard } from "@/lib/time-off/queries";
import TimeOffClient from "./TimeOffClient";

export const dynamic = "force-dynamic";

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

/** Phải khớp với `Tab` trong TimeOffClient — một hàng tab phẳng, không lồng. */
type TimeOffTab = "overview" | "approvals" | "team";

// Địa chỉ cũ vẫn mở đúng chỗ: 6 tab gộp còn 3 (2026-11-01), và `?tab=admin`
// từ hồi Administration còn là một tab chứa các tab con.
const LEGACY_TABS: Record<string, TimeOffTab> = {
  admin: "team",
  balances: "team",
  accruals: "team",
  history: "approvals",
  "company-days": "overview",
};

function initialTab(value: string | undefined, canManage: boolean): TimeOffTab {
  if (!canManage || !value) return "overview";
  if (value === "approvals" || value === "team") return value;
  return LEGACY_TABS[value] ?? "overview";
}

export default async function TimeOffPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getTimeOffActor();
  if (!actor) redirect("/unauthorized");
  const params = searchParams ? await searchParams : {};
  const rawMonth = Array.isArray(params.month) ? params.month[0] : params.month;
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const monthKey = typeof rawMonth === "string" && monthBounds(rawMonth)
    ? rawMonth
    : currentMonthKey();
  const data = await fetchTimeOffDashboard({
    accountId: actor.accountId,
    isManager: actor.canManage,
    monthKey,
  });

  return (
    <TimeOffClient
      accountId={actor.accountId}
      canManage={actor.canManage}
      monthKey={monthKey}
      initialTab={initialTab(rawTab, actor.canManage)}
      initialApprovalView={rawTab === "history" ? "history" : "pending"}
      initialData={data}
    />
  );
}
