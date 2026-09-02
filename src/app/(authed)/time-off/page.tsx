import { redirect } from "next/navigation";
import { getTimeOffActor } from "@/lib/time-off/access";
import { monthBounds } from "@/lib/time-off/business-days";
import { fetchTimeOffDashboard } from "@/lib/time-off/queries";
import TimeOffClient from "./TimeOffClient";

export const dynamic = "force-dynamic";

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
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
      canManage={actor.canManage}
      monthKey={monthKey}
      initialData={data}
    />
  );
}
