// Lượt 1: câu hỏi của agent -> một hoặc nhiều structured queries (tool-use).
// Cho phép tối đa 4 queries để xử lý câu hỏi so sánh (vd Q1 2025 vs Q1 2026).
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AI_MAX_TOKENS, getAnthropic } from "./client";
import { PC_QUERY_SYSTEM_PROMPT, renderSystemPrompt } from "./prompts";
import {
  PC_METRICS,
  PC_GROUP_BY,
  PC_POLICY_SCOPE,
  PC_PAID_FILTER,
  parsePcStructuredQuery,
  type PcStructuredQuery,
} from "./pc-query-schema";

const SINGLE_QUERY_SCHEMA = {
  type: "object" as const,
  properties: {
    label: {
      type: "string",
      description:
        "Short label for this query when comparing multiple (e.g. 'Q1 2025', 'FIONA'). Omit for single queries.",
    },
    metric: { type: "string", enum: [...PC_METRICS] },
    filters: {
      type: "object",
      properties: {
        monthStart: { type: "string", description: "YYYY-MM" },
        monthEnd: { type: "string", description: "YYYY-MM" },
        type: { type: "string" },
        company: { type: "string" },
        agency: { type: "string" },
        state: { type: "string", description: "2-letter US state code" },
        city: { type: "string" },
        agent: {
          type: "string",
          description: "Agent (salesperson) name, for that agent's book",
        },
        insuredName: {
          type: "string",
          description: "Insured/customer name, partial match",
        },
        policyScope: { type: "string", enum: [...PC_POLICY_SCOPE] },
        paid: { type: "string", enum: [...PC_PAID_FILTER] },
      },
      additionalProperties: false,
    },
    groupBy: { type: "string", enum: [...PC_GROUP_BY] },
    unsupported: { type: "boolean" },
  },
  required: ["metric", "filters"],
  additionalProperties: false,
};

const BUILD_PC_QUERIES_TOOL: Anthropic.Tool = {
  name: "build_pc_queries",
  description:
    "Return one or more structured P&C queries. " +
    "Use ONE query for simple questions. " +
    "Use 2-4 queries ONLY when the question explicitly compares periods, agents, or groups " +
    "(e.g. 'Q1 2025 vs Q1 2026', 'FIONA vs NAM', 'active vs renewal'). " +
    "Each query must be fully self-contained with its own filters. " +
    "Give each query a short 'label' when using multiple.",
  input_schema: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        description:
          "List of queries. Length 1 for simple questions, 2-4 for comparisons.",
        maxItems: 4,
        items: SINGLE_QUERY_SCHEMA,
      },
    },
    required: ["queries"],
    additionalProperties: false,
  },
};

export type PcAgentResult =
  | { ok: true; queries: PcStructuredQuery[] }
  | { ok: false; reason: "no_tool_use" | "invalid_query" };

/** Một lượt hội thoại trước đó (để model hiểu câu hỏi nối tiếp). */
export type ChatHistoryTurn = { question: string; answer: string };

const MAX_HISTORY_TURNS = 5;

export async function generatePcQuery(
  question: string,
  currentDate: string,
  history: ChatHistoryTurn[] = []
): Promise<PcAgentResult> {
  const client = getAnthropic();
  const currentMonth = currentDate.slice(0, 7);

  const recent = history.slice(-MAX_HISTORY_TURNS);
  const priorMessages: Anthropic.MessageParam[] = recent.flatMap((turn) => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer },
  ]);

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: renderSystemPrompt(PC_QUERY_SYSTEM_PROMPT, {
      currentDate,
      currentMonth,
    }),
    tools: [BUILD_PC_QUERIES_TOOL],
    tool_choice: { type: "tool", name: "build_pc_queries" },
    messages: [...priorMessages, { role: "user", content: question }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) return { ok: false, reason: "no_tool_use" };

  const input = toolUse.input as { queries?: unknown[] };
  const rawQueries = Array.isArray(input.queries) ? input.queries : [];
  const queries = rawQueries
    .map((q) => parsePcStructuredQuery(q))
    .filter((q): q is PcStructuredQuery => q !== null);
  if (queries.length === 0) return { ok: false, reason: "invalid_query" };

  return { ok: true, queries };
}
