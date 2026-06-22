import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { can, canAny } from "@/lib/rbac/client";
import { PERMISSIONS } from "@/lib/rbac/permissions";
import { normalizeAgentName } from "@/lib/agent-name";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generatePcQuery, type ChatHistoryTurn } from "@/lib/ai/pc-agent";
import {
  buildPcMartQuery,
  AI_QUERY_PAGE_SIZE,
  type PcTableSource,
  type PcQueryLike,
} from "@/lib/ai/pc-query-builder";
import { aggregatePcRows, type PcMartRow } from "@/lib/ai/pc-aggregate";
import { composePcAnswer, composeHealthAnswer } from "@/lib/ai/answer";
import { generateHealthQuery } from "@/lib/ai/health-agent";
import {
  buildHealthMartQuery,
  type HealthTableSource,
} from "@/lib/ai/health-query-builder";
import {
  aggregateHealthRows,
  type HealthMartRow,
} from "@/lib/ai/health-aggregate";

export const dynamic = "force-dynamic";

const MAX_QUESTION_LENGTH = 10000;

// Cấu hình theo từng mảng: permission agent/company tương ứng.
const CONTEXT_CONFIG = {
  pc: {
    agent: PERMISSIONS.AGENT_DASHBOARD_PC,
    company: PERMISSIONS.COMPANY_DASHBOARD_PC,
    label: "P&C",
  },
  health: {
    agent: PERMISSIONS.AGENT_DASHBOARD_HEALTH,
    company: PERMISSIONS.COMPANY_DASHBOARD_HEALTH,
    label: "Health",
  },
} as const;
type DashboardContext = keyof typeof CONTEXT_CONFIG;

function currentDate(): string {
  // Thời gian thực của server (YYYY-MM-DD) — nguồn duy nhất cho mốc tương đối.
  return new Date().toISOString().slice(0, 10);
}

// Bật log debug ra terminal bằng env AI_DEBUG=1. In structured query, số rows lấy
// về và kết quả aggregate để đối chiếu với dashboard khi số bị lệch.
const AI_DEBUG = process.env.AI_DEBUG === "1";
function debugLog(label: string, payload: unknown) {
  if (!AI_DEBUG) return;
  console.log(`\n[ai-chat] ${label}:\n${JSON.stringify(payload, null, 2)}`);
}

// Lấy TOÀN BỘ dòng bằng cách phân trang qua .range() (giống dashboard) — tránh bị
// PostgREST cap ~1000 dòng/request làm thiếu dữ liệu -> số bị nhỏ.
// buildQuery() dựng lại query mới cho mỗi trang (builder Supabase là mutable).
async function fetchAllRows<T>(buildQuery: () => PcQueryLike): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += AI_QUERY_PAGE_SIZE) {
    const page = buildQuery().range(from, from + AI_QUERY_PAGE_SIZE - 1);
    const { data, error } = await (page as unknown as Promise<{
      data: T[] | null;
      error: { message: string } | null;
    }>);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < AI_QUERY_PAGE_SIZE) break;
  }
  return rows;
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
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const context: DashboardContext | undefined =
    body?.context === "pc" || body?.context === "health" ? body.context : undefined;
  // Người dùng đang ở view nào: "agent" (chỉ data của mình) hay "company" (toàn cty).
  const scope = body?.scope === "company" ? "company" : "agent";
  const question =
    typeof body?.question === "string" ? body.question.trim() : "";
  const history = parseHistory(body?.history);

  if (!context) {
    return NextResponse.json(
      { error: "Unsupported dashboard." },
      { status: 400 }
    );
  }
  if (!question) {
    return NextResponse.json({ error: "Question is required." }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return NextResponse.json({ error: "Question is too long." }, { status: 400 });
  }

  const config = CONTEXT_CONFIG[context];
  const perms = session.user.permissions;

  // Phải có quyền xem dashboard tương ứng (agent hoặc company).
  if (!canAny(perms, [config.agent, config.company])) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Phạm vi quyền — khớp đúng cách dashboard hiển thị. KHÔNG tin scope từ client:
  // phải có đúng permission company mới được mở rộng ra toàn công ty.
  const canViewCompany = can(perms, config.company);
  const canViewAll = can(perms, PERMISSIONS.COMPANY_VIEW_ALL);
  if (scope === "company" && !canViewCompany) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const seesEveryone = (scope === "company" && canViewCompany) || canViewAll;
  const scopedAgent = seesEveryone
    ? null
    : normalizeAgentName(session.user.name ?? "");

  try {
    if (context === "pc") {
      return await handlePc(question, history, scopedAgent);
    }
    return await handleHealth(question, history, scopedAgent);
  } catch (err) {
    console.error("AI dashboard chat failed", err);
    return NextResponse.json(
      { error: "Something went wrong while answering. Please try again." },
      { status: 500 }
    );
  }
}

function unrelatedAnswer(label: string) {
  return NextResponse.json({
    answer: {
      headline: `That question doesn't look related to ${label} data, so I can't answer it here.`,
      stats: [],
    },
  });
}

// Trả true nếu LLM yêu cầu agent KHÁC với agent đang đăng nhập. Normalize cả hai
// (trim + uppercase) rồi kiểm tra không chứa nhau để chịu được tên rút gọn
// (vd "Ann" khớp "ANN STRAMBLER" → cho qua; "Khang" không khớp → block).
function isRequestingOtherAgent(
  filtersAgent: string | undefined,
  scopedAgent: string
): boolean {
  if (!filtersAgent) return false;
  const requested = normalizeAgentName(filtersAgent);
  if (!requested) return false;
  return !scopedAgent.includes(requested) && !requested.includes(scopedAgent);
}

function accessDeniedAnswer() {
  return NextResponse.json({
    answer: {
      headline: "You can only view your own data. Access to other agents' data is not permitted.",
      stats: [],
    },
  });
}
function couldNotParse(label: string) {
  return NextResponse.json({
    answer: {
      headline: `I couldn't turn that into a ${label} data query. Try asking about your policies, clients, or commission.`,
      stats: [],
    },
  });
}

async function handlePc(
  question: string,
  history: ChatHistoryTurn[],
  scopedAgentName: string | null
) {
  const generated = await generatePcQuery(question, currentDate(), history);
  if (!generated.ok) return couldNotParse("P&C");
  const { query } = generated;
  if (query.unsupported) return unrelatedAnswer("P&C policy");
  if (scopedAgentName !== null && isRequestingOtherAgent(query.filters.agent, scopedAgentName)) {
    return accessDeniedAnswer();
  }

  const supabase = getSupabaseAdmin() as unknown as PcTableSource;
  const data = await fetchAllRows<PcMartRow>(() =>
    buildPcMartQuery(supabase, query, scopedAgentName)
  );

  const aggregate = aggregatePcRows(data, query, new Date());
  debugLog("pc question", question);
  debugLog("pc structured query", query);
  debugLog("pc result", {
    rawRowsFromDb: data.length,
    rowCount: aggregate.rowCount,
    total: aggregate.total,
    policyCount: aggregate.policyCount,
    groups: aggregate.groups.slice(0, 10),
  });

  const answer = await composePcAnswer(question, query, aggregate);
  return NextResponse.json({ answer, rowCount: aggregate.rowCount });
}

async function handleHealth(
  question: string,
  history: ChatHistoryTurn[],
  scopedAgent: string | null
) {
  const generated = await generateHealthQuery(question, currentDate(), history);
  if (!generated.ok) return couldNotParse("Health");
  const { query } = generated;
  if (query.unsupported) return unrelatedAnswer("Health insurance");
  if (scopedAgent !== null && isRequestingOtherAgent(query.filters.agent, scopedAgent)) {
    return accessDeniedAnswer();
  }

  const supabase = getSupabaseAdmin() as unknown as HealthTableSource;
  const data = await fetchAllRows<HealthMartRow>(() =>
    buildHealthMartQuery(supabase, query, scopedAgent)
  );

  const aggregate = aggregateHealthRows(data, query);
  debugLog("health question", question);
  debugLog("health structured query", query);
  debugLog("health result", {
    rawRowsFromDb: data.length,
    eligibleRowCount: aggregate.rowCount,
    total: aggregate.total,
    policyCount: aggregate.policyCount,
    clientCount: aggregate.clientCount,
    groups: aggregate.groups.slice(0, 10),
  });

  const answer = await composeHealthAnswer(question, query, aggregate);
  return NextResponse.json({ answer, rowCount: aggregate.rowCount });
}
