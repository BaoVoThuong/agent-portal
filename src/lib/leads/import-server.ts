import type { SupabaseClient } from "@supabase/supabase-js";
import { isUniqueViolation } from "@/lib/table-config/mutation-errors";
import type { ExistingLeadCandidate } from "./import-existing";
import type { ImportAccount } from "./import-template";
import type { MissingChoiceLabels } from "./import-custom-values";
import { LEAD_MAX_ROWS } from "./page-plan";

const CANDIDATE_PAGE_SIZE = 1000;
const CANDIDATE_COLUMNS =
  "id,display_number,full_name,phone,email,fub_link,assigned_to_email,event_id,lead_events(name)";

/**
 * Mọi lead chưa archive, chỉ các trường để dò khách cũ. Đọc theo trang như
 * fetchAllLeads; chạm trần LEAD_MAX_ROWS thì báo `truncated` để preview nói
 * ra, thay vì im lặng dò thiếu.
 */
export async function fetchImportCandidates(
  supabase: SupabaseClient,
): Promise<{ leads: ExistingLeadCandidate[]; truncated: boolean }> {
  const leads: ExistingLeadCandidate[] = [];
  for (let offset = 0; offset < LEAD_MAX_ROWS; offset += CANDIDATE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("leads")
      .select(CANDIDATE_COLUMNS)
      .is("archived_at", null)
      .order("id", { ascending: true })
      .range(offset, Math.min(offset + CANDIDATE_PAGE_SIZE, LEAD_MAX_ROWS) - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as unknown as (Omit<ExistingLeadCandidate, "event_name"> & {
      lead_events?: { name?: string | null } | null;
    })[];
    for (const { lead_events, ...lead } of page) {
      leads.push({ ...lead, event_name: lead_events?.name?.trim() || null });
    }
    if (page.length < CANDIDATE_PAGE_SIZE) return { leads, truncated: false };
  }
  return { leads, truncated: true };
}

/**
 * Mọi tài khoản đang hoạt động — rộng hơn danh sách có quyền Lead, để preview
 * phân biệt "không có tài khoản" với "có tài khoản nhưng chưa có quyền Lead".
 */
export async function fetchActiveAccounts(supabase: SupabaseClient): Promise<ImportAccount[]> {
  const { data, error } = await supabase
    .from("portal_account")
    .select("email,name")
    .eq("is_active", true);
  if (error) throw new Error(error.message);
  return ((data ?? []) as ImportAccount[]).map((account) => ({
    email: account.email.trim().toLowerCase(),
    name: account.name,
  }));
}

/**
 * Tạo các lựa chọn còn thiếu, qua cùng RPC màn hình Table Config dùng. Trùng
 * nhãn nghĩa là ai đó vừa tạo đúng nhãn ấy — kết quả vẫn là có, nên bỏ qua.
 */
export async function createMissingChoiceOptions(
  supabase: SupabaseClient,
  missing: MissingChoiceLabels,
): Promise<{ column: string; label: string }[]> {
  const created: { column: string; label: string }[] = [];
  for (const { column, labels } of missing) {
    for (const label of labels) {
      const { error } = await supabase.rpc("create_table_column_option", {
        p_column_id: column.id,
        p_label: label,
        p_color: null,
        p_position: null,
      });
      if (error) {
        if (isUniqueViolation(error)) continue;
        throw new Error(`Could not add "${label}" to ${column.label}: ${error.message}`);
      }
      created.push({ column: column.label, label });
    }
  }
  return created;
}
