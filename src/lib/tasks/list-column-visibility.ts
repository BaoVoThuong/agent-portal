export interface TaskListColumnVisibilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const TASK_LIST_COLUMNS_STORAGE_KEY = "tasks.list.columns.v2";

export function readHiddenTaskListColumns(
  storage: TaskListColumnVisibilityStorage | undefined,
  validKeys: ReadonlySet<string>,
  lockedKeys: ReadonlySet<string>,
  defaultHiddenKeys: ReadonlySet<string> = new Set()
): Set<string> {
  if (!storage) return new Set(defaultHiddenKeys);

  try {
    const raw = storage.getItem(TASK_LIST_COLUMNS_STORAGE_KEY);
    if (raw === null) return new Set(defaultHiddenKeys);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();

    return new Set(
      parsed.filter(
        (key): key is string =>
          typeof key === "string" && validKeys.has(key) && !lockedKeys.has(key)
      )
    );
  } catch {
    return new Set();
  }
}

export function writeHiddenTaskListColumns(
  storage: TaskListColumnVisibilityStorage | undefined,
  hiddenKeys: ReadonlySet<string>
): void {
  if (!storage) return;

  try {
    storage.setItem(TASK_LIST_COLUMNS_STORAGE_KEY, JSON.stringify([...hiddenKeys]));
  } catch {
    // Display preference only; ignore storage failures.
  }
}

export function toggleHiddenTaskListColumn(
  current: ReadonlySet<string>,
  key: string,
  lockedKeys: ReadonlySet<string>
): Set<string> {
  const next = new Set(current);
  if (lockedKeys.has(key)) return next;

  if (next.has(key)) next.delete(key);
  else next.add(key);

  return next;
}
