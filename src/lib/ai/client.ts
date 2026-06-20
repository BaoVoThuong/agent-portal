import Anthropic from "@anthropic-ai/sdk";

// Model + cấu hình dùng chung cho tính năng AI dashboard chat.
// Sonnet 4.6 với extended thinking mức "medium" (budget vừa phải).
export const AI_MODEL = "claude-sonnet-4-6";
export const AI_MAX_TOKENS = 1024;
export const AI_THINKING_BUDGET = 2048; // ~ "medium"

let cached: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (cached) return cached;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }
  cached = new Anthropic({ apiKey });
  return cached;
}
