import { describe, expect, it } from "vitest";
import { readFirstSheet } from "./import-read";
import {
  buildImportDescription,
  fubPersonKey,
  leadImportTemplateCsv,
  matchTemplateHeaders,
  parseTemplateRows,
  resolveImportAgent,
} from "./import-template";

// Dữ liệu tự bịa, cùng hình dạng file mẫu của đội (CSV xuất từ Google Sheets).
// KHÔNG đưa file thật vào repo: nó có tên, số điện thoại, email khách thật.
const CSV = [
  "Full Name,Age,Gender,Phone Number,Email,Ticket #,Contact Method,Best Time to Contact,Insurance Needs,Client's Note,Agent,FUB link,Note",
  'Lan Test,71,Female,7135550101,,No ticket #,,PM,"Health Insurance, Medicare",,Khang Nguyen,https://x.followupboss.com/2/people/view/90001,',
  'Minh Test,,,(713) 555-0102,,"4001, 4002",Text,"AM, PM",Auto Insurance,"Bé gái 2.5Y\ncần gấp",,http://x.followupboss.com/2/people/view/90002,"Existing client, assigned to Someone"',
  "Only Email,,,,only@example.com,4003,Email,,,,Khang Nguyen,https://x.followupboss.com/2/people/view/90003,",
  "Dup Phone,,,713-555-0101,,4004,,,,,,https://x.followupboss.com/2/people/view/90004,",
  ",,,,,,,,,,,,",
].join("\n");

function sheet() {
  return readFirstSheet(new TextEncoder().encode(CSV).buffer as ArrayBuffer);
}

describe("readFirstSheet", () => {
  // SheetJS đọc CSV theo latin1 nếu không ép UTF-8 — "Bé" thành "BÃ©".
  it("keeps Vietnamese text from a UTF-8 CSV intact", () => {
    const { records } = sheet();
    expect(records[1]["Client's Note"]).toBe("Bé gái 2.5Y\ncần gấp");
  });

  it("reports the real Excel row number of each record", () => {
    expect(sheet().rowNumbers.slice(0, 4)).toEqual([2, 3, 4, 5]);
  });
});

describe("matchTemplateHeaders", () => {
  it("matches every template column regardless of case and punctuation", () => {
    const match = matchTemplateHeaders(["full name", "PHONE NUMBER", "ticket#", "Clients Note", "FUB Link", "Extra"]);
    expect(match.headerByField).toMatchObject({
      full_name: "full name",
      phone: "PHONE NUMBER",
      ticket_number: "ticket#",
      client_note: "Clients Note",
      fub_link: "FUB Link",
    });
    expect(match.unknownHeaders).toEqual(["Extra"]);
  });

  // Agent và Note "hên xui": thiếu chúng không phải là file sai mẫu.
  it("only flags the eleven always-present columns as missing", () => {
    const { headers } = sheet();
    const withoutOptional = headers.filter((header) => header !== "Agent" && header !== "Note");
    expect(matchTemplateHeaders(withoutOptional).missingExpected).toEqual([]);
    expect(matchTemplateHeaders(headers.filter((header) => header !== "Email")).missingExpected)
      .toEqual(["Email"]);
  });
});

describe("parseTemplateRows", () => {
  const parse = () => {
    const { headers, records, rowNumbers } = sheet();
    return parseTemplateRows(records, rowNumbers, matchTemplateHeaders(headers).headerByField);
  };

  it("maps the fixed columns onto a lead", () => {
    const [first, second] = parse().rows;
    expect(first).toMatchObject({
      row: 2,
      full_name: "Lan Test",
      phone: "7135550101",
      fub_link: "https://x.followupboss.com/2/people/view/90001",
      agentName: "Khang Nguyen",
      description: null,
      customRaw: {
        age: 71,
        gender: "Female",
        ticket_number: "No ticket #",
        best_time_to_contact: "PM",
        insurance_needs: "Health Insurance, Medicare",
      },
    });
    expect(second.phone).toBe("7135550102");
    expect(second.customRaw.ticket_number).toBe("4001, 4002");
  });

  it("joins Client's Note and Note into the description, each labelled", () => {
    expect(parse().rows[1].description).toBe(
      "Client's note: Bé gái 2.5Y\ncần gấp\nNote: Existing client, assigned to Someone",
    );
  });

  // "Có gì ghi nấy": dòng không có số vẫn vào.
  it("keeps a row that has no phone number", () => {
    const row = parse().rows.find((lead) => lead.full_name === "Only Email");
    expect(row).toMatchObject({ phone: null, email: "only@example.com" });
  });

  it("skips a second row with the same phone and ignores blank rows", () => {
    const result = parse();
    expect(result.rows.map((row) => row.full_name)).toEqual(["Lan Test", "Minh Test", "Only Email"]);
    expect(result.skipped).toEqual([{ row: 5, reason: "Same phone as row 2 in this file" }]);
  });
});

describe("buildImportDescription", () => {
  it("returns null when both notes are empty", () => {
    expect(buildImportDescription(null, null)).toBeNull();
    expect(buildImportDescription("2F", null)).toBe("Client's note: 2F");
  });
});

describe("fubPersonKey", () => {
  it("treats http and https links to the same person as one", () => {
    expect(fubPersonKey("http://a.followupboss.com/2/people/view/16131"))
      .toBe(fubPersonKey("https://a.followupboss.com/2/people/view/16131/"));
  });
});

describe("leadImportTemplateCsv", () => {
  it("lists the thirteen template headers in file order", () => {
    expect(leadImportTemplateCsv()).toBe(
      "Full Name,Age,Gender,Phone Number,Email,Ticket #,Contact Method,Best Time to Contact,Insurance Needs,Client's Note,Agent,FUB link,Note\n",
    );
  });
});

describe("resolveImportAgent", () => {
  // Danh sách Agent ở Config (task_agents) và mọi tài khoản đang hoạt động.
  const agents = [
    { email: "khang@x.com", name: "Khang Nguyễn" },
    { email: "jen@x.com", name: "Jennifer Le" },
    { email: "an1@x.com", name: "An Tran" },
    { email: "an2@x.com", name: "An Tran" },
  ];
  const accounts = [
    ...agents,
    { email: "linh@x.com", name: "Linh Le" },
    { email: "khang.cs@x.com", name: "Khang Nguyen" },
  ];

  it("matches a name without diacritics to an Agent with them", () => {
    expect(resolveImportAgent("Khang Nguyen", agents, accounts))
      .toEqual({ status: "matched", email: "khang@x.com", name: "Khang Nguyễn" });
  });

  it("falls back to first and last name when the middle name differs", () => {
    expect(resolveImportAgent("Jennifer Thao Le", agents, accounts))
      .toMatchObject({ status: "matched", email: "jen@x.com" });
  });

  // Agent thắng một tài khoản trùng tên không phải Agent ("Khang Nguyen" CS).
  it("prefers the Agent over a same-named account that is not one", () => {
    expect(resolveImportAgent("khang nguyen", agents, accounts).status).toBe("matched");
  });

  it("says when the person has an account but is not an Agent", () => {
    expect(resolveImportAgent("Linh Le", agents, accounts))
      .toMatchObject({ status: "not-agent", email: "linh@x.com" });
  });

  it("does not guess between two Agents with the same name", () => {
    expect(resolveImportAgent("An Tran", agents, accounts).status).toBe("ambiguous");
  });

  it("reports a name with no account", () => {
    expect(resolveImportAgent("Thuy Nguyen", agents, accounts)).toEqual({ status: "not-found" });
  });
});
