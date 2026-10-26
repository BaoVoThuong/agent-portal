import type { SupabaseClient } from "@supabase/supabase-js";
import { findProviderDuplicate } from "./backlog";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "./types";

type DuplicateKeyRow = Parameters<typeof findProviderDuplicate>[1][number];

/**
 * Dòng đang ở trong danh sách (đã duyệt, chưa xoá), chỉ những ô dùng để dò trùng
 * cho Backlog. Vài trăm dòng × sáu ô ngắn: một truy vấn, dò ngay trong bộ nhớ.
 */
export async function fetchLiveProviderKeys(
  supabase: SupabaseClient
): Promise<DuplicateKeyRow[]> {
  const rows: DuplicateKeyRow[] = [];
  // PostgREST có thể giới hạn số dòng trả về mỗi request (thường 1.000).
  // Dò trùng trên một lát đầu của bảng sẽ bỏ sót provider ở các trang sau.
  let lastId: string | null = null;
  for (;;) {
    let query = supabase
      .from(PROVIDER_TABLE)
      .select("id,doctors,facility,npi,street,zip_code")
      .eq("pending", false)
      .is("archived_at", null)
      .order("id")
      .limit(500);
    if (lastId) query = query.gt("id", lastId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as DuplicateKeyRow[];
    if (batch.length === 0) return rows;
    rows.push(...batch);
    lastId = batch[batch.length - 1].id;
  }
}

/** Toàn bộ dòng chờ duyệt, kể cả khi một lượt import chạm trần 2.000 dòng. */
export async function fetchBacklogProviderRows(
  supabase: SupabaseClient
): Promise<ProviderRow[]> {
  const rows: ProviderRow[] = [];
  let before: { created_at: string; id: string } | null = null;
  for (;;) {
    let query = supabase
      .from(PROVIDER_TABLE)
      .select(PROVIDER_SELECT)
      .eq("pending", true)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(500);
    if (before) {
      query = query.or(
        `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`
      );
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as unknown as ProviderRow[];
    if (batch.length === 0) return rows;
    rows.push(...batch);
    const last = batch[batch.length - 1];
    if (!last.created_at) throw new Error("Backlog row has no created_at timestamp.");
    before = { created_at: last.created_at, id: last.id };
  }
}
