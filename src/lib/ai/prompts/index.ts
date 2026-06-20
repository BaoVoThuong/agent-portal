// Điểm gom mọi system prompt của tính năng AI dashboard chat.
// File logic chỉ import từ đây — không viết prompt thẳng trong logic.
export { PC_QUERY_SYSTEM_PROMPT } from "./pc-query.system";
export { PC_ANSWER_SYSTEM_PROMPT } from "./pc-answer.system";
export { HEALTH_QUERY_SYSTEM_PROMPT } from "./health-query.system";
export { HEALTH_ANSWER_SYSTEM_PROMPT } from "./health-answer.system";

// Chèn biến runtime (vd: tháng hiện tại) vào prompt theo cú pháp {{key}}.
export function renderSystemPrompt(
  template: string,
  vars: Record<string, string> = {}
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) =>
    key in vars ? vars[key] : match
  );
}
