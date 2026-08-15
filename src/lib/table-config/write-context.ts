import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { TableColumn, TableColumnOption, TableScope } from "./types";
import type { CustomValueRecord, WriteValidationContext } from "./custom-values";

export type WriteContextRequest = {
  scope: TableScope;
  mode: "create" | "patch";
  touchedSystemKeys: readonly string[];
  touchedCustomKeys: readonly string[];
  submittedCustomValues: CustomValueRecord;
};

type RpcContext = {
  columns?: unknown;
  options?: unknown;
  matched_person_emails?: unknown;
};

export class TableConfigUnavailableError extends Error {
  readonly code = "TABLE_CONFIG_UNAVAILABLE";

  constructor() {
    super("Table configuration is temporarily unavailable.");
    this.name = "TableConfigUnavailableError";
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseContext(data: unknown): WriteValidationContext {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new TableConfigUnavailableError();
  }
  const payload = data as RpcContext;
  return {
    columns: asArray(payload.columns) as TableColumn[],
    options: asArray(payload.options) as TableColumnOption[],
    matchedPersonEmails: asArray(payload.matched_person_emails).filter(
      (value): value is string => typeof value === "string"
    ),
  };
}

/** One network request for metadata and conditional Person matching. */
export async function fetchWriteValidationContext(
  request: WriteContextRequest,
  supabase: SupabaseClient = getSupabaseAdmin()
): Promise<WriteValidationContext> {
  const { data, error } = await supabase.rpc("table_config_write_context", {
    p_scope: request.scope,
    p_mode: request.mode,
    p_touched_system_keys: [...new Set(request.touchedSystemKeys)],
    p_touched_custom_keys: [...new Set(request.touchedCustomKeys)],
    p_submitted_custom_values: request.submittedCustomValues,
  });
  if (error) {
    if (isMissingContextSchema(error)) throw new TableConfigUnavailableError();
    const wrapped = new Error(error.message ?? "Could not load table validation context.");
    Object.assign(wrapped, { code: error.code });
    throw wrapped;
  }
  return parseContext(data);
}

function isMissingContextSchema(error: { code?: string; message?: string } | null): boolean {
  const code = error?.code ?? "";
  const message = error?.message?.toLowerCase() ?? "";
  return (
    code === "42P01" ||
    code === "42883" ||
    code === "PGRST202" ||
    (message.includes("table_config_write_context") &&
      (message.includes("does not exist") || message.includes("schema cache"))) ||
    (message.includes("table_column") && message.includes("does not exist"))
  );
}
