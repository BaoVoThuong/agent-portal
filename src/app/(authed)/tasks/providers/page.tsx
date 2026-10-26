import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  canAddProviders,
  canExportProviders,
  canImportProviders,
  canManageProviders,
  canReviewProviderBacklog,
} from "@/lib/providers/access";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";
import { RouteTiming } from "@/lib/server-timing";
import { fetchProviderDisplayPeople } from "@/lib/providers/collaboration";
import { fetchBacklogProviderRows } from "@/lib/providers/backlog-queries";
import { personLabel } from "@/lib/tasks/people";
import { ProviderListClient } from "./_components/ProviderListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Provider List" };

export default async function ProviderListPage() {
  const timing = new RouteTiming("provider-list-page");
  // Dùng chung quyền với Provider Finder: cùng dữ liệu, cùng nhóm người dùng.
  const session = await timing.measure("auth", () =>
    requireAnyPermission([PERMISSIONS.AUTOMATION_PROVIDER_FINDER]),
  );

  const supabase = getSupabaseAdmin();
  // Nạp ngay trên server để màn hình không chớp trống một nhịp: 458 dòng là
  // một truy vấn duy nhất, rẻ hơn nhiều so với vòng gọi API sau khi mount.
  const [config, providersResult, backlogResult, people] = await Promise.all([
    timing.measure("columns", () =>
      fetchTableColumnsWithOptions("provider", supabase),
    ),
    timing.measure("provider_query", async () =>
      supabase
        .from(PROVIDER_TABLE)
        .select(PROVIDER_SELECT)
        // Danh sách chỉ có dòng đã duyệt; dòng chờ duyệt nằm ở tab Backlog.
        .eq("pending", false)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(5000),
    ),
    timing.measure("backlog_query", () =>
      fetchBacklogProviderRows(supabase)
        .then((data) => ({ data, error: null as { message: string } | null }))
        .catch((error) => ({
          data: [] as ProviderRow[],
          error: {
            message: error instanceof Error ? error.message : "Could not load the Backlog.",
          },
        })),
    ),
    // Tên + avatar cho Opened by / Verified by trong form. Chỉ để hiển thị: tra
    // lỗi thì form về tên suy từ email, không làm hỏng cả trang.
    timing.measure("people", () => fetchProviderDisplayPeople().catch(() => [])),
  ]);
  const loadError = providersResult.error ?? backlogResult.error;
  timing.log(loadError ? 500 : 200);
  // Tra tên bằng một query chung nhưng chỉ gửi xuống trình duyệt những tài
  // khoản xuất hiện trong provider đang xem (và người đang mở trang).
  const loadedRows = [
    ...((providersResult.data ?? []) as unknown as ProviderRow[]),
    ...backlogResult.data,
  ];
  const referencedEmails = new Set(
    [session.user.email, ...loadedRows.flatMap((row) => [row.created_by_email, row.updated_by_email])]
      .filter((email): email is string => Boolean(email))
      .map((email) => email.trim().toLowerCase())
  );
  const referencedNames = new Set(
    loadedRows
      .map((row) => row.verified_by?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name))
  );
  const displayPeople = people.filter(
    (person) =>
      referencedEmails.has(person.email) ||
      (person.name && referencedNames.has(person.name.trim().toLowerCase()))
  );

  return (
    <ProviderListClient
      initialProviders={(providersResult.data ?? []) as unknown as ProviderRow[]}
      initialBacklog={(backlogResult.data ?? []) as unknown as ProviderRow[]}
      loadError={loadError?.message ?? null}
      columns={config.columns}
      columnOptions={config.options}
      // Tên chứ không phải email: cột Verified by đang chứa "Ngan Nguyen",
      // "Zoe Nguyen" — chen một địa chỉ email vào là cột đó có hai kiểu dữ liệu.
      // Cùng điều kiện với API (lib/providers/access.ts). Export và Import vẫn
      // là hai quyền TÁCH RIÊNG — kéo ra không có nghĩa là đẩy vào — nhưng quyền
      // Provider List - Manage mở cả hai cho riêng bảng này.
      canExport={canExportProviders(session.user.permissions)}
      canImport={canImportProviders(session.user.permissions)}
      // Xoá address; thêm / nhập thì ai cũng được, người không có Manage vào Backlog.
      canManage={canManageProviders(session.user.permissions)}
      canAdd={canAddProviders(session.user.permissions)}
      canReview={canReviewProviderBacklog(session.user.permissions)}
      currentEmail={(session.user.email ?? "").trim().toLowerCase()}
      people={displayPeople}
      viewerName={personLabel(
        session.user.email ?? "",
        session.user.name ? new Map([[session.user.email ?? "", session.user.name]]) : undefined,
      )}
    />
  );
}
