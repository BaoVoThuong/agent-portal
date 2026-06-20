// Lượt 2: kết quả aggregate -> JSON cấu trúc (qua tool format_answer) -> formatAnswer.
import type Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, AI_MAX_TOKENS, getAnthropic } from "./client";
import { PC_ANSWER_SYSTEM_PROMPT, HEALTH_ANSWER_SYSTEM_PROMPT } from "./prompts";
import {
  formatAnswer,
  type FormattedAnswer,
  type RawAnswer,
} from "./format-answer";
import type { PcAggregateResult } from "./pc-aggregate";
import type { PcStructuredQuery } from "./pc-query-schema";
import type { HealthAggregateResult } from "./health-aggregate";
import type { HealthStructuredQuery } from "./health-query-schema";

const FORMAT_ANSWER_TOOL: Anthropic.Tool = {
  name: "format_answer",
  description: "Return the final structured answer for display.",
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string" },
      stats: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: {},
            format: { type: "string", enum: ["usd", "number", "percent", "text"] },
          },
          required: ["label", "value", "format"],
          additionalProperties: false,
        },
      },
    },
    required: ["headline", "stats"],
    additionalProperties: false,
  },
};

function buildResultPayload(
  question: string,
  query: PcStructuredQuery,
  result: PcAggregateResult
) {
  return JSON.stringify({
    question,
    appliedFilters: query.filters,
    metric: result.metric,
    groupBy: query.groupBy ?? null,
    total: result.total,
    // policyCount = số POLICY (unique) — dùng cái này khi nói "số policy".
    policyCount: result.policyCount,
    // rowCount = số dòng dữ liệu thô; KHÔNG phải số policy. Không hiển thị cho người dùng.
    rowCount: result.rowCount,
    groups: result.groups.slice(0, 25),
    sample: result.sample,
  });
}

/** Diễn đạt kết quả thành câu trả lời đã format sạch (không prose tự do). */
export async function composePcAnswer(
  question: string,
  query: PcStructuredQuery,
  result: PcAggregateResult
): Promise<FormattedAnswer> {
  const client = getAnthropic();

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: PC_ANSWER_SYSTEM_PROMPT,
    tools: [FORMAT_ANSWER_TOOL],
    tool_choice: { type: "tool", name: "format_answer" },
    messages: [
      {
        role: "user",
        content: `Query result (JSON):\n${buildResultPayload(question, query, result)}`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  // Dù LLM không gọi tool, vẫn render được câu trả lời an toàn từ con số đã có.
  const raw: RawAnswer = (toolUse?.input as RawAnswer) ?? {};
  return formatAnswer(raw);
}

function buildHealthResultPayload(
  question: string,
  query: HealthStructuredQuery,
  result: HealthAggregateResult
) {
  return JSON.stringify({
    question,
    appliedFilters: query.filters,
    metric: result.metric,
    groupBy: query.groupBy ?? null,
    total: result.total,
    policyCount: result.policyCount, // số POLICY (member) unique
    clientCount: result.clientCount, // số CLIENT (người được bảo hiểm)
    rowCount: result.rowCount, // số dòng thô — KHÔNG hiển thị
    groups: result.groups.slice(0, 25),
    sample: result.sample,
  });
}

/** Diễn đạt kết quả Health thành câu trả lời đã format sạch. */
export async function composeHealthAnswer(
  question: string,
  query: HealthStructuredQuery,
  result: HealthAggregateResult
): Promise<FormattedAnswer> {
  const client = getAnthropic();

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: HEALTH_ANSWER_SYSTEM_PROMPT,
    tools: [FORMAT_ANSWER_TOOL],
    tool_choice: { type: "tool", name: "format_answer" },
    messages: [
      {
        role: "user",
        content: `Query result (JSON):\n${buildHealthResultPayload(question, query, result)}`,
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const raw: RawAnswer = (toolUse?.input as RawAnswer) ?? {};
  return formatAnswer(raw);
}
