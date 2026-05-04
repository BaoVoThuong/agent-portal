import { auth } from "@/auth";
import SettingsClient from "./SettingsClient";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";

  return <SettingsClient email={email} />;
}
