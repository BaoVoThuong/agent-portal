export const CONFIG_VALUE_INACTIVE_OR_MISSING = "CONFIG_VALUE_INACTIVE_OR_MISSING" as const;
export const CONFIG_DUPLICATE_OPTION_LABEL = "CONFIG_DUPLICATE_OPTION_LABEL" as const;

export function inactiveConfigValueResponse(resource: string) {
  return {
    error: `${resource} is inactive or missing. Refresh the configuration and try again.`,
    code: CONFIG_VALUE_INACTIVE_OR_MISSING,
  } as const;
}

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

export function duplicateOptionLabelResponse() {
  return {
    error: "An active option with this label already exists in this column.",
    code: CONFIG_DUPLICATE_OPTION_LABEL,
  } as const;
}
