import { ACCOUNTING_PAGE_PERMISSION } from "@/lib/accounting/permission";
import { loadHealthCommissionRows, loadPortalAccounts } from "@/lib/accounting/health/source";
import { requirePermission } from "@/lib/rbac/server";
import { HealthCommissionClient } from "./HealthCommissionClient";

export const dynamic = "force-dynamic";

export default async function HealthCommissionPage() {
  await requirePermission(ACCOUNTING_PAGE_PERMISSION);
  const [{ packed, fetchedAt }, accounts] = await Promise.all([loadHealthCommissionRows(), loadPortalAccounts()]);
  return <HealthCommissionClient packed={packed} fetchedAt={fetchedAt} accounts={accounts} />;
}
