import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { getFirstAccessiblePath } from "@/lib/rbac/routes";

export default async function UnauthorizedPage() {
  const session = await getSession();
  const permissions = session?.user?.permissions ?? [];

  // Landed here while the database was stalled and access could not be read:
  // say so instead of "No Access", and let a reload bring them back.
  if (session?.user?.accessUnavailable) {
    return (
      <div className="px-8 py-8">
        <section className="rounded-lg border border-[#d8dee7] bg-white p-6">
          <h1 className="text-xl font-semibold text-[#16233a]">Portal is busy</h1>
          <p className="mt-2 text-sm text-[#667085]">
            Your access could not be checked because the portal is slow right
            now. Your roles have not changed. Please reload this page in a minute.
          </p>
        </section>
      </div>
    );
  }

  // Sent here during a stall, then reloaded after it cleared.
  const home = getFirstAccessiblePath(permissions);
  if (home !== "/unauthorized") redirect(home);

  return (
    <div className="px-8 py-8">
      <section className="rounded-lg border border-[#d8dee7] bg-white p-6">
        <h1 className="text-xl font-semibold text-[#16233a]">No Access</h1>
        <p className="mt-2 text-sm text-[#667085]">
          Your account does not currently have access to any portal area. Please
          contact an administrator to update your roles.
        </p>
      </section>
    </div>
  );
}
