import { principalFromSessionUser } from "@/lib/authz/principal";
import { leadActorFromGrants, type LeadActor } from "./access";

type SessionUser = Parameters<typeof principalFromSessionUser>[0];

/** LeadActor của người đang đăng nhập, dựng từ grant (xem `taskActorForUser`). */
export async function leadActorForUser(user: SessionUser, email: string): Promise<LeadActor> {
  const principal = await principalFromSessionUser({ ...user, email });
  return leadActorFromGrants(email, principal?.grants ?? []);
}
