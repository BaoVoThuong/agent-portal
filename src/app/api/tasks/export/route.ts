import { NextResponse } from "next/server";
import { loadEnrollmentActor } from "@/lib/enrollment/access";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTaskAgents, fetchTaskAssignees } from "@/lib/tasks/assignees";
import { fetchTasksForActor } from "@/lib/tasks/queries";
import { taskKey } from "@/lib/tasks/sorting";
import { STATUS_LABEL, type TaskRow } from "@/lib/tasks/types";
import { buildExportMatrix } from "@/lib/table-config/export";
import { canActorExportImport } from "@/lib/table-config/export-access";
import {
  fetchTableColumnOptions,
  fetchTableColumns,
} from "@/lib/table-config/queries";
import { writeXlsx } from "@/lib/table-config/sheet-io";
import type { TableColumn } from "@/lib/table-config/types";
import { formatCustomValue } from "@/lib/table-config/values";

export const dynamic = "force-dynamic";

// GET is kept for tiny/no-id selections and backward compat. The board UI now
// POSTs the visible ids in the body: with a few hundred tasks the id list blows
// past the server's max URL/header size on GET and fails with HTTP 431.
export async function GET(request: Request) {
  const url = new URL(request.url);
  return exportTasksResponse({
    requestedKeys: parseColumnKeys(url.searchParams.get("columns")),
    requestedIds: parseColumnKeys(url.searchParams.get("ids")),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    columns?: unknown;
    ids?: unknown;
  };
  return exportTasksResponse({
    requestedKeys: parseColumnKeyInput(body.columns),
    requestedIds: parseColumnKeyInput(body.ids),
  });
}

async function exportTasksResponse({
  requestedKeys,
  requestedIds,
}: {
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

  const supabase = getSupabaseAdmin();
  const [tasks, columns, customOptions, categories, assignees, agents] =
    await Promise.all([
      fetchTasksForActor(actorResult.actor),
      fetchTableColumns("cs"),
      fetchTableColumnOptions("cs"),
      supabase
        .from("task_categories")
        .select("id,name")
        .eq("is_active", true),
      fetchTaskAssignees(),
      fetchTaskAgents(),
    ]);
  if (categories.error) {
    return NextResponse.json({ error: categories.error.message }, { status: 500 });
  }

  const categoryById = new Map(
    ((categories.data ?? []) as Array<{ id: string; name: string }>).map(
      (category) => [category.id, category.name]
    )
  );
  const personByEmail = new Map(
    [...assignees, ...agents].map((person) => [
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
  const exportTasks = requestedIds.size === 0 ? tasks : orderByRequestedIds(tasks, requestedIds);

  const matrix = buildExportMatrix(
    exportTasks,
    exportColumns,
    taskExportValue,
    (column, raw) =>
      formatTaskExportValue(column, raw, {
        categoryById,
        optionLabels: customOptionLabels,
        names: personByEmail,
      })
  );
  const buffer = writeXlsx(matrix.header, matrix.rows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="health-tasks.xlsx"`,
    },
  });
}

function taskExportValue(task: TaskRow, key: string): unknown {
  switch (key) {
    case "key":
      return taskKey(task.id);
    case "summary":
      return task.title;
    case "assignee":
      return task.assignees.join(", ") || task.assignee_email;
    case "category":
      return task.category_id;
    case "status":
      return task.status;
    case "priority":
      return task.priority;
    case "slaRemaining":
      return task.status === "backlog"
        ? "Backlog"
        : task.overdue_flagged_at
          ? "Overdue"
          : "";
    case "agent":
      return task.agent_email;
    case "reporter":
      return task.reporter_email;
    case "created":
      return task.created_at;
    case "activity":
      return task.last_activity_at;
    case "review":
      return task.done_reviewed_at ? "Yes" : "";
    default:
      return task.custom_values?.[key] ?? null;
  }
}

function formatTaskExportValue(
  column: TableColumn,
  raw: unknown,
  ctx: {
    categoryById: Map<string, string>;
    optionLabels: Map<string, string>;
    names: Map<string, string>;
  }
): string {
  if (!column.is_system) {
    return formatCustomValue(column.type, raw, {
      optionLabelById: ctx.optionLabels,
      personLabelByEmail: ctx.names,
    });
  }
  if (column.key === "category") {
    return raw ? ctx.categoryById.get(String(raw)) ?? String(raw) : "";
  }
  if (column.key === "status") {
    return raw ? STATUS_LABEL[String(raw) as keyof typeof STATUS_LABEL] ?? String(raw) : "";
  }
  if (["assignee", "agent", "reporter"].includes(column.key)) {
    if (!raw) return "";
    return String(raw)
      .split(",")
      .map((email) => ctx.names.get(email.trim()) ?? email.trim())
      .join(", ");
  }
  return raw == null ? "" : String(raw);
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
  tasks: TaskRow[],
  requestedIds: ReadonlySet<string>
): TaskRow[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return [...requestedIds]
    .map((id) => byId.get(id))
    .filter((task): task is TaskRow => Boolean(task));
}
