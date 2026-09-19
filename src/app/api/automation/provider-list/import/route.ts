import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { todayForColumn } from "@/lib/providers/form";
import { PROVIDER_IMPORT_MANAGED_KEYS } from "@/lib/providers/import";
import { buildProviderPatch } from "@/lib/providers/patch";
import { personLabel } from "@/lib/tasks/people";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";

export const dynamic = "force-dynamic";

/** Trần an toàn: một file quá cỡ thì chặn ngay chứ đừng ghi được nửa bảng rồi hỏng. */
const MAX_ROWS = 2000;

type IncomingRow = {
  /** Số dòng trong Excel, chỉ dùng để báo lỗi đúng dòng người dùng thấy. */
  row?: unknown;
  id?: unknown;
  body?: unknown;
};

/**
 * Nhập provider từ file Excel.
 *
 * Màn hình đã dựng sẵn thân request cho từng dòng (xem `lib/providers/import`),
 * nên ở đây chỉ còn việc kiểm quyền rồi đẩy qua ĐÚNG hai đường ghi đang có:
 * `parseCreateProviderInput` cho dòng mới và `buildProviderPatch` cho dòng cũ.
 * Không mở đường ghi thứ ba — một luật kiểm tra chỉ sống ở một chỗ.
 */
export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(session.user.permissions, PERMISSIONS.AUTOMATION_PROVIDER_FINDER)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  if (!payload || !Array.isArray(payload.rows)) {
    return NextResponse.json({ error: "rows must be an array." }, { status: 400 });
  }
  if (payload.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `At most ${MAX_ROWS} rows per import.` },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const actor = email.trim().toLowerCase();

  // Hai ô này do MÁY CHỦ đặt, không lấy từ thân request. Màn hình cũng đặt
  // chúng để bản xem trước nói đúng, nhưng tin vào giá trị client gửi lên thì
  // ai cũng khai được mình là người đã kiểm dòng đó.
  const columns = await fetchTableColumns("provider");
  const stamp: Record<string, unknown> = {
    verified_by: personLabel(
      email,
      session.user.name ? new Map([[email, session.user.name]]) : undefined
    ),
    date: todayForColumn(columns.find((column) => column.key === "date")),
  };
  const applyStamp = (body: Record<string, unknown>) => {
    const next = { ...body };
    for (const key of PROVIDER_IMPORT_MANAGED_KEYS) next[key] = stamp[key];
    return next;
  };
  const failed: { row: number; error: string }[] = [];
  const created: ProviderRow[] = [];
  const updated: ProviderRow[] = [];

  for (const raw of payload.rows as IncomingRow[]) {
    const excelRow = typeof raw.row === "number" ? raw.row : 0;
    const body = raw.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      failed.push({ row: excelRow, error: "Invalid row." });
      continue;
    }

    if (typeof raw.id === "string" && raw.id) {
      const parsed = buildProviderPatch(applyStamp(body as Record<string, unknown>));
      if (!parsed.ok) {
        failed.push({ row: excelRow, error: parsed.error });
        continue;
      }
      const patch: Record<string, unknown> = { ...parsed.patch };
      if (parsed.customValues) {
        // Vá từng khoá như đường sửa tại chỗ: file nhập chỉ mang vài cột, ghi
        // đè cả cụm sẽ xoá mất những cột tuỳ chỉnh khác của dòng đó.
        const { data: current } = await supabase
          .from(PROVIDER_TABLE)
          .select("custom_values")
          .eq("id", raw.id)
          .is("archived_at", null)
          .maybeSingle();
        patch.custom_values = {
          ...(((current as { custom_values?: Record<string, unknown> } | null)
            ?.custom_values) ?? {}),
          ...parsed.customValues,
        };
      }

      const { data, error } = await supabase
        .from(PROVIDER_TABLE)
        .update({
          ...patch,
          updated_at: new Date().toISOString(),
          updated_by_email: actor,
        })
        .eq("id", raw.id)
        .is("archived_at", null)
        .select(PROVIDER_SELECT)
        .maybeSingle();
      if (error) {
        failed.push({ row: excelRow, error: error.message });
        continue;
      }
      if (!data) {
        // Dòng đã bị xoá hoặc archive sau lúc xuất file. Báo ra chứ đừng lặng lẽ
        // biến nó thành dòng mới — người dùng sẽ có hai bản ghi trùng nhau.
        failed.push({ row: excelRow, error: "No row found with this ID." });
        continue;
      }
      updated.push(data as unknown as ProviderRow);
      continue;
    }

    const parsed = parseCreateProviderInput(applyStamp(body as Record<string, unknown>));
    if (!parsed.ok) {
      failed.push({ row: excelRow, error: parsed.error });
      continue;
    }
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
      .insert(buildProviderRow(parsed.value, { actorEmail: actor }))
      .select(PROVIDER_SELECT)
      .single();
    if (error) {
      failed.push({ row: excelRow, error: error.message });
      continue;
    }
    created.push(data as unknown as ProviderRow);
  }

  return NextResponse.json({
    created: created.length,
    updated: updated.length,
    failed,
    rows: [...created, ...updated],
  });
}
