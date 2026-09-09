import { describe, expect, it, vi } from "vitest";
import {
  clearPersistedFilters,
  keepKnownString,
  keepKnownStrings,
  readPersistedFilters,
  readStoredBoolean,
  readStoredDateOnly,
  writePersistedFilters,
  type FilterStorage,
} from "./persisted-filters";

function memoryStorage(initial: Record<string, string> = {}): FilterStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

const KEY = "eps.test.filters.v1";

describe("đọc / ghi", () => {
  it("ghi rồi đọc lại ra đúng giá trị", () => {
    const storage = memoryStorage();
    writePersistedFilters(KEY, storage, { stage: ["s1"] });
    expect(readPersistedFilters(KEY, storage, (raw) => raw)).toEqual({ stage: ["s1"] });
  });

  it("chưa lưu gì thì trả null để lớp gọi dùng mặc định", () => {
    expect(readPersistedFilters(KEY, memoryStorage(), (raw) => raw)).toBeNull();
  });

  it("JSON hỏng không làm vỡ trang", () => {
    const storage = memoryStorage({ [KEY]: "{không phải json" });
    expect(readPersistedFilters(KEY, storage, (raw) => raw)).toBeNull();
  });

  it("giá trị không phải object (mảng, số) cũng bị bỏ qua", () => {
    expect(readPersistedFilters(KEY, memoryStorage({ [KEY]: "[1,2]" }), (r) => r)).toBeNull();
    expect(readPersistedFilters(KEY, memoryStorage({ [KEY]: "42" }), (r) => r)).toBeNull();
  });

  it("không có storage thì mọi thao tác đều là no-op", () => {
    expect(readPersistedFilters(KEY, undefined, (raw) => raw)).toBeNull();
    expect(() => writePersistedFilters(KEY, undefined, { a: 1 })).not.toThrow();
    expect(() => clearPersistedFilters(KEY, undefined)).not.toThrow();
  });

  it("storage ném lỗi (Safari riêng tư, chặn site data) vẫn không vỡ", () => {
    const throwing: FilterStorage = {
      getItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new Error("QuotaExceededError");
      }),
      removeItem: vi.fn(() => {
        throw new Error("SecurityError");
      }),
    };
    expect(readPersistedFilters(KEY, throwing, (raw) => raw)).toBeNull();
    expect(() => writePersistedFilters(KEY, throwing, { a: 1 })).not.toThrow();
    expect(() => clearPersistedFilters(KEY, throwing)).not.toThrow();
  });
});

describe("khử giá trị đã biến mất", () => {
  // Đây là lý do tồn tại của cả module: một Stage bị archive hay một người nghỉ
  // việc sẽ khiến bộ lọc cũ lọc ra 0 dòng, và agent không hiểu vì sao.
  it("bỏ id không còn tồn tại, giữ id còn hợp lệ", () => {
    expect(keepKnownStrings(["còn", "đã-xoá"], new Set(["còn"]))).toEqual(["còn"]);
  });

  it("bỏ trùng lặp", () => {
    expect(keepKnownStrings(["a", "a", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("bỏ phần tử không phải chuỗi và dữ liệu không phải mảng", () => {
    expect(keepKnownStrings([1, null, "a"], new Set(["a"]))).toEqual(["a"]);
    expect(keepKnownStrings("a", new Set(["a"]))).toEqual([]);
    expect(keepKnownStrings(undefined, new Set(["a"]))).toEqual([]);
  });

  it("giá trị đơn: mất thì thành null", () => {
    expect(keepKnownString("còn", new Set(["còn"]))).toBe("còn");
    expect(keepKnownString("đã-xoá", new Set(["còn"]))).toBeNull();
    expect(keepKnownString(42, new Set(["còn"]))).toBeNull();
  });

  it("boolean chỉ nhận đúng true, không nhận chuỗi 'true'", () => {
    expect(readStoredBoolean(true)).toBe(true);
    expect(readStoredBoolean("true")).toBe(false);
    expect(readStoredBoolean(1)).toBe(false);
  });

  it("ngày phải đúng dạng YYYY-MM-DD", () => {
    expect(readStoredDateOnly("2026-09-09")).toBe("2026-09-09");
    expect(readStoredDateOnly("09/09/2026")).toBe("");
    expect(readStoredDateOnly(null)).toBe("");
  });
});
