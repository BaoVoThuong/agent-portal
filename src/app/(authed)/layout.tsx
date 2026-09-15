import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Sidebar from "./_components/Sidebar";
import TopBar from "./_components/TopBar";
import { canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { fetchAvatarDirectory } from "@/lib/people/avatar-directory";
import { AvatarProvider } from "@/lib/people/AvatarProvider";

export default async function AuthedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // SONG SONG, không nối tiếp. Layout này chạy trên MỌI trang, nên một lượt
  // await thêm ở đây là cộng thẳng vào thời gian mở của cả ứng dụng. Danh bạ
  // avatar không phụ thuộc phiên đăng nhập, nên nó đi cùng chuyến với `auth()`
  // — vốn đã phải đợi một vòng tới database — và tốn thêm gần như bằng không.
  const [session, avatarEntries] = await Promise.all([
    auth(),
    fetchAvatarDirectory(),
  ]);
  if (!session?.user?.email) {
    redirect("/signin");
  }

  return (
    // Fixed viewport frame: the whole app is exactly one screen tall and never
    // page-scrolls. The sidebar + top bar stay pinned; only <main> scrolls.
    // This lets frame-style pages (e.g. the Task Board root, which is
    // `h-full min-h-0 flex-col`) fill the remaining height and scroll their
    // own table body internally instead of pushing the page taller.
    <AvatarProvider entries={avatarEntries}>
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
    </AvatarProvider>
  );
}
