import { describe, expect, it } from "vitest";
import {
  ENROLLMENT_IMPORT_ID_HEADER,
  buildEnrollmentImportContext,
  ENROLLMENT_IMPORT_MANAGED_KEYS,
  enrollmentImportPayload,
  matchEnrollmentHeaders,
  parseEnrollmentImportRows,
  toIsoDate,
  type EnrollmentImportContext,
} from "@/lib/enrollment/import";
import type { TableColumn } from "@/lib/table-config/types";

function column(key: string, label: string, type: TableColumn["type"] = "text"): TableColumn {
  return {
    id: `col-${key}`,
    scope: "aca",
    key,
    label,
    type,
    position: 10,
    hidden_default: false,
    required: false,
    is_system: true,
    archived_at: null,
  } as TableColumn;
}

const COLUMNS = [
  column("key", "Key"),
  column("client", "Client Name"),
  column("agent", "Agent", "person"),
  column("stage", "Stage", "dropdown"),
  column("carrier", "Carrier", "dropdown"),
  column("due", "Due Date", "date"),
  column("fub", "FUB Link", "link"),
  column("qc", "QC", "checkbox"),
  column("createdAt", "Created time", "date"),
  { ...column("note", "Note"), is_system: false } as TableColumn,
];

const CTX: EnrollmentImportContext = {
  optionIdByLabel: new Map([
    ["stage", new Map([["newlead", "stage-1"], ["enrolled", "stage-2"]])],
    ["carrier", new Map([["ambetter", "carrier-1"]])],
  ]),
  emailByPerson: new Map([
    ["khangnguyen", "khang.nguyen@excelplannings.com"],
    ["khang.nguyen@excelplannings.com", "khang.nguyen@excelplannings.com"],
  ]),
  ambiguousPeople: new Set(["nguyenvan"]),
  customOptionIdByLabel: new Map(),
};

describe("toIsoDate", () => {
  it("giữ nguyên ISO", () => {
    expect(toIsoDate("2026-09-19")).toBe("2026-09-19");
  });

  it("đổi kiểu Mỹ sang ISO, vì API chỉ nhận YYYY-MM-DD", () => {
    expect(toIsoDate("09/19/2026")).toBe("2026-09-19");
    expect(toIsoDate("9/1/2026")).toBe("2026-09-01");
  });

  // Excel trả ô ngày về dưới dạng số sê-ri. Đây chính là con số từng lọt vào
  // cột Verified date bên Provider List.
  it("đổi số sê-ri của Excel sang ISO", () => {
    expect(toIsoDate(46118)).toBe("2026-04-06");
  });

  it("nhận cả đối tượng Date", () => {
    expect(toIsoDate(new Date(Date.UTC(2026, 8, 19)))).toBe("2026-09-19");
  });

  it("ô trống là null, không phải lỗi", () => {
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });

  it("chuỗi không phải ngày thì báo lỗi chứ không đoán", () => {
    expect(toIsoDate("hom qua")).toEqual({ error: "Invalid date: hom qua" });
  });
});

describe("matchEnrollmentHeaders", () => {
  it("khớp theo nhãn cột của file xuất ra", () => {
    const matched = matchEnrollmentHeaders(["Client Name", "Stage", "Due Date"], COLUMNS);
    expect(matched.byHeader.get("Client Name")).toBe("client");
    expect(matched.byHeader.get("Stage")).toBe("stage");
    expect(matched.byHeader.get("Due Date")).toBe("due");
    expect(matched.ignored).toEqual([]);
  });

  it("nhận cột ID để biết dòng nào là cập nhật", () => {
    const matched = matchEnrollmentHeaders(["ID", "Client Name"], COLUMNS);
    expect(matched.idHeader).toBe(ENROLLMENT_IMPORT_ID_HEADER);
  });

  // Key là số hiệu hiển thị do database sinh; QC bị chặn theo stage nên nhập
  // vào chỉ tạo ra một loạt lỗi khó hiểu; nhóm created/updated là lịch sử.
  it("Key, QC và nhóm siêu dữ liệu không nhận giá trị từ file", () => {
    const matched = matchEnrollmentHeaders(
      ["Key", "QC", "Created time", "Client Name"],
      COLUMNS
    );
    expect(matched.byHeader.size).toBe(1);
    expect(matched.managed.sort()).toEqual(["Created time", "Key", "QC"]);
    expect([...ENROLLMENT_IMPORT_MANAGED_KEYS]).toContain("qc");
  });

  it("báo lại tiêu đề không khớp cột nào", () => {
    const matched = matchEnrollmentHeaders(["Client Name", "Ghi chú riêng"], COLUMNS);
    expect(matched.ignored).toEqual(["Ghi chú riêng"]);
  });
});

describe("parseEnrollmentImportRows", () => {
  const matched = matchEnrollmentHeaders(
    ["ID", "Client Name", "Agent", "Stage", "Carrier", "Due Date", "Note"],
    COLUMNS
  );

  it("có ID là cập nhật, không có là thêm mới", () => {
    const parsed = parseEnrollmentImportRows(
      [
        { ID: "11111111-1111-4111-8111-111111111111", "Client Name": "A" },
        { ID: null, "Client Name": "B" },
      ],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows.map((row) => row.mode)).toEqual(["update", "create"]);
  });

  it("đổi nhãn option thành id, vì API chỉ nhận id", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Stage: "New Lead", Carrier: "Ambetter" }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows[0].values.stage).toBe("stage-1");
    expect(parsed.rows[0].values.carrier).toBe("carrier-1");
  });

  it("nhãn option lạ thì BỎ DÒNG và nói rõ, không ghi null đè lên giá trị đang đúng", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Stage: "Khong Ton Tai" }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("Stage");
    expect(parsed.skipped[0].reason).toContain("Khong Ton Tai");
  });

  it("đổi tên người thành email, và nhận luôn email gõ thẳng", () => {
    const parsed = parseEnrollmentImportRows(
      [
        { "Client Name": "A", Agent: "Khang Nguyen" },
        { "Client Name": "B", Agent: "khang.nguyen@excelplannings.com" },
      ],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows[0].values.agent).toBe("khang.nguyen@excelplannings.com");
    expect(parsed.rows[1].values.agent).toBe("khang.nguyen@excelplannings.com");
  });

  // Hai người trùng tên thì đoán bừa là gán hồ sơ cho nhầm người.
  it("tên trùng nhau thì bỏ dòng chứ không chọn đại một người", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Agent: "Nguyen Van" }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("Agent");
  });

  it("người không có trong danh sách thì bỏ dòng", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Agent: "Nguoi La" }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows).toHaveLength(0);
  });

  it("dòng thêm mới phải có Client Name", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "  " }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("Client Name");
  });

  it("ngày sai định dạng thì bỏ dòng, không lặng lẽ để trống", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", "Due Date": "hom qua" }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("Due Date");
  });

  it("số dòng báo lỗi là số dòng trong Excel", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A" }, { "Client Name": null }],
      matched,
      COLUMNS,
      CTX
    );
    expect(parsed.skipped[0].row).toBe(3);
  });
});

describe("enrollmentImportPayload", () => {
  it("đổi khoá cột thành tên trường của bảng", () => {
    const body = enrollmentImportPayload(
      { client: "A", agent: "x@y.com", stage: "stage-1", due: "2026-09-19", fub: "http://a" },
      COLUMNS
    );
    expect(body).toEqual({
      client_name: "A",
      agent_email: "x@y.com",
      stage_id: "stage-1",
      due_date: "2026-09-19",
      fub_link: "http://a",
    });
  });

  // Giống bên Provider: form sửa gửi mọi cột nên ô trống là xoá; file nhập chỉ
  // có vài cột, gửi mọi cột là xoá sạch phần còn lại của dòng.
  it("CHỈ gửi những cột có trong file", () => {
    const body = enrollmentImportPayload({ client: "A" }, COLUMNS);
    expect(body).toEqual({ client_name: "A" });
  });

  it("cột tuỳ chỉnh đi vào custom_values", () => {
    expect(enrollmentImportPayload({ note: "abc" }, COLUMNS)).toEqual({
      custom_values: { note: "abc" },
    });
  });
});

describe("buildEnrollmentImportContext", () => {
  const OPTIONS = [
    { id: "s1", set_key: "stage", label: "New Lead", archived_at: null },
    { id: "s2", set_key: "stage", label: "Enrolled", archived_at: null },
    { id: "s3", set_key: "stage", label: "Cũ", archived_at: "2026-01-01" },
    { id: "c1", set_key: "carrier", label: "Ambetter", archived_at: null },
    { id: "p1", set_key: "payment_status", label: "Paid", archived_at: null },
  ];

  it("gom option theo đúng cột trên màn hình", () => {
    const ctx = buildEnrollmentImportContext(OPTIONS, []);
    expect(ctx.optionIdByLabel.get("stage")?.get("newlead")).toBe("s1");
    expect(ctx.optionIdByLabel.get("carrier")?.get("ambetter")).toBe("c1");
    expect(ctx.optionIdByLabel.get("payment")?.get("paid")).toBe("p1");
  });

  it("bỏ option đã archive — nhập vào chỉ để bị API từ chối", () => {
    const ctx = buildEnrollmentImportContext(OPTIONS, []);
    expect(ctx.optionIdByLabel.get("stage")?.has("cu")).toBe(false);
  });

  it("tra được cả bằng tên lẫn bằng email", () => {
    const ctx = buildEnrollmentImportContext([], [
      { email: "Khang.Nguyen@x.com", name: "Khang Nguyen" },
    ]);
    expect(ctx.emailByPerson.get("khangnguyen")).toBe("khang.nguyen@x.com");
    expect(ctx.emailByPerson.get("khang.nguyen@x.com")).toBe("khang.nguyen@x.com");
  });

  it("hai người trùng tên thì đánh dấu mập mờ, không chọn bừa", () => {
    const ctx = buildEnrollmentImportContext([], [
      { email: "a@x.com", name: "Nguyen Van" },
      { email: "b@x.com", name: "Nguyen Van" },
    ]);
    expect(ctx.ambiguousPeople.has("nguyenvan")).toBe(true);
  });

  it("người không có tên vẫn tra được bằng email", () => {
    const ctx = buildEnrollmentImportContext([], [{ email: "c@x.com", name: null }]);
    expect(ctx.emailByPerson.get("c@x.com")).toBe("c@x.com");
  });
});

describe("cột tuỳ chỉnh ép về đúng kiểu", () => {
  const COLS = [
    column("client", "Client Name"),
    { ...column("household", "Household number", "number"), is_system: false } as TableColumn,
    { ...column("source", "Source", "dropdown"), is_system: false } as TableColumn,
    { ...column("tags", "Tags", "multiselect"), is_system: false } as TableColumn,
  ];
  const ctx = buildEnrollmentImportContext([], [], [
    { id: "opt-fb", column_id: "col-source", label: "Facebook", archived_at: null },
    { id: "opt-a", column_id: "col-tags", label: "Alpha", archived_at: null },
    { id: "opt-b", column_id: "col-tags", label: "Beta", archived_at: null },
  ]);
  const matched = matchEnrollmentHeaders(
    ["Client Name", "Household number", "Source", "Tags"],
    COLS
  );

  // Đây là lỗi gặp khi thử nhập thật lần đầu: API trả "Invalid custom value"
  // vì cột kiểu number nhận chuỗi "1".
  it("cột number nhận SỐ, không phải chuỗi", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", "Household number": "1" }],
      matched,
      COLS,
      ctx
    );
    expect(parsed.rows[0].values.household).toBe(1);
  });

  it("chữ không phải số thì bỏ dòng, không ghi NaN", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", "Household number": "ba" }],
      matched,
      COLS,
      ctx
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("Household number");
  });

  it("dropdown tuỳ chỉnh đổi nhãn thành id lựa chọn", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Source: "Facebook" }],
      matched,
      COLS,
      ctx
    );
    expect(parsed.rows[0].values.source).toBe("opt-fb");
  });

  it("multiselect tách theo dấu phẩy rồi đổi từng nhãn", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Tags: "Alpha, Beta" }],
      matched,
      COLS,
      ctx
    );
    expect(parsed.rows[0].values.tags).toEqual(["opt-a", "opt-b"]);
  });

  it("nhãn lạ thì bỏ dòng chứ không ghi null đè lên giá trị đang đúng", () => {
    const parsed = parseEnrollmentImportRows(
      [{ "Client Name": "A", Source: "Khong Ton Tai" }],
      matched,
      COLS,
      ctx
    );
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("Source");
  });
});
