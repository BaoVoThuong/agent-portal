import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can, canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { normalizeAgentName } from "@/lib/agent-name";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generatePcQuery, type ChatHistoryTurn } from "@/lib/ai/pc-agent";
import { buildPcMartQuery, type PcTableSource } from "@/lib/ai/pc-query-builder";
import { aggregatePcRows, type PcMartRow } from "@/lib/ai/pc-aggregate";
import { composePcAnswer } from "@/lib/ai/answer";

export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 10000;

const PC_PERMISSIONS = [
  PERMISSIONS.AGENT_DASHBOARD_PC,
  PERMISSIONS.COMPANY_DASHBOARD_PC,
];

function currentDate(): string {
  // Thời gian thực của server (YYYY-MM-DD) — nguồn duy nhất cho mốc tương đối.
  return new Date().toISOString().slice(0, 10);
}

const MAX_HISTORY_TURNS = 5;
const MAX_HISTORY_TEXT = 10000;

// Chuẩn hoá lịch sử hội thoại từ client: chỉ giữ string, cắt độ dài, lấy vài lượt cuối.
// Lịch sử chỉ giúp HIỂU câu hỏi nối tiếp — không can thiệp phân quyền (server ép scope).
function parseHistory(raw: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatHistoryTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const question = typeof r.question === "string" ? r.question.trim() : "";
    const answer = typeof r.answer === "string" ? r.answer.trim() : "";
    if (!question || !answer) continue;
    turns.push({
      question: question.slice(0, MAX_HISTORY_TEXT),
      answer: answer.slice(0, MAX_HISTORY_TEXT),
    });
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;

  // Chỉ cho người có quyền xem dashboard P&C (agent hoặc company).
  if (!email || !canAny(session?.user?.permissions, PC_PERMISSIONS)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const context = body?.context;
  // Người dùng đang ở view nào: "agent" (chỉ data của mình) hay "company" (toàn cty).
  const scope = body?.scope === "company" ? "company" : "agent";
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";
  const history = parseHistory(body?.history);

  if (context !== "pc") {
    return NextResponse.json(
      { error: "Only the P&C dashboard is supported." },
      { status: 400 }
    );
  }
  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  // Phạm vi quyền — khớp đúng cách dashboard hiển thị:
  // - Company view: cần company_dashboard.pc -> thấy toàn công ty (scopedAgentName=null).
  // - Agent view: chỉ data của mình, trừ khi có company.view_all.
  // KHÔNG tin scope từ client: phải có đúng permission mới được mở rộng phạm vi.
  const canViewCompany = can(session.user.permissions, PERMISSIONS.COMPANY_DASHBOARD_PC);
  const canViewAll = can(session.user.permissions, PERMISSIONS.COMPANY_VIEW_ALL);

  if (scope === "company" && !canViewCompany) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const seesEveryone = (scope === "company" && canViewCompany) || canViewAll;
  const scopedAgentName = seesEveryone
    ? null
    : normalizeAgentName(session.user.name ?? "");

  try {
    const generated = await generatePcQuery(question, currentDate(), history);
    if (!generated.ok) {
      return NextResponse.json({
        answer: {
          headline:
            "I couldn't turn that into a P&C data query. Try asking about your policies, premium, or commission.",
          stats: [],
        },
      });
    }

    const { query } = generated;
    if (query.unsupported) {
      return NextResponse.json({
        answer: {
          headline:
            "That question doesn't look related to P&C policy data, so I can't answer it here.",
          stats: [],
        },
      });
    }

    const supabase = getSupabaseAdmin() as unknown as PcTableSource;
    const dbQuery = buildPcMartQuery(supabase, query, scopedAgentName);
    const { data, error } = await (dbQuery as unknown as Promise<{
      data: PcMartRow[] | null;
      error: { message: string } | null;
    }>);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const aggregate = aggregatePcRows(data ?? [], query, new Date());
    const answer = await composePcAnswer(question, query, aggregate);

    return NextResponse.json({ answer, rowCount: aggregate.rowCount });
  } catch (err) {
    console.error("AI dashboard chat failed", err);
    return NextResponse.json(
      { error: "Something went wrong while answering. Please try again." },
      { status: 500 }
    );
  }
}
