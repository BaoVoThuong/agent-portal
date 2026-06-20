// Render câu trả lời cuối từ JSON cấu trúc của LLM.
// Mục tiêu: KHÔNG lấy thẳng văn phong LLM — code kiểm soát 100% format, và strip
// mọi ký tự markdown để không bao giờ lọt **ABC** / bullet lộn xộn ra UI.

export type AnswerStatFormat = "usd" | "number" | "percent" | "text";

export type AnswerStat = {
  label: string;
  value: string | number;
  format: AnswerStatFormat;
};

/** JSON thô do LLM trả về (qua tool format_answer). */
export type RawAnswer = {
  headline?: unknown;
  stats?: unknown;
};

/** Kết quả đã làm sạch + format, an toàn để hiển thị. */
export type FormattedAnswer = {
  headline: string;
  stats: { label: string; value: string }[];
};

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const plainNumber = new Intl.NumberFormat("en-US");
const percentNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

// Bỏ các ký tự định dạng markdown phổ biến; gộp khoảng trắng thừa.
export function stripMarkdown(input: string): string {
  return input
    .replace(/[*_`~#>]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
    .replace(/\s+/g, " ")
    .trim();
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? stripMarkdown(value) : fallback;
}

function asFormat(value: unknown): AnswerStatFormat {
  return value === "usd" || value === "number" || value === "percent"
    ? value
    : "text";
}

function formatStatValue(value: unknown, format: AnswerStatFormat): string {
  if (format === "usd" || format === "number" || format === "percent") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n)) {
      if (format === "usd") return usd.format(n);
      if (format === "percent") return `${percentNumber.format(n)}%`;
      return plainNumber.format(n);
    }
  }
  return asText(value);
}

export function formatAnswer(raw: RawAnswer): FormattedAnswer {
  const headline =
    asText(raw.headline) || "No answer was produced for this question.";

  const statsInput = Array.isArray(raw.stats) ? raw.stats : [];
  const stats = statsInput
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const s = item as Record<string, unknown>;
      const label = asText(s.label);
      if (!label) return null;
      return { label, value: formatStatValue(s.value, asFormat(s.format)) };
    })
    .filter((s): s is { label: string; value: string } => s !== null);

  return { headline, stats };
}
