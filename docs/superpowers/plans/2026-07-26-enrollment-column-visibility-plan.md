# Enrollment Column Visibility — Completion Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two gaps found when auditing the already-implemented (but uncommitted) Enrollment column show/hide feature against `docs/superpowers/specs/2026-07-25-enrollment-column-visibility-design.md`: (1) zero test coverage on the storage/visibility logic, and (2) a stale placement description in the spec.

**Architecture:** Extract the pure, currently-untested localStorage read/write/validate/toggle logic out of `EnrollmentClient.tsx` into a new `src/lib/enrollment/column-visibility.ts` module — following the same pure-logic-lives-in-`src/lib`, tested-with-vitest pattern already used by `src/lib/tasks/sorting.ts` / `sorting.test.ts` in this codebase. The module takes an injectable storage object (not `window.localStorage` directly) so it's testable under this project's `environment: "node"` vitest config without jsdom. `EnrollmentClient.tsx`'s existing `useHiddenEnrollmentColumns` hook becomes a thin wrapper around the new module — no behavior change, verified by `tsc --noEmit`, `eslint`, and the full `vitest run` suite staying green.

**Tech Stack:** TypeScript, React (Next.js client component), Vitest.

## Global Constraints

- No DB/schema/API changes — this whole feature is a client-side display preference (spec §3, already implemented and out of scope to change).
- Test environment is `"node"` (see `vitest.config.ts`), not jsdom — do not rely on a global `window`/`localStorage`; inject storage instead.
- Preserve exact current behavior: storage key format `enrollment.columns.${program}`, hidden-keys-only JSON array, invalid/missing data → empty Set, sticky columns (`key`, `client`, `qc`) never toggle, silent failure on storage errors (spec §4, §8).
- `npm run typecheck`, `npm run lint`, and `npm run test:run` must all stay green after every task.

---

## Task 1: Extract column-visibility logic into a tested `src/lib/enrollment` module

**Files:**
- Create: `src/lib/enrollment/column-visibility.ts`
- Create: `src/lib/enrollment/column-visibility.test.ts`

**Interfaces:**
- Consumes: `EnrollmentProgram` type from `src/lib/enrollment/types.ts` (already exists: `export type EnrollmentProgram = "aca" | "medicare"`).
- Produces (used by Task 2):
  - `columnVisibilityStorageKey(program: EnrollmentProgram): string`
  - `interface ColumnVisibilityStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; }`
  - `readHiddenColumns(storage: ColumnVisibilityStorage | undefined, program: EnrollmentProgram, validKeys: ReadonlySet<string>): Set<string>`
  - `writeHiddenColumns(storage: ColumnVisibilityStorage | undefined, program: EnrollmentProgram, hiddenKeys: ReadonlySet<string>): void`
  - `toggleHiddenColumn(current: ReadonlySet<string>, key: string, isSticky: boolean): Set<string>`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/enrollment/column-visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  columnVisibilityStorageKey,
  readHiddenColumns,
  toggleHiddenColumn,
  writeHiddenColumns,
  type ColumnVisibilityStorage,
} from "@/lib/enrollment/column-visibility";

class FakeStorage implements ColumnVisibilityStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

class ThrowingStorage implements ColumnVisibilityStorage {
  getItem(): string | null {
    throw new Error("blocked");
  }
  setItem(): void {
    throw new Error("blocked");
  }
}

const VALID_KEYS = new Set(["key", "client", "stage", "carrier", "qc"]);

describe("columnVisibilityStorageKey", () => {
  it("namespaces the key by program", () => {
    expect(columnVisibilityStorageKey("aca")).toBe("enrollment.columns.aca");
    expect(columnVisibilityStorageKey("medicare")).toBe("enrollment.columns.medicare");
  });
});

describe("readHiddenColumns", () => {
  it("returns empty set when storage is undefined", () => {
    expect(readHiddenColumns(undefined, "aca", VALID_KEYS)).toEqual(new Set());
  });

  it("returns empty set when nothing stored yet", () => {
    const storage = new FakeStorage();
    expect(readHiddenColumns(storage, "aca", VALID_KEYS)).toEqual(new Set());
  });

  it("reads back a previously written hidden set", () => {
    const storage = new FakeStorage();
    storage.setItem("enrollment.columns.aca", JSON.stringify(["stage", "carrier"]));
    expect(readHiddenColumns(storage, "aca", VALID_KEYS)).toEqual(
      new Set(["stage", "carrier"])
    );
  });

  it("drops keys that aren't in validKeys", () => {
    const storage = new FakeStorage();
    storage.setItem(
      "enrollment.columns.aca",
      JSON.stringify(["stage", "some-removed-column"])
    );
    expect(readHiddenColumns(storage, "aca", VALID_KEYS)).toEqual(new Set(["stage"]));
  });

  it("returns empty set for malformed JSON", () => {
    const storage = new FakeStorage();
    storage.setItem("enrollment.columns.aca", "{not valid json");
    expect(readHiddenColumns(storage, "aca", VALID_KEYS)).toEqual(new Set());
  });

  it("returns empty set when stored value isn't an array", () => {
    const storage = new FakeStorage();
    storage.setItem("enrollment.columns.aca", JSON.stringify({ stage: true }));
    expect(readHiddenColumns(storage, "aca", VALID_KEYS)).toEqual(new Set());
  });

  it("returns empty set when storage.getItem throws", () => {
    expect(readHiddenColumns(new ThrowingStorage(), "aca", VALID_KEYS)).toEqual(new Set());
  });

  it("keeps aca and medicare under separate keys", () => {
    const storage = new FakeStorage();
    storage.setItem("enrollment.columns.aca", JSON.stringify(["stage"]));
    storage.setItem("enrollment.columns.medicare", JSON.stringify(["carrier"]));
    expect(readHiddenColumns(storage, "aca", VALID_KEYS)).toEqual(new Set(["stage"]));
    expect(readHiddenColumns(storage, "medicare", VALID_KEYS)).toEqual(new Set(["carrier"]));
  });
});

describe("writeHiddenColumns", () => {
  it("is a no-op when storage is undefined", () => {
    expect(() => writeHiddenColumns(undefined, "aca", new Set(["stage"]))).not.toThrow();
  });

  it("writes the hidden set as a JSON array under the program key", () => {
    const storage = new FakeStorage();
    writeHiddenColumns(storage, "aca", new Set(["stage", "carrier"]));
    expect(JSON.parse(storage.getItem("enrollment.columns.aca")!)).toEqual([
      "stage",
      "carrier",
    ]);
  });

  it("swallows storage errors silently", () => {
    expect(() =>
      writeHiddenColumns(new ThrowingStorage(), "aca", new Set(["stage"]))
    ).not.toThrow();
  });
});

describe("toggleHiddenColumn", () => {
  it("hides a currently-visible column", () => {
    const result = toggleHiddenColumn(new Set(), "stage", false);
    expect(result).toEqual(new Set(["stage"]));
  });

  it("shows a currently-hidden column", () => {
    const result = toggleHiddenColumn(new Set(["stage"]), "stage", false);
    expect(result).toEqual(new Set());
  });

  it("leaves a sticky column's hidden-set unchanged", () => {
    const current = new Set(["stage"]);
    const result = toggleHiddenColumn(current, "key", true);
    expect(result).toEqual(new Set(["stage"]));
  });

  it("does not mutate the input set", () => {
    const current = new Set(["stage"]);
    toggleHiddenColumn(current, "carrier", false);
    expect(current).toEqual(new Set(["stage"]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/enrollment/column-visibility.test.ts`
Expected: FAIL — `Cannot find module '@/lib/enrollment/column-visibility'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/lib/enrollment/column-visibility.ts`:

```ts
import type { EnrollmentProgram } from "./types";

// Minimal shape of the browser Storage API we need — injected instead of
// read from `window.localStorage` directly so this module is a plain
// function under Node test environments (no jsdom required).
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
  validKeys: ReadonlySet<string>
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(columnVisibilityStorageKey(program));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((key): key is string => typeof key === "string" && validKeys.has(key))
    );
  } catch {
    return new Set();
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/enrollment/column-visibility.test.ts`
Expected: PASS — all 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrollment/column-visibility.ts src/lib/enrollment/column-visibility.test.ts
git commit -m "test: extract enrollment column-visibility logic into a tested module"
```

---

## Task 2: Wire `EnrollmentClient.tsx` to the new module

**Files:**
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx:54-64` (imports), `:205-271` (inline storage/hook logic)

**Interfaces:**
- Consumes: everything produced by Task 1 (`columnVisibilityStorageKey` is no longer called directly from this file — it's an implementation detail of the new module now).
- Produces: no change to `useHiddenEnrollmentColumns`'s public shape — still `(program: EnrollmentProgram) => readonly [Set<EnrollmentColumnKey>, (key: EnrollmentColumnKey) => void]`, so nothing downstream (`EnrollmentToolbar`, `ColumnVisibilityButton`) needs to change.

- [ ] **Step 1: Add the import**

In `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, right after the existing `@/lib/enrollment/types` import block (ends at line 64), add:

```ts
import {
  readHiddenColumns,
  toggleHiddenColumn,
  writeHiddenColumns,
} from "@/lib/enrollment/column-visibility";
```

- [ ] **Step 2: Replace the inline storage functions and hook**

Find this block (current lines 205–271):

```ts
function columnVisibilityStorageKey(program: EnrollmentProgram) {
  return `enrollment.columns.${program}`;
}

function readHiddenEnrollmentColumns(program: EnrollmentProgram): Set<EnrollmentColumnKey> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(columnVisibilityStorageKey(program));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    const allKeys = new Set(ACA_ENROLLMENT_COLUMNS.map((column) => column.key));
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter(
        (key): key is EnrollmentColumnKey =>
          typeof key === "string" && allKeys.has(key as EnrollmentColumnKey)
      )
    );
  } catch {
    return new Set();
  }
}

function writeHiddenEnrollmentColumns(
  program: EnrollmentProgram,
  hiddenKeys: Set<EnrollmentColumnKey>
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      columnVisibilityStorageKey(program),
      JSON.stringify([...hiddenKeys])
    );
  } catch {
    // Column visibility is only a display preference; ignore storage failures.
  }
}

function useHiddenEnrollmentColumns(program: EnrollmentProgram) {
  const [hiddenByProgram, setHiddenByProgram] = useState<
    Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  >(() =>
    Object.fromEntries(
      ENROLLMENT_PROGRAMS.map((value) => [value, readHiddenEnrollmentColumns(value)])
    ) as Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  );
  const hiddenKeys = hiddenByProgram[program];

  const toggleColumn = useCallback(
    (key: EnrollmentColumnKey) => {
      const column = ACA_ENROLLMENT_COLUMNS.find((item) => item.key === key);
      if (column?.sticky) return;
      setHiddenByProgram((current) => {
        const next = new Set(current[program]);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        writeHiddenEnrollmentColumns(program, next);
        return { ...current, [program]: next };
      });
    },
    [program]
  );

  return [hiddenKeys, toggleColumn] as const;
}
```

Replace it with:

```ts
const ENROLLMENT_COLUMN_KEYS = new Set(ACA_ENROLLMENT_COLUMNS.map((column) => column.key));

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function useHiddenEnrollmentColumns(program: EnrollmentProgram) {
  const [hiddenByProgram, setHiddenByProgram] = useState<
    Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  >(() =>
    Object.fromEntries(
      ENROLLMENT_PROGRAMS.map((value) => [
        value,
        readHiddenColumns(browserStorage(), value, ENROLLMENT_COLUMN_KEYS) as Set<EnrollmentColumnKey>,
      ])
    ) as Record<EnrollmentProgram, Set<EnrollmentColumnKey>>
  );
  const hiddenKeys = hiddenByProgram[program];

  const toggleColumn = useCallback(
    (key: EnrollmentColumnKey) => {
      const column = ACA_ENROLLMENT_COLUMNS.find((item) => item.key === key);
      setHiddenByProgram((current) => {
        const next = toggleHiddenColumn(
          current[program],
          key,
          Boolean(column?.sticky)
        ) as Set<EnrollmentColumnKey>;
        writeHiddenColumns(browserStorage(), program, next);
        return { ...current, [program]: next };
      });
    },
    [program]
  );

  return [hiddenKeys, toggleColumn] as const;
}
```

(`EnrollmentColumnKey`, `ACA_ENROLLMENT_COLUMNS`, `ENROLLMENT_PROGRAMS` stay exactly where they already are in this file — only the storage plumbing moves.)

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx eslint "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"`
Expected: `No issues found`.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: all suites pass, including the new `src/lib/enrollment/column-visibility.test.ts` (no existing test touches this file, so no regressions expected).

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`, open `/enrollment?program=aca`, click the **Columns** button in the toolbar, uncheck a couple of non-sticky columns (e.g. Carrier, Created by) — confirm they disappear from the table immediately. Reload the page — confirm the same columns are still hidden (localStorage persisted). Switch to `/enrollment?program=medicare` — confirm its column visibility is independent (nothing hidden there yet). Re-check the columns on the ACA tab to restore the default state before moving on.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx"
git commit -m "refactor: back enrollment column visibility with the tested lib module"
```

---

## Task 3: Correct the spec's Columns-button placement description

**Files:**
- Modify: `docs/superpowers/specs/2026-07-25-enrollment-column-visibility-design.md:53`

**Interfaces:** None — documentation-only change.

- [ ] **Step 1: Update the placement sentence**

The spec (§7) currently reads:

```
- New "Columns" button in `EnrollmentToolbar` (~line 727, next to the existing `Overdue` toggle button, before the `ml-auto` record count).
```

The as-built implementation instead places the button in the toolbar's top row, next to the Due Date range filter (both are always visible regardless of how the filter row wraps, whereas `Overdue` lives in the second, filter-chips row). Replace the sentence with:

```
- "Columns" button in `EnrollmentToolbar`'s top row, next to the Due Date range filter (both stay visible regardless of how the filter-chips row below wraps) — not next to the `Overdue` toggle as originally sketched; the as-built placement groups it with the other always-visible toolbar controls instead.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-25-enrollment-column-visibility-design.md
git commit -m "docs: correct enrollment columns-button placement in the design spec"
```
