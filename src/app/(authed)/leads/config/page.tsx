import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildLeadActor, canManageLeads } from "@/lib/leads/access";
import {
  fetchAllTableColumnOptions,
  fetchAllTableColumns,
} from "@/lib/table-config/queries";
import { emptyEnrollmentOptionData } from "../../config/empty-option-data";
import { ConfigClient } from "../../config/_components/ConfigClient";

export const dynamic = "force-dynamic";

// Deliberately separate from /config. That screen owns the Health scopes and
// carries task-only sections — categories, assistant membership, SLA times —
// none of which mean anything for a lead.
const LEAD_SCOPES = ["lead_pc", "lead_health"] as const;
const LEAD_TABS = ["table", "value"] as const;

export default async function LeadConfigPage() {
  const session = await requireAnyPermission([PERMISSIONS.LEAD_MANAGE]);
  const email = session.user.email ?? "";
  const actor = buildLeadActor(session.user.permissions, email);
  // requireAnyPermission already gates the route; this second check keeps the
  // page honest if that permission list is ever widened.
  if (!canManageLeads(actor)) redirect("/unauthorized");

  const [columns, options] = await Promise.all([
    fetchAllTableColumns(),
    fetchAllTableColumnOptions(),
  ]);

  // Same readiness rule as /config, but over the lead scopes only: a scope that
  // has not been materialised yet serves synthetic `system-<scope>-<key>` ids,
  // and writing against one of those fails with an invalid-uuid error.
  const columnsReady = LEAD_SCOPES.every((scope) =>
    (columns[scope] ?? []).every((column) => !column.id.startsWith("system-"))
  );

  return (
    <ConfigClient
      title="Lead Table Configuration"
      scopes={LEAD_SCOPES}
      tabs={LEAD_TABS}
      initialColumns={columns}
      initialOptions={columnsReady ? options : { cs: [], aca: [], medicare: [], lead_pc: [], lead_health: [] }}
      initialAgents={[]}
      candidates={[]}
      assignees={[]}
      initialMembers={[]}
      initialCategories={[]}
      initialSlaRules={[]}
      initialOptionData={{
        aca: emptyEnrollmentOptionData(),
        medicare: emptyEnrollmentOptionData(),
      }}
      sectionStatus={{
        columns: {
          available: columnsReady,
          error: columnsReady
            ? undefined
            : "Lead columns are using a migration fallback. Editing is disabled until the schema is applied.",
        },
        options: {
          available: columnsReady,
          error: columnsReady
            ? undefined
            : "Dropdown values are unavailable until the lead table-config schema is applied.",
        },
        categories: { available: false },
        assistants: { available: false },
        sla: { available: false },
        enrollmentOptions: {
          cs: { available: true },
          aca: { available: false },
          medicare: { available: false },
          lead_pc: { available: true },
          lead_health: { available: true },
        },
      }}
    />
  );
}
