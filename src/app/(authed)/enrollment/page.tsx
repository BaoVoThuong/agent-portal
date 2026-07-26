import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  buildTaskActor,
  isTaskViewAdmin,
} from "@/lib/tasks/access";
import { canManageEnrollmentOptions } from "@/lib/enrollment/access";
import {
  fetchEnrollmentPeople,
  fetchEnrollmentRecords,
} from "@/lib/enrollment/queries";
import { fetchEnrollmentOptionData } from "@/lib/enrollment/options";
import { toEnrollmentProgram } from "@/lib/enrollment/types";
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

  const session = await requireAnyPermission([
    PERMISSIONS.TASK_MANAGE,
    PERMISSIONS.TASK_WORK,
  ]);
  const email = session.user.email ?? "";
  const actor = buildTaskActor(session.user.permissions, email, {
    isAdmin: isTaskViewAdmin(session.user),
  });

  const [records, people, optionData] = await Promise.all([
    fetchEnrollmentRecords(program),
    fetchEnrollmentPeople(),
    fetchEnrollmentOptionData(program),
  ]);

  return (
    <EnrollmentClient
      key={program}
      program={program}
      initialRecords={records}
      people={people}
      optionSets={optionData.sets}
      initialOptions={optionData.options}
      currentEmail={email}
      canManageOptions={canManageEnrollmentOptions(actor)}
    />
  );
}
