import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { buildLeadActor } from "@/lib/leads/access";
import { fetchLeadsPage } from "@/lib/leads/queries";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import {
  toLeadProduct,
  type LeadAlertSettings,
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
  const rawProduct = Array.isArray(params.product) ? params.product[0] : params.product;
  const product = toLeadProduct(rawProduct);
  const session = await requireAnyPermission([
    PERMISSIONS.LEAD_MANAGE,
    PERMISSIONS.LEAD_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildLeadActor(session.user.permissions, email);
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  if (view === "overview" && !actor.isManager) redirect("/unauthorized");
  const supabase = getSupabaseAdmin();

  const [page, config, statusesResult, typesResult, settingsResult] = await Promise.all([
    fetchLeadsPage(actor, { product, alert: params.alert }, supabase),
    fetchTableColumnsWithOptions(product === "pc" ? "lead_pc" : "lead_health", supabase),
    supabase
      .from("lead_statuses")
      .select("id,product,label,color,position,kind,archived_at")
      .eq("product", product)
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("lead_interaction_types")
      .select("id,label,color,position,counts_as_contact,archived_at")
      .is("archived_at", null)
      .order("position"),
    supabase
      .from("lead_alert_settings")
      .select("product,no_contact_hours,stale_days,max_attempts")
      .eq("product", product)
      .maybeSingle(),
  ]);

  if (statusesResult.error) throw new Error(statusesResult.error.message);
  if (typesResult.error) throw new Error(typesResult.error.message);

  const settings = (settingsResult.data ?? {
    product,
    no_contact_hours: 24,
    stale_days: 3,
    max_attempts: 4,
  }) as LeadAlertSettings;

  return (
    <LeadsClient
      key={product}
      product={product}
      currentEmail={email}
      isManager={actor.isManager}
      initialLeads={page.rows}
      initialTotal={page.total}
      initialLimit={page.filter.limit}
      initialOffset={page.filter.offset}
      columns={config.columns}
      columnOptions={config.options}
      statuses={statusesResult.data as LeadStatus[]}
      interactionTypes={typesResult.data as LeadInteractionType[]}
      alertSettings={settings}
    />
  );
}
