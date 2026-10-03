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
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTaskAgents } from "@/lib/tasks/assignees";
import { LeadsClient } from "./_components/LeadsClient";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const session = await requireAnyPermission([
    PERMISSIONS.LEAD_MANAGE,
    PERMISSIONS.LEAD_WORK,
    PERMISSIONS.TASK_MANAGE,
  ]);
  const email = session.user.email ?? "";
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  if (view === "overview" && !actor.canViewAll) redirect("/unauthorized");
  const supabase = getSupabaseAdmin();

  // Resolved once: a worker's queue is their own leads plus every agent they
  // are an Assistant for. null means a manager, i.e. no owner filter at all.
  const ownerEmails = await resolveLeadOwnerEmails(actor);
  const [page, config, vocabulary, alertSettings, leadWorkers, agents] = await Promise.all([
    fetchAllLeads(
      actor,
      { alert: params.alert },
      supabase,
      ownerEmails,
    ),
    fetchTableColumnsWithOptions("lead", supabase),
    fetchLeadVocabulary(supabase),
    // The alert engine is a pure function of these thresholds plus four stored
    // columns, so the badges can be computed in the browser — no extra request,
    // and they stay correct as the clock moves without a refresh.
    fetchLeadAlertSettings(supabase),
    fetchLeadAssignees(),
    // Agent ở Config (task_agents) không nhất thiết có quyền Lead, nhưng Import
    // giao lead cho họ theo cột Agent — cần tên để bảng không hiện email.
    fetchTaskAgents(),
  ]);
  // "Agent" và "Collaborators" của lead = danh sách Agent ở Account Management
  // (task_agents, 2026-10-03): bộ lọc Assignee, ô Agent, gán hàng loạt, ô
  // Collaborators. Agent không cần quyền Lead — Assistant của họ xử lý lead.
  const agentPeople = agents.map((agent) => ({
    email: agent.email.trim().toLowerCase(),
    name: agent.name,
  }));
  const assignees = actor.canViewAll ? agentPeople : [];
  // Tên hiển thị: Agent + người có quyền Lead (người đang giữ lead cũ có thể
  // không phải Agent — vd. admin — vẫn phải hiện tên chứ không hiện email).
  const displayPeople = [
    ...agentPeople,
    ...leadWorkers.map((person) => ({
      email: person.email.trim().toLowerCase(),
      name: person.name,
    })),
  ];

  return (
    <LeadsClient
      currentUserEmail={email}
      canViewAll={Boolean(actor.canViewAll)}
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
      collaboratorRoster={agentPeople}
      agentNames={displayPeople}
    />
  );
}
