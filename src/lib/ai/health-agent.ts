// Health, lượt 1: câu hỏi -> structured query, qua tool-use (ép đúng schema).
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

const BUILD_HEALTH_QUERY_TOOL: Anthropic.Tool = {
  name: "build_health_query",
  description: "Return the structured Health query for the agent's question.",
  input_schema: {
    type: "object",
    properties: {
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
  },
};

export type HealthAgentResult =
  | { ok: true; query: HealthStructuredQuery }
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
    tools: [BUILD_HEALTH_QUERY_TOOL],
    tool_choice: { type: "tool", name: "build_health_query" },
    messages: [...priorMessages, { role: "user", content: question }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) return { ok: false, reason: "no_tool_use" };

  const query = parseHealthStructuredQuery(toolUse.input);
  if (!query) return { ok: false, reason: "invalid_query" };

  return { ok: true, query };
}
