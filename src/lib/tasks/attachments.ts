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

export const ATTACHMENT_ALLOWED_MIME_TYPES = [...new Set(Object.values(MIME_BY_EXTENSION))];

const EXTENSIONS_WITH_MAGIC_CHECK = new Set([
  "gif",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "webp",
  "xls",
  "xlsx",
]);

export type AttachmentValidationResult =
  | { ok: true; contentType: string }
  | { ok: false; error: string };

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

export function validateAttachmentFile(
  fileName: string,
  data: ArrayBuffer
): AttachmentValidationResult {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME_BY_EXTENSION[extension];
  if (!contentType) {
    return { ok: false, error: "Unsupported file type." };
  }
  if (EXTENSIONS_WITH_MAGIC_CHECK.has(extension) && !matchesExpectedSignature(extension, data)) {
    return { ok: false, error: "File contents do not match the file type." };
  }
  if ((extension === "txt" || extension === "csv") && looksLikeHtml(data)) {
    return { ok: false, error: "HTML files are not allowed." };
  }
  return { ok: true, contentType };
}

function matchesExpectedSignature(extension: string, data: ArrayBuffer): boolean {
  const bytes = new Uint8Array(data.slice(0, 16));
  switch (extension) {
    case "pdf":
      return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "png":
      return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpg":
    case "jpeg":
      return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a");
    case "webp":
      return startsWithAscii(bytes, "RIFF") && startsWithAscii(bytes.slice(8), "WEBP");
    case "xlsx":
      return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case "xls":
      return startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    default:
      return true;
  }
}

function startsWithBytes(bytes: Uint8Array, expected: number[]): boolean {
  if (bytes.length < expected.length) return false;
  return expected.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, expected: string): boolean {
  if (bytes.length < expected.length) return false;
  return [...expected].every((char, index) => bytes[index] === char.charCodeAt(0));
}

function looksLikeHtml(data: ArrayBuffer): boolean {
  const text = new TextDecoder()
    .decode(new Uint8Array(data.slice(0, 256)))
    .trim()
    .toLowerCase();
  return text.startsWith("<!doctype html") || text.startsWith("<html") || text.includes("<script");
}
