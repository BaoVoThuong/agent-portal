import type { Metadata } from "next";
import { hasGrant } from "@/lib/authz/grants";
import { requirePageAnyGrant } from "@/lib/authz/page-guards";
import {
  canActorExport,
  canActorImport,
} from "@/lib/table-config/export-access";
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
  const { session, principal } = await timing.measure("auth", () =>
    requirePageAnyGrant(["provider.read"]),
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
      // Cùng điều kiện với API. Hai quyền TÁCH RIÊNG: Export chỉ đọc, Import
      // ghi đè hàng loạt — cho quyền kéo ra không có nghĩa là cho quyền đẩy vào.
      canExport={canActorExport(principal.grants, "provider")}
      canImport={
        canActorImport(principal.grants, "provider") &&
        hasGrant(principal.grants, "provider.update")
      }
      viewerName={personLabel(
        session.user.email ?? "",
        session.user.name ? new Map([[session.user.email ?? "", session.user.name]]) : undefined,
      )}
    />
  );
}
