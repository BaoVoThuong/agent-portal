import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "./client";

/**
 * Người dùng chốt Sonnet 5 cho việc này (2026-09-02). Tách khỏi `AI_MODEL` của
 * dashboard chat: đổi hằng kia là đổi hành vi của một tính năng khác.
 */
const IMPORT_MAPPING_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
/**
 * Người dùng chốt 10 dòng. Đủ để nhìn ra hình dạng dữ liệu mà không thổi prompt
 * lên vô hạn với file 2.000 dòng.
 */
export const SAMPLE_ROW_LIMIT = 10;
/** Ô quá dài (ghi chú dài dòng) không giúp đoán cột, chỉ tốn token. */
const MAX_CELL_LENGTH = 120;

export type MappingSuggestionInput = {
  headers: readonly string[];
  sampleRows: readonly Record<string, unknown>[];
  targets: readonly { key: string; label: string; required: boolean }[];
};

function trimCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text;
}

/**
 * Hỏi model xem cột nào trong file nên đổ vào trường nào.
 *
 * Trả về JSON **thô**. Người gọi PHẢI cho qua `sanitizeSuggestedMapping` trước
 * khi dùng — model có thể bịa tên cột, trả khoá lạ, hoặc map hai trường vào
 * cùng một nguồn.
 */
export async function suggestImportMapping(
  input: MappingSuggestionInput
): Promise<unknown> {
  const rows = input.sampleRows.slice(0, SAMPLE_ROW_LIMIT).map((record) => {
    const out: Record<string, string> = {};
    for (const header of input.headers) out[header] = trimCell(record[header]);
    return out;
  });

  const prompt = [
    "You map spreadsheet columns onto the fields of a CRM lead import.",
    "",
    "TARGET FIELDS (map into these; use the exact key):",
    ...input.targets.map(
      (t) => `- ${t.key}: "${t.label}"${t.required ? " (required)" : ""}`
    ),
    "",
    "SPREADSHEET HEADERS:",
    JSON.stringify(input.headers),
    "",
    `FIRST ${rows.length} DATA ROWS:`,
    JSON.stringify(rows, null, 2),
    "",
    "Rules:",
    "- Reply with ONLY a JSON object, no prose and no code fence.",
    "- Keys are target field keys; values are the EXACT header string.",
    "- Omit a field entirely when no column fits. Do not guess.",
    "- Never use the same header for two fields.",
    '- Judge by the DATA, not only the header text: a column named "Column3"',
    '  holding "(714) 555-0123" is the phone column.',
  ].join("\n");

  const response = await getAnthropic().messages.create({
    model: IMPORT_MAPPING_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  // Model đôi khi bọc trong ```json dù đã dặn. Lấy object đầu tiên tìm được thay
  // vì bắt nó phải đúng tuyệt đối — đây là chỗ rẻ để tha thứ.
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
