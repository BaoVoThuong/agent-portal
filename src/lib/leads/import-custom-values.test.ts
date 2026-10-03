import { describe, expect, it } from "vitest";
import type { TableColumn, TableColumnOption } from "@/lib/table-config/types";
import { findMissingChoiceLabels, toImportCustomValues } from "./import-custom-values";
import type { TemplateLead } from "./import-template";

function column(key: string, type: TableColumn["type"], over: Partial<TableColumn> = {}): TableColumn {
  return {
    id: `col-${key}`,
    scope: "lead",
    key,
    label: key,
    type,
    is_system: false,
    position: 0,
    pinned: false,
    hidden_default: false,
    show_in_detail: true,
    required: false,
    archived_at: null,
    ...over,
  };
}

function option(columnKey: string, label: string): TableColumnOption {
  return {
    id: `opt-${columnKey}-${label}`,
    column_id: `col-${columnKey}`,
    label,
    color: null,
    position: 0,
    archived_at: null,
  } as TableColumnOption;
}

function row(customRaw: TemplateLead["customRaw"]): TemplateLead {
  return {
    row: 2,
    full_name: null,
    phone: null,
    email: null,
    fub_link: null,
    description: null,
    agentName: null,
    customRaw,
  };
}

const columns = [
  column("age", "number"),
  column("gender", "dropdown"),
  column("ticket_number", "text"),
  column("best_time_to_contact", "multiselect"),
  column("insurance_needs", "multiselect"),
];
const options = [
  option("gender", "Female"),
  option("best_time_to_contact", "AM"),
  option("best_time_to_contact", "PM"),
  option("insurance_needs", "Medicare"),
];

describe("toImportCustomValues", () => {
  // validateCustomValues chỉ nhận option id; file chứa nhãn.
  it("turns labels into option ids, case-insensitively", () => {
    const { values, warnings } = toImportCustomValues(
      row({ age: 71, gender: "female", ticket_number: "4001, 4002", best_time_to_contact: "AM, PM" }),
      columns,
      options,
    );
    expect(values).toEqual({
      age: 71,
      gender: "opt-gender-Female",
      ticket_number: "4001, 4002",
      best_time_to_contact: ["opt-best_time_to_contact-AM", "opt-best_time_to_contact-PM"],
    });
    expect(warnings).toEqual([]);
  });

  it("drops one bad cell with a reason and keeps the rest", () => {
    const { values, warnings } = toImportCustomValues(
      row({ age: "seventy", gender: "Female" }),
      columns,
      options,
    );
    expect(values).toEqual({ gender: "opt-gender-Female" });
    expect(warnings).toHaveLength(1);
  });

  it("ignores a template column that is not in Table Config", () => {
    const { values } = toImportCustomValues(
      row({ contact_method: "Text" }),
      columns,
      options,
    );
    expect(values).toEqual({});
  });
});

describe("findMissingChoiceLabels", () => {
  // "Có gì ghi nấy": nhãn chưa có thì tạo, không bỏ.
  it("collects labels the columns do not have yet, once each", () => {
    const missing = findMissingChoiceLabels(
      [
        row({ insurance_needs: "Medicare, Pet Insurance", gender: "Male" }),
        row({ insurance_needs: "pet insurance" }),
      ],
      columns,
      options,
    );
    expect(missing.map(({ column: col, labels }) => [col.key, labels])).toEqual([
      ["gender", ["Male"]],
      ["insurance_needs", ["Pet Insurance"]],
    ]);
  });
});
