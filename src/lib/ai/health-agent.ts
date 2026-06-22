// Health, lượt 1: câu hỏi -> một hoặc nhiều structured queries (tool-use).
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AI_MAX_TOKENS, getAnthropic } from "./client";
import { HEALTH_QUERY_SYSTEM_PROMPT, renderSystemPrompt } from "./prompts";
import {
  HEALTH_METRICS,
  HEALTH_GROUP_BY,
  HEALTH_PAID_FILTER,
  parseHealthStructuredQuery,
  type HealthStructuredQuery,
} from "./health-query-schema";
import type { ChatHistoryTurn } from "./pc-agent";

const SINGLE_QUERY_SCHEMA = {
  type: "object" as const,
  properties: {
    label: {
      type: "string",
      description:
        "Short label for this query when comparing multiple (e.g. 'Q1 2025', 'Aetna'). Omit for single queries.",
    },
    metric: { type: "string", enum: [...HEALTH_METRICS] },
    filters: {
      type: "object",
      properties: {
        monthStart: { type: "string", description: "YYYY-MM" },
        monthEnd: { type: "string", description: "YYYY-MM" },
        carrier: { type: "string" },
        state: { type: "string", description: "2-letter US state code" },
        agent: { type: "string" },
        plan: { type: "string" },
        memberName: {
          type: "string",
          description: "Member/customer name or id, partial match",
        },
        paid: { type: "string", enum: [...HEALTH_PAID_FILTER] },
      },
      additionalProperties: false,
    },
    groupBy: { type: "string", enum: [...HEALTH_GROUP_BY] },
    unsupported: { type: "boolean" },
  },
  required: ["metric", "filters"],
  additionalProperties: false,
};

const BUILD_HEALTH_QUERIES_TOOL: Anthropic.Tool = {
  name: "build_health_queries",
  description:
    "Return one or more structured Health queries. " +
    "Use ONE query for simple questions. " +
    "Use 2-4 queries ONLY when the question explicitly compares periods, carriers, or groups " +
    "(e.g. 'Q1 2025 vs Q1 2026', 'Aetna vs United', 'paid vs unpaid'). " +
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

export type HealthAgentResult =
  | { ok: true; queries: HealthStructuredQuery[] }
  | { ok: false; reason: "no_tool_use" | "invalid_query" };

const MAX_HISTORY_TURNS = 5;

export async function generateHealthQuery(
  question: string,
  currentDate: string,
  history: ChatHistoryTurn[] = []
): Promise<HealthAgentResult> {
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
    system: renderSystemPrompt(HEALTH_QUERY_SYSTEM_PROMPT, {
      currentDate,
      currentMonth,
    }),
    tools: [BUILD_HEALTH_QUERIES_TOOL],
    tool_choice: { type: "tool", name: "build_health_queries" },
    messages: [...priorMessages, { role: "user", content: question }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) return { ok: false, reason: "no_tool_use" };

  const input = toolUse.input as { queries?: unknown[] };
  const rawQueries = Array.isArray(input.queries) ? input.queries : [];
  const queries = rawQueries
    .map((q) => parseHealthStructuredQuery(q))
    .filter((q): q is HealthStructuredQuery => q !== null);
  if (queries.length === 0) return { ok: false, reason: "invalid_query" };

  return { ok: true, queries };
}
