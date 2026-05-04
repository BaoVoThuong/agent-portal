import { redirect } from "next/navigation";
import { auth } from "@/auth";
import Sidebar from "./_components/Sidebar";
import TopBar from "./_components/TopBar";

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
    <div className="flex min-h-screen bg-[#f7f9fc]">
      <Sidebar />
      <div className="flex flex-1 min-w-0 flex-col">
        <TopBar
          userName={session.user.name ?? null}
          userEmail={session.user.email}
        />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
