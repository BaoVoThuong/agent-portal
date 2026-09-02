import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { sanitizeSuggestedMapping } from "@/lib/leads/import-mapping";
import { buildLeadImportTargets } from "@/lib/leads/import-targets";
import { SAMPLE_ROW_LIMIT, suggestImportMapping } from "@/lib/ai/import-mapping-agent";
import { fetchTableColumns } from "@/lib/table-config/queries";

export const dynamic = "force-dynamic";

/** Cùng cổng quyền với chính việc import: gợi ý mapping là một bước của nó. */
export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    headers?: unknown;
    sampleRows?: unknown;
  } | null;
  const headers = Array.isArray(body?.headers)
    ? body.headers.filter((header): header is string => typeof header === "string")
    : [];
  const sampleRows = Array.isArray(body?.sampleRows)
    ? (body.sampleRows.filter(
        (row) => row && typeof row === "object" && !Array.isArray(row)
      ) as Record<string, unknown>[])
    : [];
  if (headers.length === 0) {
    return NextResponse.json({ error: "No columns to map." }, { status: 400 });
  }

  // Cột đích dựng ở SERVER từ Table Config, không nhận từ client: client có thể
  // gửi một danh sách bịa, và model sẽ ngoan ngoãn map vào đó.
  const targets = buildLeadImportTargets(await fetchTableColumns("lead"));

  try {
    const raw = await suggestImportMapping({
      headers,
      sampleRows: sampleRows.slice(0, SAMPLE_ROW_LIMIT),
      targets,
    });
    // Làm sạch ở server chứ không ở client: client tin gì thì tin, nhưng thứ
    // rời khỏi route này phải đã đúng.
    return NextResponse.json({
      mapping: sanitizeSuggestedMapping(raw, headers, targets),
    });
  } catch (error) {
    // Gợi ý hỏng KHÔNG được làm hỏng việc import. Trả mapping rỗng kèm lời giải
    // thích; màn hình rơi về phần đoán theo tên và người dùng vẫn map tay được.
    console.error("Lead import mapping suggestion failed", error);
    return NextResponse.json({
      mapping: {},
      error: "Could not suggest a mapping. Map the columns manually.",
    });
  }
}
