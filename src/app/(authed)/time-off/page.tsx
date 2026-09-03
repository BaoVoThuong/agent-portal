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
type TimeOffTab =
  | "overview"
  | "balances"
  | "accruals"
  | "approvals"
  | "history"
  | "company-days";

const ADMIN_TABS: readonly TimeOffTab[] = [
  "balances",
  "accruals",
  "approvals",
  "history",
  "company-days",
];

function initialTab(value: string | undefined, canManage: boolean): TimeOffTab {
  if (!canManage) return "overview";
  // `?tab=admin` là địa chỉ cũ, từ hồi Administration còn là một tab chứa năm
  // tab con. Người ta đã lưu link dạng đó, nên đưa về mục đầu tiên thay vì im
  // lặng rơi về "My leave".
  if (value === "admin") return "balances";
  return ADMIN_TABS.find((tab) => tab === value) ?? "overview";
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
      initialData={data}
    />
  );
}
