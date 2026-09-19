import { describe, expect, it } from "vitest";
import {
  blankProviderValues,
  providerFieldPatch,
  providerFormPayload,
  todayForColumn,
} from "@/lib/providers/form";
import type { TableColumn } from "@/lib/table-config/types";

function column(overrides: Partial<TableColumn> & { key: string }): TableColumn {
  return {
    id: `col-${overrides.key}`,
    scope: "provider",
    label: overrides.key,
    type: "text",
    position: 10,
    hidden_default: false,
    required: false,
    is_system: true,
    archived_at: null,
    ...overrides,
  } as TableColumn;
}

const REVIEWED = column({ key: "needs_review", type: "checkbox", label: "Reviewed" });
const VERIFIED_BY = column({ key: "verified_by", label: "Verified by" });
const VERIFIED_DATE = column({ key: "date", label: "Verified date" });
const NOW = new Date(2026, 8, 19); // 19/09/2026 giờ địa phương

describe("todayForColumn", () => {
  it("viết MM/DD/YYYY cho cột text, đúng kiểu dữ liệu đang có trong bảng", () => {
    expect(todayForColumn(VERIFIED_DATE, NOW)).toBe("09/19/2026");
  });

  it("viết ISO khi admin đổi cột sang kiểu ngày, vì input type=date chỉ nhận ISO", () => {
    expect(todayForColumn(column({ key: "date", type: "date" }), NOW)).toBe("2026-09-19");
  });
});

describe("providerFieldPatch", () => {
  it("bật Reviewed thì điền luôn người soát và ngày soát", () => {
    expect(
      providerFieldPatch(REVIEWED, true, {
        columns: [REVIEWED, VERIFIED_BY, VERIFIED_DATE],
        viewerName: "Khang Nguyen",
        now: NOW,
      })
    ).toEqual({
      needs_review: true,
      verified_by: "Khang Nguyen",
      date: "09/19/2026",
    });
  });

  it("ghi đè người soát cũ: lần xác nhận mới nhất mới là lần có giá trị", () => {
    const patch = providerFieldPatch(REVIEWED, true, {
      columns: [REVIEWED, VERIFIED_BY, VERIFIED_DATE],
      viewerName: "Zoe Nguyen",
      now: NOW,
    });
    expect(patch.verified_by).toBe("Zoe Nguyen");
  });

  // Nhiều dòng mang sẵn tên người soát từ Google Sheet. Bỏ tick là nói "dòng này
  // cần soát lại", KHÔNG phải "xoá lịch sử ai đã soát".
  it("bỏ tick Reviewed thì không đụng tới hai ô kia", () => {
    expect(
      providerFieldPatch(REVIEWED, false, {
        columns: [REVIEWED, VERIFIED_BY, VERIFIED_DATE],
        viewerName: "Khang Nguyen",
        now: NOW,
      })
    ).toEqual({ needs_review: false });
  });

  it("không điền gì khi admin đã archive hai cột đó", () => {
    expect(
      providerFieldPatch(REVIEWED, true, {
        columns: [
          REVIEWED,
          { ...VERIFIED_BY, archived_at: "2026-01-01T00:00:00.000Z" },
          { ...VERIFIED_DATE, archived_at: "2026-01-01T00:00:00.000Z" },
        ],
        viewerName: "Khang Nguyen",
        now: NOW,
      })
    ).toEqual({ needs_review: true });
  });

  it("ô khác thì vá đúng một khoá", () => {
    expect(
      providerFieldPatch(column({ key: "city" }), "Katy", {
        columns: [REVIEWED, VERIFIED_BY, VERIFIED_DATE],
        viewerName: "Khang Nguyen",
      })
    ).toEqual({ city: "Katy" });
  });
});

describe("blankProviderValues", () => {
  it("dòng gõ tay coi như đã soát, kèm người soát và ngày soát", () => {
    const values = blankProviderValues(
      [REVIEWED, VERIFIED_BY, VERIFIED_DATE, column({ key: "city" })],
      "Khang Nguyen",
      NOW
    );
    expect(values).toEqual({
      needs_review: true,
      verified_by: "Khang Nguyen",
      date: "09/19/2026",
      city: "",
    });
  });

  it("ô nhiều lựa chọn khởi tạo bằng mảng rỗng, không phải chuỗi rỗng", () => {
    const values = blankProviderValues(
      [column({ key: "practices_as", type: "multiselect" }), column({ key: "obamacare" })],
      "Khang Nguyen",
      NOW
    );
    expect(values.practices_as).toEqual([]);
    expect(values.obamacare).toEqual([]);
  });

  it("bỏ qua cột đã archive", () => {
    const values = blankProviderValues(
      [column({ key: "city", archived_at: "2026-01-01T00:00:00.000Z" })],
      "Khang Nguyen",
      NOW
    );
    expect("city" in values).toBe(false);
  });
});

describe("providerFormPayload", () => {
  const columns = [
    REVIEWED,
    column({ key: "accepting_new_patients", type: "checkbox" }),
    column({ key: "practices_as", type: "multiselect" }),
    column({ key: "city" }),
    column({ key: "note", is_system: false }),
  ];

  it("đảo Reviewed thành needs_review, vì hai cái ngược nghĩa nhau", () => {
    expect(providerFormPayload({ needs_review: true }, [REVIEWED]).needs_review).toBe(false);
    expect(providerFormPayload({ needs_review: false }, [REVIEWED]).needs_review).toBe(true);
  });

  it("cờ nhận bệnh nhân mới lưu thành chữ Yes/No như dữ liệu Sheet", () => {
    const yes = providerFormPayload({ accepting_new_patients: true }, columns);
    const no = providerFormPayload({ accepting_new_patients: false }, columns);
    expect(yes.accepting_new_patients).toBe("Yes");
    expect(no.accepting_new_patients).toBe("No");
  });

  it("giữ nguyên mảng cho ô nhiều lựa chọn để server tự nối chuỗi", () => {
    const body = providerFormPayload(
      { practices_as: ["PCP - Adults", "Cardiologist"] },
      columns
    );
    expect(body.practices_as).toEqual(["PCP - Adults", "Cardiologist"]);
  });

  it("ô để trống gửi null, nghĩa là XOÁ giá trị chứ không phải bỏ qua", () => {
    expect(providerFormPayload({ city: "" }, columns).city).toBeNull();
  });

  // Bảng gửi lên đúng ô vừa sửa; ghi đè cả cụm sẽ xoá mất cột tuỳ chỉnh khác.
  it("gộp cột tuỳ chỉnh lên giá trị sẵn có của dòng", () => {
    const body = providerFormPayload({ note: "Vietnamese" }, columns, { legacy: "keep" });
    expect(body.custom_values).toEqual({ legacy: "keep", note: "Vietnamese" });
  });
});
