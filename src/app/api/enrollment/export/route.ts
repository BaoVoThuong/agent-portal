import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { optionById } from "@/lib/enrollment/options";
import {
  fetchEnrollmentOptionData,
} from "@/lib/enrollment/options";
import {
  fetchEnrollmentPeople,
  fetchEnrollmentRecords,
  EnrollmentListTruncatedError,
} from "@/lib/enrollment/queries";
import {
  parseEnrollmentProgram,
  type EnrollmentRecordWithStats,
  type EnrollmentProgram,
} from "@/lib/enrollment/types";
import { buildExportMatrix } from "@/lib/table-config/export";
import { canActorExport } from "@/lib/table-config/export-access";
import {
  fetchTableColumnOptions,
  fetchTableColumns,
} from "@/lib/table-config/queries";
import { writeXlsx } from "@/lib/table-config/sheet-io";
import { formatCustomValue } from "@/lib/table-config/values";
import type { TableColumn } from "@/lib/table-config/types";
import { resolveEnrollmentScope } from "@/lib/enrollment/scope";
import { enrollmentDisplayKey } from "@/lib/enrollment/helpers";
import { buildEnrollmentTimeProgress } from "@/lib/enrollment/time-progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const program = parseEnrollmentProgram(url.searchParams.get("program"));
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }
  return exportEnrollment({
    program,
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
  const program = parseEnrollmentProgram(body?.program);
  if (!program) {
    return NextResponse.json({ error: "Invalid enrollment program." }, { status: 400 });
  }

  return exportEnrollment({
    program,
    requestedKeys: parseColumnKeyInput(body.columns),
    requestedIds: parseColumnKeyInput(body.ids),
  });
}

async function exportEnrollment({
  program,
  requestedKeys,
  requestedIds,
}: {
  program: EnrollmentProgram;
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
  if (!canActorExport(actorResult.permissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let records: EnrollmentRecordWithStats[];
  try {
    const scope = await resolveEnrollmentScope(actorResult.actor);
    records = await fetchEnrollmentRecords(program, scope);
  } catch (error) {
    if (error instanceof EnrollmentListTruncatedError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "ENROLLMENT_LIST_TRUNCATED",
          total: error.total,
          loaded: error.loaded,
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load enrollment records." },
      { status: 500 }
    );
  }
  const [optionData, people, columns, customOptions] = await Promise.all([
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
  const exportNow = new Date();

  const matrix = buildExportMatrix(
    exportRecords,
    exportColumns,
    (record, key) =>
      enrollmentExportValue(record, key, {
        now: exportNow,
        optionById: optionByOptionId,
      }),
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

function enrollmentExportValue(
  record: EnrollmentRecordWithStats,
  key: string,
  ctx: {
    now: Date;
    optionById: ReadonlyMap<string, { label: string }>;
  }
): unknown {
  switch (key) {
    case "key":
      return enrollmentDisplayKey(record.display_number);
    case "client":
      return record.client_name;
    case "agent":
      return record.agent_email;
    case "stage":
      return record.stage_id;
    case "timeProgress":
      return buildEnrollmentTimeProgress(
        record,
        record.stage_id ? ctx.optionById.get(record.stage_id)?.label ?? null : null,
        ctx.now
      ).label;
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
    if (["agent", "caller", "responsible", "createdBy", "updatedBy"].includes(column.key)) {
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
