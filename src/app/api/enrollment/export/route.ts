import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { optionById } from "@/lib/enrollment/options";
import {
  fetchEnrollmentOptionData,
} from "@/lib/enrollment/options";
import {
  fetchEnrollmentPeople,
  fetchEnrollmentRecords,
} from "@/lib/enrollment/queries";
import {
  toEnrollmentProgram,
  type EnrollmentRecordWithStats,
} from "@/lib/enrollment/types";
import { buildExportMatrix } from "@/lib/table-config/export";
import { canActorExportImport } from "@/lib/table-config/export-access";
import {
  fetchTableColumnOptions,
  fetchTableColumns,
} from "@/lib/table-config/queries";
import { writeXlsx } from "@/lib/table-config/sheet-io";
import { formatCustomValue } from "@/lib/table-config/values";
import type { TableColumn } from "@/lib/table-config/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return exportEnrollment({
    program: toEnrollmentProgram(url.searchParams.get("program")),
    requestedKeys: parseColumnKeys(url.searchParams.get("columns")),
    requestedIds: parseColumnKeys(url.searchParams.get("ids")),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    program?: unknown;
    columns?: unknown;
    ids?: unknown;
  };

  return exportEnrollment({
    program: toEnrollmentProgram(body.program),
    requestedKeys: parseColumnKeyInput(body.columns),
    requestedIds: parseColumnKeyInput(body.ids),
  });
}

async function exportEnrollment({
  program,
  requestedKeys,
  requestedIds,
}: {
  program: ReturnType<typeof toEnrollmentProgram>;
  requestedKeys: ReadonlySet<string>;
  requestedIds: ReadonlySet<string>;
}) {
  const actorResult = await loadEnrollmentActor();
  if (!actorResult.ok) {
    return NextResponse.json(
      { error: actorResult.error },
      { status: actorResult.status }
    );
  }
  if (!(await canActorExportImport(actorResult.actor))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [records, optionData, people, columns, customOptions] = await Promise.all([
    fetchEnrollmentRecords(program),
    fetchEnrollmentOptionData(program),
    fetchEnrollmentPeople(),
    fetchTableColumns(program),
    fetchTableColumnOptions(program),
  ]);
  const optionByOptionId = optionById(optionData.options);
  const personByEmail = new Map(
    people.map((person) => [
      person.email,
      person.name?.trim() || person.email,
    ])
  );
  const customOptionLabels = new Map(
    customOptions.map((option) => [option.id, option.label])
  );
  const exportColumns = columns
    .filter((column) => !column.hidden_default)
    .filter((column) => requestedKeys.size === 0 || requestedKeys.has(column.key));
  const exportRecords =
    requestedIds.size === 0 ? records : orderByRequestedIds(records, requestedIds);

  const matrix = buildExportMatrix(
    exportRecords,
    exportColumns,
    enrollmentExportValue,
    (column, raw) =>
      formatEnrollmentExportValue(column, raw, {
        optionLabels: new Map([
          ...[...optionByOptionId.entries()].map(
            ([id, option]) => [id, option.label] as const
          ),
          ...customOptionLabels,
        ]),
        names: personByEmail,
      })
  );
  const buffer = writeXlsx(matrix.header, matrix.rows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="enrollment-${program}.xlsx"`,
    },
  });
}

function enrollmentExportValue(record: EnrollmentRecordWithStats, key: string): unknown {
  switch (key) {
    case "key":
      return `ENR-${record.id.slice(0, 4).toUpperCase()}`;
    case "client":
      return record.client_name;
    case "stage":
      return record.stage_id;
    case "caller":
      return record.caller_email;
    case "responsible":
      return record.responsible_enroll_email;
    case "payment":
      return record.payment_status_id;
    case "carrier":
      return record.carrier_id;
    case "aca":
      return record.aca_status_id;
    case "consent":
      return record.consent_id;
    case "platform":
      return record.platform_id;
    case "pcp2025":
      return record.pcp_2025;
    case "pcp2026":
      return record.pcp_2026;
    case "due":
      return record.due_date;
    case "fub":
      return record.fub_link;
    case "createdBy":
      return record.created_by_email;
    case "createdAt":
      return record.created_at;
    case "updatedBy":
      return record.updated_by_email;
    case "updated":
      return record.updated_at;
    case "qc":
      return record.qc_checked_at ? "Yes" : "";
    default:
      return record.custom_values?.[key] ?? null;
  }
}

function formatEnrollmentExportValue(
  column: TableColumn,
  raw: unknown,
  ctx: {
    optionLabels: Map<string, string>;
    names: Map<string, string>;
  }
): string {
  if (column.is_system) {
    if (["stage", "payment", "carrier", "aca", "consent", "platform"].includes(column.key)) {
      return raw ? ctx.optionLabels.get(String(raw)) ?? String(raw) : "";
    }
    if (["caller", "responsible", "createdBy", "updatedBy"].includes(column.key)) {
      return raw ? ctx.names.get(String(raw)) ?? String(raw) : "";
    }
    return raw == null ? "" : String(raw);
  }
  return formatCustomValue(column.type, raw, {
    optionLabelById: ctx.optionLabels,
    personLabelByEmail: ctx.names,
  });
}

function parseColumnKeys(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
  );
}

function parseColumnKeyInput(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(
      value
        .map((key) => (typeof key === "string" ? key.trim() : ""))
        .filter(Boolean)
    );
  }
  return parseColumnKeys(typeof value === "string" ? value : null);
}

function orderByRequestedIds(
  records: EnrollmentRecordWithStats[],
  requestedIds: ReadonlySet<string>
): EnrollmentRecordWithStats[] {
  const byId = new Map(records.map((record) => [record.id, record]));
  return [...requestedIds]
    .map((id) => byId.get(id))
    .filter((record): record is EnrollmentRecordWithStats => Boolean(record));
}
