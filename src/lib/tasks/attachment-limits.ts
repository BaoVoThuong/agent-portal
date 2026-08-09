import {
  formatAttachmentSize,
  TASK_ATTACHMENT_MAX_BYTES,
} from "./attachments";

export const LIMITS = {
  maxTextLength: 10_000,
  maxFiles: 10,
  maxAggregateBytes: 50 * 1024 * 1024,
} as const;

export type LimitFailure = {
  ok: false;
  limit: "text" | "count" | "aggregate" | "per_file";
  message: string;
};

function aggregateSizeMessage() {
  return formatAttachmentSize(LIMITS.maxAggregateBytes).replace(".0MB", "MB");
}

/**
 * Check limits in deterministic order. Aggregate is checked before count and
 * per-file because ten maximum-size files can exceed the aggregate by 3x.
 */
export function checkOperationLimits(input: {
  textLength: number;
  sizes: readonly number[];
}): { ok: true } | LimitFailure {
  if (input.textLength > LIMITS.maxTextLength) {
    return {
      ok: false,
      limit: "text",
      message: `Comment is too long (max ${LIMITS.maxTextLength.toLocaleString()} characters).`,
    };
  }
  const total = input.sizes.reduce((sum, size) => sum + Math.max(0, size), 0);
  if (total > LIMITS.maxAggregateBytes) {
    return {
      ok: false,
      limit: "aggregate",
      message: `Attachments are too large in total (max ${aggregateSizeMessage()}).`,
    };
  }
  if (input.sizes.length > LIMITS.maxFiles) {
    return {
      ok: false,
      limit: "count",
      message: `Too many files (max ${LIMITS.maxFiles} per comment).`,
    };
  }
  if (input.sizes.some((size) => size > TASK_ATTACHMENT_MAX_BYTES)) {
    return {
      ok: false,
      limit: "per_file",
      message: `File too large (max ${formatAttachmentSize(TASK_ATTACHMENT_MAX_BYTES)}).`,
    };
  }
  return { ok: true };
}
