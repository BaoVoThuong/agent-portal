import { describe, expect, it } from "vitest";
import { buildBill } from "./bill";
import { codeMeaning, displayValue } from "./display";
import { groupDeals, unpaidMonths } from "./deals";
import { parseCsv, parseReportMonth, rowsFromTable } from "./sheet-rows";
import { commissionStatus, dealKeys, packRows, parseMoney, unpackRows } from "./values";

// Made-up rows in the "2026 clean" layout.
const CSV = [
  "agent,number_cus,deal_name,stage,state,carrier,plan_name,primary_member_id,plan_effective_date,broker_effective_date,paid_thru_date,carriers_messer_paid,pay_rate_level,agent_received,eps_override,eps_override_received,eps_split,paid_to_date,transaction_id,statement,month_report",
  'Demo Agent,2,"TX - Oscar - A Sample + B Sample - OB 02/26",Active,TX,Oscar,Silver,OSC1,02/01/2026,2/1/2026,,NC,NC,NC,,,,NC,NC,NC,01-2026',
  'Demo Agent,2,"TX - Oscar - A Sample + B Sample - OB 02/26",Active,TX,Oscar,Silver,OSC1,02/01/2026,2/1/2026,,P3,P3,P3,,,,P3,P3,P3,02-2026',
  'Demo Agent,2,"TX - Oscar - A Sample + B Sample - OB 02/26",Active,TX,Oscar,Silver,OSC1,02/01/2026,2/1/2026,,"$1,120.00",0.75,$84.00,$6.00,$1.50,$26.50,03/31/2026  2/28/2026,111,222,03-2026',
  'Demo Agent,1,"TX - CHC - C Sample - OB 01/26",Active,TX,CHC,Gold,CHC9,01/01/2026,1/1/2026,,$20.00,0.75,$15.00,$0.00,$0.00,$5.00,1/31/2026,333,444,01-2026',
  'Demo Agent,1,"TX - CHC - C Sample - OB 01/26",Termination,TX,CHC,Gold,CHC9,01/01/2026,1/1/2026,,T,T,T,,,,T,T,T,02-2026',
  'Demo Agent,1,"TX - CHC - C Sample - OB 01/26",Termination,TX,CHC,Gold,CHC9,01/01/2026,1/1/2026,,T,T,T,,,,T,T,T,03-2026',
  "Demo Agent,,,,,Christus,,,,,,,,,,,,,,,03-2026",
].join("\n");

function sampleRows() {
  const rows = rowsFromTable(parseCsv(CSV)).rows.flatMap(({ month, ...row }) => (month ? [{ y: month[0], m: month[1], ...row }] : []));
  return unpackRows(packRows(rows));
}

describe("reading the sheet", () => {
  it("parses quoted CSV cells and both month spellings", () => {
    expect(parseCsv('a,"b, c","d ""e"""\n1,2,3')).toEqual([["a", "b, c", 'd "e"'], ["1", "2", "3"]]);
    expect(parseReportMonth("01/2025")).toEqual([2025, 1]);
    expect(parseReportMonth("1/2025")).toEqual([2025, 1]);
    expect(parseReportMonth("08-2026")).toEqual([2026, 8]);
    expect(parseReportMonth("8/1/2026")).toEqual([2026, 8]);
  });

  it("keeps rows with a deal or member ID, as typed", () => {
    const rows = sampleRows();
    expect(rows).toHaveLength(6);
    expect(rows[2].mp).toBe("$1,120.00");
    expect(rows[1].ar).toBe("P3");
  });

  it("finds the 2025 tab's headers too", () => {
    const table = parseCsv(
      "Deal name,Deal stage,State,Carrier,Plan name,Primary member ID,Broker Effective,Carriers / Messer Paid,Pay Rate Level,Agent Received,Paid-To Date,Transaction ID,Messer Statement,Agent,Month_Report,num_client\n" +
        "X - Demo,Active,TX,Oscar,Silver,OSC2,01/01/2025,$28.00,75%,$21.00,01/31/2025,1,2,Demo Agent,1/2025,1",
    );
    const [row] = rowsFromTable(table).rows;
    expect(row).toMatchObject({ deal: "X - Demo", agent: "Demo Agent", ar: "$21.00", st: "2", n: "1", month: [2025, 1] });
  });
});

describe("amounts and codes", () => {
  it("reads money and tells codes apart", () => {
    expect(parseMoney("$1,120.00")).toBe(1120);
    expect(parseMoney("-$84.00")).toBe(-84);
    expect(parseMoney("P6")).toBeNull();
    expect(commissionStatus("$0.00")).toBe("Paid");
    expect(commissionStatus("P6")).toBe("P2–P8");
    expect(commissionStatus("n/c")).toBe("N/C");
    expect(commissionStatus("")).toBe("Blank");
  });
});

describe("deals and bill", () => {
  it("groups a deal's months with total and paid dates", () => {
    const rows = sampleRows();
    const deals = groupDeals(rows, dealKeys(rows));
    expect(deals).toHaveLength(2);
    const oscar = deals.find((deal) => deal.last.carrier === "Oscar")!;
    expect(oscar.totals).toEqual({ mp: 1120, ar: 84, sp: 26.5 });
    expect(oscar.firstPaid?.toDateString()).toBe(new Date(2026, 1, 28).toDateString());
    expect(oscar.lastPaid?.toDateString()).toBe(new Date(2026, 2, 31).toDateString());
  });

  it("lays out the bill: months up to the cycle, payout, member counts", () => {
    const rows = sampleRows();
    const bill = buildBill(rows, dealKeys(rows), "Demo Agent", 2026, 3);
    expect(bill.cycle).toBe("03/01 - 03/31/2026");
    expect(bill.payout).toBe(84);
    expect(bill.lines.map((line) => line.paidToDate)).toEqual([84, 15]);
    expect(bill.suggested).toMatchObject({ statementNo: "EPSHEALTH - DA03- Demo Agent", payRate: "75%", totalMembers: "3", paidMembers: "2", terminated: "1" });
  });
});

describe("display", () => {
  it("shows every cell one way, whatever was typed", () => {
    expect(displayValue("mp", "21")).toEqual({ kind: "money", text: "$21.00" });
    expect(displayValue("ar", "$1120")).toEqual({ kind: "money", text: "$1,120.00" });
    expect(displayValue("ptd", "1/31/2026")).toEqual({ kind: "date", text: "01/31/2026" });
    expect(displayValue("ptd", "07/31/2026  6/30/2026")).toEqual({ kind: "date", text: "07/31/2026, 06/30/2026" });
    expect(displayValue("rate", "0.75")).toEqual({ kind: "text", text: "75%" });
    expect(displayValue("rate", "75.00%")).toEqual({ kind: "text", text: "75%" });
    expect(displayValue("rate", "0.7GA")).toEqual({ kind: "text", text: "0.7GA" });
    // The same code is the same pill in every month column…
    for (const field of ["mp", "ar", "ptd", "tid", "st"] as const) expect(displayValue(field, "nc")).toEqual({ kind: "code", text: "NC" });
    // …but a state is a state.
    expect(displayValue("state", "NC")).toEqual({ kind: "category", text: "NC", color: null });
    expect(displayValue("carrier", "Oscar")).toEqual(displayValue("carrier", "OSCAR "));
    expect(displayValue("stage", "Termination 2025")).toEqual({ kind: "category", text: "TERMINATION 2025", color: "#de350b" });
    expect(displayValue("tid", "")).toEqual({ kind: "empty" });
    expect(codeMeaning("p6")).toBe("Paid in Jun");
    expect(codeMeaning("N/C")).toBe("No contract");
    expect(codeMeaning("NE")).toBe("");
  });
});

describe("unpaid months", () => {
  const deal = (months: Array<[number, string, string]>, be = "3/1/2026") => {
    const rows = months.map(([m, ar, ptd], index) => ({
      id: index + 1, y: 2026, m, agent: "Demo", n: "1", deal: "X", stage: "Active", state: "TX", carrier: "Christus", plan: "",
      mid: "D1", pe: be, be, pt: "", mp: ar, rate: "0.75", ar, ov: "", ovr: "", sp: "", ptd, tid: "", st: "",
    }));
    return groupDeals(rows, dealKeys(rows))[0];
  };

  it("is empty when every month from broker effective is covered, a month late", () => {
    // Christus: the April report pays March, … the August report pays July.
    const paid = deal([[3, "P4", "P4"], [4, "$42.00", "03/31/2026"], [5, "$42.00", "04/30/2026"], [6, "$42.00", "05/31/2026"], [7, "$42.00", "06/30/2026"], [8, "$42.00", "07/31/2026"]]);
    expect(unpaidMonths(paid, 202608)).toEqual([]);
  });

  it("lists the months no payment covers", () => {
    const gap = deal([[3, "NC", "NC"], [4, "$42.00", "04/30/2026"], [5, "P", "P"], [6, "UP", "UP"], [7, "$42.00", "07/31/2026"], [8, "P", "P"]]);
    expect(unpaidMonths(gap, 202608)).toEqual([202605, 202606]);
  });

  it("stops before the deal was terminated", () => {
    const ended = deal([[3, "$42.00", "03/31/2026"], [4, "P", "P"], [5, "T", "T"], [6, "T", "T"]]);
    expect(unpaidMonths(ended, 202608)).toEqual([202604]);
  });
});

describe("unpaid months — data quirks", () => {
  const deal = (months: Array<[number, string, string]>, be = "3/1/2026") => {
    const rows = months.map(([m, ar, ptd], index) => ({
      id: index + 1, y: 2026, m, agent: "Demo", n: "1", deal: "X", stage: "Active", state: "TX", carrier: "BCBS", plan: "",
      mid: "D2", pe: be, be, pt: "", mp: ar, rate: "0.75", ar, ov: "", ovr: "", sp: "", ptd, tid: "", st: "",
    }));
    return groupDeals(rows, dealKeys(rows))[0];
  };

  it("counts a double payment as two months", () => {
    expect(unpaidMonths(deal([[3, "P4", "P"], [4, "$29.10", "04/30/2026"], [5, "$14.55", "5/31/2026"]]), 202606)).toEqual([]);
  });

  it("reads last year's year on a Paid-to-date as a typo", () => {
    expect(unpaidMonths(deal([[3, "$15.00", "3/31/2026"], [4, "$15.00", "04/30/2025"], [5, "$15.00", "5/31/2025"]]), 202606)).toEqual([]);
  });

  it("stops at the deal's last month in the data", () => {
    expect(unpaidMonths(deal([[3, "$15.00", "3/31/2026"]]), 202608)).toEqual([]);
  });
});

describe("unpaid months — years", () => {
  it("does not judge 2025 deals", () => {
    const rows = [{ id: 1, y: 2025, m: 5, agent: "Demo", n: "1", deal: "X", stage: "Active", state: "TX", carrier: "Oscar", plan: "",
      mid: "D3", pe: "1/1/2025", be: "1/1/2025", pt: "", mp: "$21.00", rate: "0.75", ar: "$21.00", ov: "", ovr: "", sp: "", ptd: "5/31/2025", tid: "", st: "" }];
    expect(unpaidMonths(groupDeals(rows, dealKeys(rows))[0], 202608)).toEqual([]);
  });
});
