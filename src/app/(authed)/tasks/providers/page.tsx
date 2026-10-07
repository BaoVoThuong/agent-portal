import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import {
  canExportProviders,
  canImportProviders,
  canManageProviders,
} from "@/lib/providers/access";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";
import { RouteTiming } from "@/lib/server-timing";
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
  const [config, providersResult] = await Promise.all([
    timing.measure("columns", () =>
      fetchTableColumnsWithOptions("provider", supabase),
    ),
    timing.measure("provider_query", async () =>
      supabase
        .from(PROVIDER_TABLE)
        .select(PROVIDER_SELECT)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(5000),
    ),
  ]);
  timing.log(providersResult.error ? 500 : 200);

  return (
    <ProviderListClient
      initialProviders={(providersResult.data ?? []) as unknown as ProviderRow[]}
      loadError={providersResult.error?.message ?? null}
      columns={config.columns}
      columnOptions={config.options}
      // Tên chứ không phải email: cột Verified by đang chứa "Ngan Nguyen",
      // "Zoe Nguyen" — chen một địa chỉ email vào là cột đó có hai kiểu dữ liệu.
      // Cùng điều kiện với API (lib/providers/access.ts). Export và Import vẫn
      // là hai quyền TÁCH RIÊNG — kéo ra không có nghĩa là đẩy vào — nhưng quyền
      // Provider List - Manage mở cả hai cho riêng bảng này.
      canExport={canExportProviders(session.user.permissions)}
      canImport={canImportProviders(session.user.permissions)}
      // Thêm / xoá address.
      canManage={canManageProviders(session.user.permissions)}
      viewerName={personLabel(
        session.user.email ?? "",
        session.user.name ? new Map([[session.user.email ?? "", session.user.name]]) : undefined,
      )}
    />
  );
}
