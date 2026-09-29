import { describe, expect, it } from "vitest";
import {
  dedupeCarrierIds,
  enrollmentCarrierIds,
  readCarrierIdsInput,
  sameCarrierIds,
  toggleCarrierId,
} from "./carriers";

describe("enrollmentCarrierIds", () => {
  it("reads the array when the row has one", () => {
    expect(enrollmentCarrierIds({ carrier_id: "c1", carrier_ids: ["c1", "c2"] })).toEqual([
      "c1",
      "c2",
    ]);
  });

  // Dòng đọc về từ trước rollout (hoặc đường đọc chưa select cột mới) chỉ có
  // carrier_id — vẫn phải hiện đúng một hãng, không phải "No carrier".
  it("falls back to carrier_id when the array is missing", () => {
    expect(enrollmentCarrierIds({ carrier_id: "c1" })).toEqual(["c1"]);
    expect(enrollmentCarrierIds({ carrier_id: "c1", carrier_ids: [] })).toEqual(["c1"]);
  });

  it("is empty when there is no carrier at all", () => {
    expect(enrollmentCarrierIds({ carrier_id: null, carrier_ids: [] })).toEqual([]);
  });
});

describe("readCarrierIdsInput", () => {
  it("returns undefined when the request says nothing about Carrier", () => {
    expect(readCarrierIdsInput({ client_name: "A" })).toBeUndefined();
  });

  it("reads carrier_ids, dropping blanks and duplicates in order", () => {
    expect(readCarrierIdsInput({ carrier_ids: ["c2", " ", "c1", "c2"] })).toEqual(["c2", "c1"]);
  });

  it("treats a null list as clearing every carrier", () => {
    expect(readCarrierIdsInput({ carrier_ids: null })).toEqual([]);
  });

  it("rejects anything that is not a list of strings", () => {
    expect(readCarrierIdsInput({ carrier_ids: "c1" })).toBeNull();
    expect(readCarrierIdsInput({ carrier_ids: ["c1", 2] })).toBeNull();
    expect(readCarrierIdsInput({ carrier_id: 5 })).toBeNull();
  });

  // Tab còn mở từ trước lúc deploy vẫn gửi carrier_id một giá trị.
  it("still accepts the single carrier_id of an older client", () => {
    expect(readCarrierIdsInput({ carrier_id: "c1" })).toEqual(["c1"]);
    expect(readCarrierIdsInput({ carrier_id: null })).toEqual([]);
    expect(readCarrierIdsInput({ carrier_id: "" })).toEqual([]);
  });

  it("prefers carrier_ids when both are sent", () => {
    expect(readCarrierIdsInput({ carrier_id: "c9", carrier_ids: ["c1"] })).toEqual(["c1"]);
  });
});

describe("helpers", () => {
  it("dedupeCarrierIds keeps first occurrence order", () => {
    expect(dedupeCarrierIds(["b", "a", "b"])).toEqual(["b", "a"]);
  });

  // Hãng đầu là hãng "chính" (carrier_id), nên đổi thứ tự là một thay đổi thật.
  it("sameCarrierIds compares order too", () => {
    expect(sameCarrierIds(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameCarrierIds(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("toggleCarrierId adds to the end and removes in place", () => {
    expect(toggleCarrierId(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleCarrierId(["a", "b"], "a")).toEqual(["b"]);
  });
});
