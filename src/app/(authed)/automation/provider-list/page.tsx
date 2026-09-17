import type { Metadata } from "next";
import { requireAnyPermission } from "@/lib/rbac/server";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchTableColumnsWithOptions } from "@/lib/table-config/queries";
import { PROVIDER_SELECT, PROVIDER_TABLE, type ProviderRow } from "@/lib/providers/types";
import { ProviderListClient } from "./_components/ProviderListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Provider List" };

export default async function ProviderListPage() {
  // Dùng chung quyền với Provider Finder: cùng dữ liệu, cùng nhóm người dùng.
  await requireAnyPermission([PERMISSIONS.AUTOMATION_PROVIDER_FINDER]);

  const supabase = getSupabaseAdmin();
  // Nạp ngay trên server để màn hình không chớp trống một nhịp: 458 dòng là
  // một truy vấn duy nhất, rẻ hơn nhiều so với vòng gọi API sau khi mount.
  const [config, providersResult] = await Promise.all([
    fetchTableColumnsWithOptions("provider", supabase),
    supabase
      .from(PROVIDER_TABLE)
      .select(PROVIDER_SELECT)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  return (
    <ProviderListClient
      initialProviders={(providersResult.data ?? []) as unknown as ProviderRow[]}
      loadError={providersResult.error?.message ?? null}
      columns={config.columns}
      columnOptions={config.options}
    />
  );
}
