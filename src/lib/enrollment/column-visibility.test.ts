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
