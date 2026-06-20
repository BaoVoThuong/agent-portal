// Lượt 1: câu hỏi của agent -> structured query, qua tool-use (ép đúng schema).
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

const BUILD_PC_QUERY_TOOL: Anthropic.Tool = {
  name: "build_pc_query",
  description: "Return the structured P&C query for the agent's question.",
  input_schema: {
    type: "object",
    properties: {
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
  },
};

export type PcAgentResult =
  | { ok: true; query: PcStructuredQuery }
  | { ok: false; reason: "no_tool_use" | "invalid_query" };

/** Một lượt hội thoại trước đó (để model hiểu câu hỏi nối tiếp). */
export type ChatHistoryTurn = { question: string; answer: string };

// Số lượt gần nhất tối đa đưa vào ngữ cảnh — đủ để hỏi nối tiếp, không phình token.
const MAX_HISTORY_TURNS = 5;

/**
 * Hỏi Claude để biến câu hỏi ngôn ngữ tự nhiên thành structured query.
 * @param currentDate "YYYY-MM-DD" thời gian thực server — model dùng để giải các
 *                    mốc tương đối ("this month", "this year"). KHÔNG để model tự đoán.
 * @param history     vài lượt hỏi-đáp gần nhất để hiểu câu hỏi nối tiếp ("thế còn CA?").
 *                    CHỈ dùng để hiểu ý — không ảnh hưởng phân quyền (server ép scope).
 */
export async function generatePcQuery(
  question: string,
  currentDate: string,
  history: ChatHistoryTurn[] = []
): Promise<PcAgentResult> {
  const client = getAnthropic();
  const currentMonth = currentDate.slice(0, 7);

  // Dựng messages: các lượt cũ (user hỏi / assistant tóm tắt) rồi tới câu hiện tại.
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
    tools: [BUILD_PC_QUERY_TOOL],
    tool_choice: { type: "tool", name: "build_pc_query" },
    messages: [...priorMessages, { role: "user", content: question }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) return { ok: false, reason: "no_tool_use" };

  const query = parsePcStructuredQuery(toolUse.input);
  if (!query) return { ok: false, reason: "invalid_query" };

  return { ok: true, query };
}
