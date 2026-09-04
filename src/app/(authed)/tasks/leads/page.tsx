import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildLeadActor, isLeadViewAdmin } from "@/lib/leads/access";
import { fetchLeadAssignees } from "@/lib/leads/assignees";
import {
  fetchAllLeads,
  fetchLeadAlertSettings,
  fetchLeadVocabulary,
} from "@/lib/leads/queries";
import { resolveLeadOwnerEmails } from "@/lib/leads/membership";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { isLeadProduct } from "@/lib/leads/types";
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
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  if (view === "overview" && !actor.isManager) redirect("/unauthorized");
  const supabase = getSupabaseAdmin();

  // Resolved once: a worker's queue is their own leads plus every agent they
  // are an Assistant for. null means a manager, i.e. no owner filter at all.
  const ownerEmails = await resolveLeadOwnerEmails(actor);
  const [page, config, vocabulary, alertSettings, assignees] = await Promise.all([
    fetchAllLeads(
      actor,
      { product: productFilter, alert: params.alert },
      supabase,
      ownerEmails,
    ),
    fetchTableColumnsWithOptions("lead", supabase),
    fetchLeadVocabulary(supabase),
    // The alert engine is a pure function of these thresholds plus four stored
    // columns, so the badges can be computed in the browser — no extra request,
    // and they stay correct as the clock moves without a refresh.
    fetchLeadAlertSettings(supabase),
    // Only a manager can reassign, so only they need the roster. Loading it for
    // an agent would be one query nothing on their screen can use.
    actor.isManager ? fetchLeadAssignees() : Promise.resolve([]),
  ]);

  return (
    <LeadsClient
      productFilter={productFilter}
      editableOwnerEmails={ownerEmails}
      alertSettings={alertSettings}
      isManager={actor.isManager}
      initialLeads={page.rows}
      initialTotal={page.total}
      initialTruncated={page.truncated}
      columns={config.columns}
      columnOptions={config.options}
      statuses={vocabulary.statuses}
      archivedStatuses={vocabulary.archivedStatuses}
      interactionTypes={vocabulary.types}
      assignees={assignees}
    />
  );
}
