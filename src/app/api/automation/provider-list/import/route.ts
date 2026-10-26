import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auth } from "@/auth";
import { canImportProviders, providerWritesGoLive } from "@/lib/providers/access";
import {
  findProviderDuplicate,
  pendingProviderFields,
  proposedProviderValues,
} from "@/lib/providers/backlog";
import { fetchLiveProviderKeys } from "@/lib/providers/backlog-queries";
import { notifyProviderBacklogSubmitted } from "@/lib/providers/notifications";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildProviderRow, parseCreateProviderInput } from "@/lib/providers/create";
import { PROVIDER_STAMP_TIME_ZONE, todayForColumn } from "@/lib/providers/form";
import { PROVIDER_IMPORT_MANAGED_KEYS } from "@/lib/providers/import";
import { buildProviderPatch } from "@/lib/providers/patch";
import { personLabel } from "@/lib/tasks/people";
import { fetchTableColumns } from "@/lib/table-config/queries";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";
import { providerFieldChanges } from "@/lib/providers/activity";
import { insertProviderActivity, isProviderUuid } from "@/lib/providers/collaboration";

export const dynamic = "force-dynamic";

/** Trần an toàn: một file quá cỡ thì chặn ngay chứ đừng ghi được nửa bảng rồi hỏng. */
const MAX_ROWS = 2000;
// `.in("id", …)` đi trong URL: 2.000 uuid một lượt là ~80 KB, quá giới hạn URL.
const SNAPSHOT_CHUNK = 200;
const ACTIVITY_INSERT_CHUNK = 500;
const BACKLOG_INSERT_CHUNK = 100;

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
 *
 * Người không có Provider List - Manage thì cả lượt vào Backlog
 * (`importIntoBacklog`), không dòng nào của danh sách bị đụng tới.
 */
export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Ai xem được Provider List cũng nhập được (2026-10-26) — người không có
  // Manage thì vào Backlog. Người không được vào Provider List thì vẫn không
  // được đụng tới dữ liệu của nó.
  if (!canImportProviders(session.user.permissions)) {
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
  if (!providerWritesGoLive(session.user.permissions)) {
    return importIntoBacklog(supabase, actor, payload.rows as IncomingRow[]);
  }

  // Hai ô này do MÁY CHỦ đặt, không lấy từ thân request. Màn hình cũng đặt
  // chúng để bản xem trước nói đúng, nhưng tin vào giá trị client gửi lên thì
  // ai cũng khai được mình là người đã kiểm dòng đó.
  const columns = await fetchTableColumns("provider");
  const stamp: Record<string, unknown> = {
    verified_by: personLabel(
      email,
      session.user.name ? new Map([[email, session.user.name]]) : undefined
    ),
    date: todayForColumn(
      columns.find((column) => column.key === "date"),
      new Date(),
      PROVIDER_STAMP_TIME_ZONE,
    ),
  };
  const applyStamp = (body: Record<string, unknown>) => {
    const next = { ...body };
    for (const key of PROVIDER_IMPORT_MANAGED_KEYS) next[key] = stamp[key];
    return next;
  };
  const failed: { row: number; error: string }[] = [];
  const created: ProviderRow[] = [];
  const updated: ProviderRow[] = [];

  // Bản trước khi nhập của các dòng sẽ bị sửa, để Activity ghi "cũ → mới" như
  // khi sửa tay. Đọc theo chùm một lần thay vì mỗi dòng một lượt; sau mỗi lượt
  // ghi thì thay bằng bản mới, nên một id lặp hai lần trong file vẫn so đúng.
  const snapshotIds = [
    ...new Set(
      (payload.rows as IncomingRow[])
        .map((raw) => (typeof raw.id === "string" ? raw.id : ""))
        .filter(isProviderUuid)
    ),
  ];
  const snapshots = new Map<string, ProviderRow>();
  for (let index = 0; index < snapshotIds.length; index += SNAPSHOT_CHUNK) {
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
      .select(PROVIDER_SELECT)
      .in("id", snapshotIds.slice(index, index + SNAPSHOT_CHUNK));
    // Thiếu snapshot thì import vẫn sửa được dòng nhưng Activity sẽ im lặng
    // mất phần "cũ → mới". Dừng trước lượt ghi đầu tiên nếu đọc thất bại.
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data ?? []) as unknown as ProviderRow[]) snapshots.set(row.id, row);
  }
  const activity: Parameters<typeof insertProviderActivity>[1] = [];

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
        // ID của một dòng còn ở Backlog không phải dòng của danh sách: dòng đó
        // chỉ đi tiếp qua nút duyệt.
        .eq("pending", false)
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
      const saved = data as unknown as ProviderRow;
      const before = snapshots.get(raw.id);
      const changes = before ? providerFieldChanges(before, saved) : [];
      if (changes.length > 0) {
        activity.push({
          provider_id: raw.id,
          actor_email: actor,
          type: "field_changed",
          meta: { changes, source: "import" },
        });
      }
      snapshots.set(raw.id, saved);
      updated.push(saved);
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
    activity.push({
      provider_id: (data as unknown as ProviderRow).id,
      actor_email: actor,
      type: "created",
      meta: { source: "import" },
    });
  }

  for (let index = 0; index < activity.length; index += ACTIVITY_INSERT_CHUNK) {
    await insertProviderActivity(supabase, activity.slice(index, index + ACTIVITY_INSERT_CHUNK));
  }

  return NextResponse.json({
    created: created.length,
    updated: updated.length,
    failed,
    rows: [...created, ...updated],
  });
}

/**
 * Lượt nhập của người không có Provider List - Manage (2026-10-26): MỌI dòng vào
 * Backlog, kể cả dòng mang ID của một dòng đã có — dòng đó thành bản đề xuất
 * (dòng cũ phủ thêm phần trong file), tag Duplicate trỏ về dòng cũ. Dòng mới
 * cũng được dò trùng theo địa chỉ. Danh sách không đổi gì cho tới khi có người
 * duyệt.
 *
 * Không đóng dấu Verified — người duyệt đóng dấu lúc Verify — nên bỏ hẳn hai ô
 * do lượt nhập đặt (`PROVIDER_IMPORT_MANAGED_KEYS`) khỏi thân từng dòng.
 */
async function importIntoBacklog(
  supabase: SupabaseClient,
  actor: string,
  rows: IncomingRow[]
) {
  const failed: { row: number; error: string }[] = [];
  const submitted: ProviderRow[] = [];
  const prepared: { row: number; insert: Record<string, unknown> }[] = [];

  let liveKeys: Awaited<ReturnType<typeof fetchLiveProviderKeys>>;
  try {
    liveKeys = await fetchLiveProviderKeys(supabase);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not read the list." },
      { status: 500 }
    );
  }

  // Dòng cũ mà file trỏ tới qua cột ID — chỉ dòng đang ở trong danh sách.
  const ids = [
    ...new Set(
      rows.map((raw) => (typeof raw.id === "string" ? raw.id : "")).filter(isProviderUuid)
    ),
  ];
  const existingById = new Map<string, ProviderRow>();
  for (let index = 0; index < ids.length; index += SNAPSHOT_CHUNK) {
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
      .select(PROVIDER_SELECT)
      .in("id", ids.slice(index, index + SNAPSHOT_CHUNK))
      .eq("pending", false)
      .is("archived_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data ?? []) as unknown as ProviderRow[]) existingById.set(row.id, row);
  }

  const withoutManagedKeys = (body: Record<string, unknown>) => {
    const next = { ...body };
    for (const key of PROVIDER_IMPORT_MANAGED_KEYS) delete next[key];
    return next;
  };

  for (const raw of rows) {
    const excelRow = typeof raw.row === "number" ? raw.row : 0;
    const body = raw.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      failed.push({ row: excelRow, error: "Invalid row." });
      continue;
    }

    let insert: Record<string, unknown>;
    if (typeof raw.id === "string" && raw.id) {
      const existing = existingById.get(raw.id);
      if (!existing) {
        failed.push({ row: excelRow, error: "No row found with this ID." });
        continue;
      }
      const parsed = buildProviderPatch(withoutManagedKeys(body as Record<string, unknown>));
      if (!parsed.ok) {
        failed.push({ row: excelRow, error: parsed.error });
        continue;
      }
      insert = {
        ...proposedProviderValues(existing, parsed.patch, parsed.customValues),
        source_row_number: null,
        created_by_email: actor,
        updated_by_email: actor,
        ...pendingProviderFields(existing.id),
      };
    } else {
      const parsed = parseCreateProviderInput(
        withoutManagedKeys(body as Record<string, unknown>)
      );
      if (!parsed.ok) {
        failed.push({ row: excelRow, error: parsed.error });
        continue;
      }
      insert = {
        ...buildProviderRow(parsed.value, { actorEmail: actor }),
        ...pendingProviderFields(findProviderDuplicate(parsed.value, liveKeys)),
      };
    }

    prepared.push({ row: excelRow, insert });
  }

  // Một lượt nhập có thể tới 2.000 dòng. Ghi từng dòng qua HTTP làm request
  // kéo dài hàng phút; chia lô, chỉ thử từng dòng khi một lô có lỗi để vẫn báo
  // đúng dòng Excel nào hỏng mà không bỏ cả lượt nhập.
  for (let index = 0; index < prepared.length; index += BACKLOG_INSERT_CHUNK) {
    const chunk = prepared.slice(index, index + BACKLOG_INSERT_CHUNK);
    const { data, error } = await supabase
      .from(PROVIDER_TABLE)
      .insert(chunk.map((item) => item.insert))
      .select(PROVIDER_SELECT);
    if (!error && data?.length === chunk.length) {
      submitted.push(...(data as unknown as ProviderRow[]));
      continue;
    }
    // Lỗi mạng có thể xảy ra SAU khi database đã commit nhưng TRƯỚC khi nhận
    // response. Không thử lại vì sẽ chèn trùng; chỉ tách lô khi có SQLSTATE
    // rõ ràng rằng transaction đã rollback (ví dụ một dòng vi phạm CHECK).
    if (!error?.code || !/^[0-9A-Z]{5}$/.test(error.code)) {
      for (const item of chunk) {
        failed.push({ row: item.row, error: error?.message ?? "Could not confirm this row was saved. Reload the Backlog before importing again." });
      }
      continue;
    }
    for (const item of chunk) {
      const retry = await supabase
        .from(PROVIDER_TABLE)
        .insert(item.insert)
        .select(PROVIDER_SELECT)
        .single();
      if (retry.error || !retry.data) {
        failed.push({ row: item.row, error: retry.error?.message ?? "Could not save this row." });
      } else {
        submitted.push(retry.data as unknown as ProviderRow);
      }
    }
  }

  const activity = submitted.map((row) => ({
    provider_id: row.id,
    actor_email: actor,
    type: "submitted" as const,
    meta: { source: "import" },
  }));
  for (let index = 0; index < activity.length; index += ACTIVITY_INSERT_CHUNK) {
    await insertProviderActivity(supabase, activity.slice(index, index + ACTIVITY_INSERT_CHUNK));
  }
  if (submitted.length > 0) {
    const first = submitted[0].id;
    after(async () => {
      try {
        await notifyProviderBacklogSubmitted({
          providerId: first,
          actorEmail: actor,
          count: submitted.length,
        });
      } catch (error) {
        console.error("provider.backlog.notify_failed", {
          stage: "submitted",
          error: error instanceof Error ? error.message : "unknown error",
        });
      }
    });
  }

  return NextResponse.json({
    created: 0,
    updated: 0,
    submitted: submitted.length,
    failed,
    rows: [],
    backlog: submitted,
  });
}
