import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Sidebar from "./_components/Sidebar";
import TopBar from "./_components/TopBar";
import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/signin");
  }

  return (
    // Fixed viewport frame: the whole app is exactly one screen tall and never
    // page-scrolls. The sidebar + top bar stay pinned; only <main> scrolls.
    // This lets frame-style pages (e.g. the Task Board root, which is
    // `h-full min-h-0 flex-col`) fill the remaining height and scroll their
    // own table body internally instead of pushing the page taller.
    <div className="flex h-screen overflow-hidden bg-[#f7f9fc]">
      <Sidebar
        permissions={session.user.permissions ?? []}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TopBar
          userName={session.user.name ?? null}
          userEmail={session.user.email}
          agentId={session.user.agentId ?? null}
          canUseTasks={canAny(session.user.permissions, [
            PERMISSIONS.TASK_MANAGE,
            PERMISSIONS.TASK_WORK,
          ])}
        />
        {/* min-h-0 makes <main> a bounded flex child; overflow-y-auto lets
            ordinary (non-frame) pages scroll here while the shell stays put. */}
        <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
