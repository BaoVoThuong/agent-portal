import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  US_STATES,
  cityChangePatch,
  placeCities,
  placeZipsForCity,
  postalCityForZip,
  stateChangePatch,
  stateZips,
  usStateCode,
  zipChangePatch,
  type StatePlaces,
} from "./us-places";

const TX: StatePlaces = {
  postal: {
    Houston: ["77001", "77002"],
    "Sugar Land": ["77478", "77479"],
    Bellaire: ["77401"],
  },
  places: {
    "The Woodlands": ["77380", "77381"],
  },
};

const blank = { state: "", city: "", zip_code: "" };

describe("usStateCode", () => {
  it("chuẩn hoá mã bang, bỏ giá trị không phải bang", () => {
    expect(usStateCode(" tx ")).toBe("TX");
    expect(usStateCode("Texas")).toBeNull();
    expect(usStateCode(null)).toBeNull();
  });
});

describe("danh sách theo bang", () => {
  it("City gồm cả tên bưu điện lẫn thành phố gộp, xếp chữ cái", () => {
    expect(placeCities(TX)).toEqual(["Bellaire", "Houston", "Sugar Land", "The Woodlands"]);
  });

  it("ZIP của City, không phân biệt hoa thường", () => {
    expect(placeZipsForCity(TX, "sugar land")).toEqual(["77478", "77479"]);
    expect(placeZipsForCity(TX, "The Woodlands")).toEqual(["77380", "77381"]);
    expect(placeZipsForCity(TX, "Chicago")).toEqual([]);
  });

  it("tra tên bưu điện của ZIP, kể cả ZIP+4", () => {
    expect(postalCityForZip(TX, "77401-1234")).toBe("Bellaire");
    expect(postalCityForZip(TX, "99999")).toBeNull();
  });

  it("mọi ZIP của bang kèm tên bưu điện, xếp theo số", () => {
    expect(stateZips(TX).map((item) => item.zip)).toEqual([
      "77001",
      "77002",
      "77401",
      "77478",
      "77479",
    ]);
  });
});

describe("chọn dây chuyền State → City → ZIP", () => {
  it("đổi sang bang khác thì bỏ City và ZIP của bang cũ", () => {
    expect(stateChangePatch("FL", { state: "TX", city: "Houston", zip_code: "77001" })).toEqual({
      state: "FL",
      city: "",
      zip_code: "",
    });
  });

  it("điền bang cho dòng chưa có bang thì giữ City / ZIP", () => {
    expect(stateChangePatch("TX", { ...blank, city: "Houston", zip_code: "77001" })).toEqual({
      state: "TX",
    });
  });

  it("đổi City thì bỏ ZIP không thuộc City mới, City một ZIP thì điền luôn", () => {
    const current = { state: "TX", city: "Houston", zip_code: "77001" };
    expect(cityChangePatch("Sugar Land", current, TX)).toEqual({ city: "Sugar Land", zip_code: "" });
    expect(cityChangePatch("Bellaire", current, TX)).toEqual({ city: "Bellaire", zip_code: "77401" });
    expect(cityChangePatch("Houston", { ...current, zip_code: "77002" }, TX)).toEqual({
      city: "Houston",
    });
  });

  it("chọn ZIP khi chưa có City thì điền City theo ZIP, có City rồi thì giữ", () => {
    expect(zipChangePatch("77478", { ...blank, state: "TX" }, TX)).toEqual({
      zip_code: "77478",
      city: "Sugar Land",
    });
    expect(
      zipChangePatch("77001", { state: "TX", city: "The Woodlands", zip_code: "" }, TX)
    ).toEqual({ zip_code: "77001" });
  });
});

describe("public/us-places", () => {
  const dir = join(process.cwd(), "public", "us-places");

  it("có đủ một tệp cho mỗi bang", () => {
    const missing = US_STATES.filter((state) => !existsSync(join(dir, `${state.code}.json`)));
    expect(missing).toEqual([]);
  });

  it("TX có Houston với ZIP 770xx và các thành phố bưu điện gộp", () => {
    const tx = JSON.parse(readFileSync(join(dir, "TX.json"), "utf8")) as StatePlaces;
    expect(tx.postal.Houston).toContain("77002");
    expect(placeCities(tx)).toEqual(expect.arrayContaining(["The Woodlands", "Live Oak", "Katy"]));
  });

  it("chọn ZIP trước trên dữ liệu thật thì City tự điền theo ZIP", () => {
    const tx = JSON.parse(readFileSync(join(dir, "TX.json"), "utf8")) as StatePlaces;
    expect(zipChangePatch("77412", { state: "TX", city: "", zip_code: "" }, tx)).toEqual({
      zip_code: "77412",
      city: "Altair",
    });
  });
});
