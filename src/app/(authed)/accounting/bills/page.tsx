import { ACCOUNTING_PAGE_PERMISSION } from "@/lib/accounting/permission";
import { loadHealthCommissionRows, loadPortalAccounts } from "@/lib/accounting/health/source";
import { requirePermission } from "@/lib/rbac/server";
import { CommissionBillClient } from "./CommissionBillClient";

export const dynamic = "force-dynamic";

export default async function CommissionBillPage() {
  await requirePermission(ACCOUNTING_PAGE_PERMISSION);
  const [{ packed }, accounts] = await Promise.all([loadHealthCommissionRows(), loadPortalAccounts()]);
  return <CommissionBillClient packed={packed} accounts={accounts} />;
}
