import { PERMISSIONS } from "@/lib/rbac/permissions";
import { requirePermission } from "@/lib/rbac/server";
import { fetchAgentsAndCs } from "@/lib/tasks/agent-groups";
import { AgentGroupsClient } from "./_components/AgentGroupsClient";

export const dynamic = "force-dynamic";

export default async function AgentGroupsPage() {
  await requirePermission(PERMISSIONS.ACCOUNT_MANAGER);
  const { agents, cs } = await fetchAgentsAndCs();
  return <AgentGroupsClient agents={agents} cs={cs} />;
}
