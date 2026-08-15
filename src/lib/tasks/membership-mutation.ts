export const ASSISTANT_MEMBERSHIP_CODES = {
  SELF: "ASSISTANT_SELF_MEMBERSHIP",
  DUPLICATE: "ASSISTANT_DUPLICATE_MEMBERSHIP",
  CYCLE: "ASSISTANT_MEMBERSHIP_CYCLE",
  AGENT_INELIGIBLE: "ASSISTANT_AGENT_INELIGIBLE",
  ASSISTANT_INELIGIBLE: "ASSISTANT_ACCOUNT_INELIGIBLE",
} as const;

type MembershipError = { code?: string | null; message?: string | null };

/** Translate a service-role RPC failure into a stable client-safe contract. */
export function mapAssistantMembershipError(error: MembershipError): {
  code: string;
  error: string;
  status: 400 | 404 | 409 | 500;
} {
  const message = `${error.code ?? ""} ${error.message ?? ""}`;
  if (message.includes(ASSISTANT_MEMBERSHIP_CODES.SELF)) {
    return {
      code: ASSISTANT_MEMBERSHIP_CODES.SELF,
      error: "An agent cannot be their own assistant.",
      status: 400,
    };
  }
  if (message.includes(ASSISTANT_MEMBERSHIP_CODES.DUPLICATE)) {
    return {
      code: ASSISTANT_MEMBERSHIP_CODES.DUPLICATE,
      error: "This assistant membership already exists.",
      status: 409,
    };
  }
  if (message.includes(ASSISTANT_MEMBERSHIP_CODES.CYCLE)) {
    return {
      code: ASSISTANT_MEMBERSHIP_CODES.CYCLE,
      error: "This membership would create an assistant cycle.",
      status: 409,
    };
  }
  if (message.includes(ASSISTANT_MEMBERSHIP_CODES.AGENT_INELIGIBLE)) {
    return {
      code: ASSISTANT_MEMBERSHIP_CODES.AGENT_INELIGIBLE,
      error: "The selected agent is no longer active or eligible.",
      status: 409,
    };
  }
  if (message.includes(ASSISTANT_MEMBERSHIP_CODES.ASSISTANT_INELIGIBLE)) {
    return {
      code: ASSISTANT_MEMBERSHIP_CODES.ASSISTANT_INELIGIBLE,
      error: "The selected assistant account is no longer active or eligible.",
      status: 409,
    };
  }
  return { code: "ASSISTANT_MEMBERSHIP_FAILED", error: "Could not update assistant membership.", status: 500 };
}
