export const TASK_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  heic: "image/heic",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function formatAttachmentSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${bytes}B`;
}

export function attachmentTooLargeMessage(
  maxBytes = TASK_ATTACHMENT_MAX_BYTES
): string {
  return `File too large (max ${formatAttachmentSize(maxBytes)}).`;
}

export function inferAttachmentMimeType(
  fileName: string,
  browserType?: string
): string {
  if (browserType) return browserType;

  const extension = fileName.split(".").pop()?.toLowerCase();
  return extension ? MIME_BY_EXTENSION[extension] ?? "application/octet-stream" : "application/octet-stream";
}
