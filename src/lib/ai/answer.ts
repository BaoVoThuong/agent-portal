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
      insights: {
        type: "array",
        description:
          "2-4 meaningful observations derived from the data (trends, cross-metric " +
          "comparisons, per-unit economics, standouts). Each adds interpretation, " +
          "not just a restated number. Empty array if the data is too thin.",
        items: { type: "string" },
      },
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

function buildPcResultEntry(query: PcStructuredQuery, result: PcAggregateResult) {
  return {
    label: query.label ?? null,
    appliedFilters: query.filters,
    metric: result.metric,
    groupBy: query.groupBy ?? null,
    total: result.total,
    policyCount: result.policyCount,
    rowCount: result.rowCount,
    groups: result.groups.slice(0, 25),
    sample: result.sample,
  };
}

/** Diễn đạt kết quả thành câu trả lời đã format sạch. Hỗ trợ multi-query so sánh. */
export async function composePcAnswer(
  question: string,
  queries: PcStructuredQuery[],
  results: PcAggregateResult[]
): Promise<FormattedAnswer> {
  const client = getAnthropic();

  const payload = JSON.stringify({
    question,
    results: queries.map((q, i) => buildPcResultEntry(q, results[i])),
  });

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: PC_ANSWER_SYSTEM_PROMPT,
    tools: [FORMAT_ANSWER_TOOL],
    tool_choice: { type: "tool", name: "format_answer" },
    messages: [{ role: "user", content: `Query result (JSON):\n${payload}` }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const raw: RawAnswer = (toolUse?.input as RawAnswer) ?? {};
  return formatAnswer(raw);
}

function buildHealthResultEntry(query: HealthStructuredQuery, result: HealthAggregateResult) {
  return {
    label: query.label ?? null,
    appliedFilters: query.filters,
    metric: result.metric,
    groupBy: query.groupBy ?? null,
    total: result.total,
    policyCount: result.policyCount,
    clientCount: result.clientCount,
    rowCount: result.rowCount,
    groups: result.groups.slice(0, 25),
    sample: result.sample,
  };
}

/** Diễn đạt kết quả Health thành câu trả lời đã format sạch. Hỗ trợ multi-query so sánh. */
export async function composeHealthAnswer(
  question: string,
  queries: HealthStructuredQuery[],
  results: HealthAggregateResult[]
): Promise<FormattedAnswer> {
  const client = getAnthropic();

  const payload = JSON.stringify({
    question,
    results: queries.map((q, i) => buildHealthResultEntry(q, results[i])),
  });

  const message = await client.messages.create({
    model: AI_MODEL,
    max_tokens: AI_MAX_TOKENS,
    system: HEALTH_ANSWER_SYSTEM_PROMPT,
    tools: [FORMAT_ANSWER_TOOL],
    tool_choice: { type: "tool", name: "format_answer" },
    messages: [{ role: "user", content: `Query result (JSON):\n${payload}` }],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  const raw: RawAnswer = (toolUse?.input as RawAnswer) ?? {};
  return formatAnswer(raw);
}
