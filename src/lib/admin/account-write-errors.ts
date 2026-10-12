export function accountWriteFailure(error: { code?: string; message: string }): {
  status: 400 | 404 | 409 | 500;
  error: string;
} {
  if (error.message.includes("LAST_ADMIN")) {
    return { status: 400, error: "At least one active Admin account is required." };
  }
  if (error.message.includes("USER_NOT_FOUND")) {
    return { status: 404, error: "User not found." };
  }
  if (error.message.includes("AGENT_HAS_PERSONAL_LEADS")) {
    return {
      status: 409,
      error: "This Agent still owns Personal leads. Reassign them to another Agent before deactivating the account.",
    };
  }
  if (error.code === "23505") {
    return { status: 409, error: "An account with this email or Agent ID already exists." };
  }
  return { status: 500, error: error.message };
}
