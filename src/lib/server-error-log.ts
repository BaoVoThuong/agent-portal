const MAX_MESSAGE_LENGTH = 300;

/** Keep only small diagnostic fields; never serialize an arbitrary thrown object. */
export function safeErrorFields(error: unknown): {
  name: string;
  code: string | null;
  message: string;
} {
  if (!(error instanceof Error)) {
    return { name: "unknown", code: null, message: "non-Error thrown" };
  }
  const code = (error as { code?: unknown }).code;
  // Database errors can embed literal values. Remove common credentials and
  // personal identifiers before logging their diagnostic message.
  const message = error.message
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b(?:eyJ[A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/(['"])(?:(?!\1).)*\1/g, "[redacted-value]")
    .slice(0, MAX_MESSAGE_LENGTH);
  return {
    name: error.name,
    code: typeof code === "string" ? code : null,
    message,
  };
}
