import type { EnrollmentProgram } from "./types";

// Minimal shape of the browser Storage API we need. It is injected instead of
// read from window.localStorage directly, so this module stays testable in Node.
export interface ColumnVisibilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function columnVisibilityStorageKey(program: EnrollmentProgram): string {
  return `enrollment.columns.${program}`;
}

export function readHiddenColumns(
  storage: ColumnVisibilityStorage | undefined,
  program: EnrollmentProgram,
  validKeys: ReadonlySet<string>,
  defaultHiddenKeys: ReadonlySet<string> = new Set()
): Set<string> {
  if (!storage) return new Set(defaultHiddenKeys);

  try {
    const raw = storage.getItem(columnVisibilityStorageKey(program));
    if (raw === null) return new Set(defaultHiddenKeys);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set(defaultHiddenKeys);

    return new Set(
      parsed.filter((key): key is string => typeof key === "string" && validKeys.has(key))
    );
  } catch {
    return new Set(defaultHiddenKeys);
  }
}

export function writeHiddenColumns(
  storage: ColumnVisibilityStorage | undefined,
  program: EnrollmentProgram,
  hiddenKeys: ReadonlySet<string>
): void {
  if (!storage) return;

  try {
    storage.setItem(columnVisibilityStorageKey(program), JSON.stringify([...hiddenKeys]));
  } catch {
    // Column visibility is only a display preference; ignore storage failures.
  }
}

export function toggleHiddenColumn(
  current: ReadonlySet<string>,
  key: string,
  isSticky: boolean
): Set<string> {
  const next = new Set(current);
  if (isSticky) return next;

  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }

  return next;
}
