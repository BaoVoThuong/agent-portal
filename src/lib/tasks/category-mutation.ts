export const TASK_CATEGORY_INACTIVE = "TASK_CATEGORY_INACTIVE" as const;
export const TASK_CATEGORY_INVALID = "TASK_CATEGORY_INVALID" as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isTaskCategoryId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function invalidTaskCategoryResponse() {
  return {
    error: "Category must be a valid identifier.",
    code: TASK_CATEGORY_INVALID,
  } as const;
}

export function inactiveTaskCategoryResponse() {
  return {
    error: "Category is inactive or missing. Refresh the category list and try again.",
    code: TASK_CATEGORY_INACTIVE,
  } as const;
}

/** Maps only the category constraint failures; callers keep other errors opaque. */
export function mapTaskCategoryMutationError(
  error: { code?: string | null; message?: string | null } | null | undefined
) {
  const code = error?.code ?? "";
  const message = error?.message?.toLowerCase() ?? "";
  if (
    message.includes("task_category_inactive") ||
    (code === "23503" &&
      (message.includes("task_categories") || message.includes("tasks_category_id_fkey")))
  ) {
    return inactiveTaskCategoryResponse();
  }
  return null;
}
