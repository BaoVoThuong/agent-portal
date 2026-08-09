import { redirect } from "next/navigation";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  buildTaskActor,
  isTaskViewAdmin,
} from "@/lib/tasks/access";
import { canManageEnrollmentOptions } from "@/lib/enrollment/access";
import {
  fetchEnrollmentRecordById,
  fetchEnrollmentPeople,
  fetchEnrollmentRecords,
} from "@/lib/enrollment/queries";
import { fetchTaskAgents } from "@/lib/tasks/assignees";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import { toEnrollmentProgram } from "@/lib/enrollment/types";
import {
  fetchTableColumnOptions,
  fetchTableColumns,
} from "@/lib/table-config/queries";
import { canActorExport } from "@/lib/table-config/export-access";
import {
  isRecordInScope,
  resolveEnrollmentScope,
} from "@/lib/enrollment/scope";
import { EnrollmentClient } from "./_components/EnrollmentClient";

export const dynamic = "force-dynamic";

export default async function EnrollmentPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : {};
  const program = toEnrollmentProgram(
    Array.isArray(params.program) ? params.program[0] : params.program
  );
  const recordId = Array.isArray(params.record) ? params.record[0] : params.record;

  const session = await requireAnyPermission([
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.TASK_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });
  const scope = await resolveEnrollmentScope(actor);

  const [
    records,
    people,
    agents,
    optionData,
    tableColumns,
    tableColumnOptions,
    canExport,
  ] = await Promise.all([
    fetchEnrollmentRecords(program),
    fetchEnrollmentPeople(),
    fetchTaskAgents(),
    fetchEnrollmentOptionData(program),
    fetchTableColumns(program),
    fetchTableColumnOptions(program),
    canActorExport(actor),
  ]);

  if (recordId) {
    const fallbackRecord = records.some((record) => record.id === recordId)
      ? null
      : await fetchEnrollmentRecordById(recordId);
    const linkedRecord =
      records.find((record) => record.id === recordId) ??
      (fallbackRecord && isRecordInScope(scope, fallbackRecord.agent_email)
        ? fallbackRecord
        : null);
    if (linkedRecord && linkedRecord.program !== program) {
      const nextParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === "string") nextParams.set(key, value);
        else if (Array.isArray(value) && value[0]) nextParams.set(key, value[0]);
      }
      nextParams.set("program", linkedRecord.program);
      nextParams.set("record", linkedRecord.id);
      redirect(`/enrollment?${nextParams.toString()}`);
    }
  }

  return (
    <EnrollmentClient
      key={program}
      program={program}
      initialRecords={records}
      people={people}
      agents={agents}
      initialOptions={optionData.options}
      tableColumns={tableColumns}
      tableColumnOptions={tableColumnOptions}
      currentEmail={email}
      canManageOptions={canManageEnrollmentOptions(actor)}
      canExport={canExport}
    />
  );
}
