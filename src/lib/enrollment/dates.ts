export type EnrollmentDateResult = {
  value: string | null;
  error?: string;
};

export function parseEnrollmentDate(value: unknown): EnrollmentDateResult {
  if (value === null || value === undefined) return { value: null };
  if (typeof value !== "string") return { value: null, error: "Invalid due date." };

  const trimmed = value.trim();
  if (trimmed === "") return { value: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return { value: null, error: "Invalid due date." };
  }

  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    return { value: null, error: "Invalid due date." };
  }

  return { value: trimmed };
}
