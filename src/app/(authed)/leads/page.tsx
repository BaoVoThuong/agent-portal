import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildLeadActor } from "@/lib/leads/access";
import { fetchLeadAssignees } from "@/lib/leads/assignees";
import { fetchAllLeads } from "@/lib/leads/queries";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import {
  isLeadProduct,
  type LeadInteractionType,
  type LeadStatus,
} from "@/lib/leads/types";
import { getSupabaseAdmin } from "@/lib/supabase";
import { LeadsClient } from "./_components/LeadsClient";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  // One list for both products now; ?product= is a filter the user can clear,
  // not two separate screens.
  const rawProduct = Array.isArray(params.product) ? params.product[0] : params.product;
  const productFilter = isLeadProduct(rawProduct) ? rawProduct : null;
  const session = await requireAnyPermission([
    PERMISSIONS.LEAD_MANAGE,
    PERMISSIONS.LEAD_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildLeadActor(session.user.permissions, email);
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  if (view === "overview" && !actor.isManager) redirect("/unauthorized");
  const supabase = getSupabaseAdmin();

  const [page, config, statusesResult, typesResult, assignees] =
    await Promise.all([
    fetchAllLeads(actor, { product: productFilter, alert: params.alert }, supabase),
    fetchTableColumnsWithOptions("lead", supabase),
    supabase
      .from("lead_statuses")
      // Statuses stay per-product: a P&C pipeline and a Health pipeline are
      // genuinely different. The client picks the right list per lead row.
      .select("id,product,label,color,position,kind,archived_at")
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("lead_interaction_types")
      .select("id,label,color,position,counts_as_contact,archived_at")
      .is("archived_at", null)
      .order("position"),
    // Only a manager can reassign, so only they need the roster. Loading it for
    // an agent would be one query nothing on their screen can use.
    actor.isManager ? fetchLeadAssignees() : Promise.resolve([]),
  ]);

  if (statusesResult.error) throw new Error(statusesResult.error.message);
  if (typesResult.error) throw new Error(typesResult.error.message);

  return (
    <LeadsClient
      productFilter={productFilter}
      currentEmail={email}
      isManager={actor.isManager}
      initialLeads={page.rows}
      initialTotal={page.total}
      columns={config.columns}
      columnOptions={config.options}
      statuses={statusesResult.data as LeadStatus[]}
      interactionTypes={typesResult.data as LeadInteractionType[]}
      assignees={assignees}
    />
  );
}
