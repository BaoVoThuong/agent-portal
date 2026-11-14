import { redirect } from "next/navigation";
import { getLicensingActor } from "@/lib/health-licensing/access";
import { fetchLicensingAgents, loadLicensingBoard } from "@/lib/health-licensing/queries";
import LicensingClient from "./_components/LicensingClient";

export const dynamic = "force-dynamic";

export default async function HealthLicensingPage() {
  const actor = await getLicensingActor();
  if (!actor) redirect("/unauthorized");

  const [board, agents] = await Promise.all([
    loadLicensingBoard(),
    actor.canManage ? fetchLicensingAgents() : Promise.resolve([]),
  ]);

  return <LicensingClient canManage={actor.canManage} initialBoard={board} initialAgents={agents} />;
}
