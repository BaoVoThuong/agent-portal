import { auth } from "@/auth";
import { principalFromSessionUser } from "@/lib/authz/principal";
import {
  canAccessEnrollment,
  enrollmentActorFromGrants,
  type EnrollmentActor,
} from "./policy";

export * from "./policy";

/** EnrollmentActor của người đang đăng nhập (xem `taskActorForUser`). */
export async function enrollmentActorForUser(
  user: Parameters<typeof principalFromSessionUser>[0],
  email: string
): Promise<EnrollmentActor> {
  const principal = await principalFromSessionUser({ ...user, email });
  return enrollmentActorFromGrants(email, principal?.grants ?? []);
}

export async function loadEnrollmentActor():
  Promise<
    | { ok: true; actor: EnrollmentActor }
    | { ok: false; error: "Unauthorized"; status: 401 }
    | { ok: false; error: "Forbidden"; status: 403 }
  > {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, error: "Unauthorized", status: 401 };

  const actor = await enrollmentActorForUser(session.user, email);
  if (!canAccessEnrollment(actor)) {
    return { ok: false, error: "Forbidden", status: 403 };
  }

  return { ok: true, actor };
}
