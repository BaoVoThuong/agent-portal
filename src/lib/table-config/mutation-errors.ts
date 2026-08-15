export const CONFIG_VALUE_INACTIVE_OR_MISSING = "CONFIG_VALUE_INACTIVE_OR_MISSING" as const;

export function inactiveConfigValueResponse(resource: string) {
  return {
    error: `${resource} is inactive or missing. Refresh the configuration and try again.`,
    code: CONFIG_VALUE_INACTIVE_OR_MISSING,
  } as const;
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}
