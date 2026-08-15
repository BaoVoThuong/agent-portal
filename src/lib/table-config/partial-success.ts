export const LAYOUT_RESET_FAILED_CODE = "LAYOUT_RESET_FAILED" as const;

export type ConfigMutationWarning = {
  code: typeof LAYOUT_RESET_FAILED_CODE;
  message: string;
};

export function layoutResetFailedWarning(): ConfigMutationWarning {
  return {
    code: LAYOUT_RESET_FAILED_CODE,
    message:
      "The change was saved, but saved table layouts could not be reset. Refresh layouts and retry if needed.",
  };
}

export function isConfigMutationWarning(value: unknown): value is ConfigMutationWarning {
  if (!value || typeof value !== "object") return false;
  const warning = value as Record<string, unknown>;
  return (
    warning.code === LAYOUT_RESET_FAILED_CODE &&
    typeof warning.message === "string" &&
    warning.message.length > 0
  );
}
