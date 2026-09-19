import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderExportMatrix } from "@/lib/providers/export";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { writeXlsx } from "@/lib/table-config/sheet-io";

export const dynamic = "force-dynamic";

/**
 * Xuất Provider List ra `.xlsx`.
 *
 * Nhận `ids` trong thân request chứ không trên URL: bảng có 458 dòng, nhét từng
 * id vào query string là vượt giới hạn độ dài URL và server trả 431.
 *
 * File xuất ra nhập lại được ngay, không cần map cột — xem `buildProviderExportMatrix`.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    columns?: unknown;
    ids?: unknown;
  };
  const requestedKeys = toStringSet(body.columns);
  const requestedIds = toStringSet(body.ids);

  const supabase = getSupabaseAdmin();
  const [columns, result] = await Promise.all([
    fetchTableColumns("provider"),
    supabase
      .from(PROVIDER_TABLE)
      .select(PROVIDER_SELECT)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const rows = (result.data ?? []) as unknown as ProviderRow[];
  // Không có danh sách cột thì xuất đúng những cột hiện mặc định — xuất cả cột
  // admin đã ẩn là đưa ra thứ người dùng chưa từng thấy trên màn hình.
  const exportColumns = columns.filter((column) =>
    requestedKeys.size === 0 ? !column.hidden_default : requestedKeys.has(column.key)
  );
  // Giữ đúng thứ tự người dùng đang thấy trên bảng.
  const exportRows =
    requestedIds.size === 0 ? rows : orderByRequestedIds(rows, requestedIds);

  const matrix = buildProviderExportMatrix(exportRows, exportColumns);
  const buffer = writeXlsx(matrix.header, matrix.rows);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="provider-list.xlsx"`,
    },
  });
}

function toStringSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(
    value.filter((item): item is string => typeof item === "string" && item.length > 0)
  );
}

function orderByRequestedIds(rows: ProviderRow[], ids: Set<string>): ProviderRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return [...ids].flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
}
