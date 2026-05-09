import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requirePermission(PERMISSIONS.SETTINGS);
  const email = session?.user?.email ?? "";

  return <SettingsClient email={email} />;
}
