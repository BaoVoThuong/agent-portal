const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

export type WorkbookUploadLimits = {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export const WORKBOOK_UPLOAD_LIMITS: WorkbookUploadLimits = {
  maxFiles: 10,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
} as const;

const MIME_BY_EXTENSION = {
  ".xlsx": XLSX_MIME,
  ".xls": XLS_MIME,
} as const;

export type WorkbookUploadValidation =
  | { ok: true }
  | { ok: false; status: 400 | 413; error: string };

export function validateWorkbookUploads(
  files: File[],
  limits: WorkbookUploadLimits = WORKBOOK_UPLOAD_LIMITS
): WorkbookUploadValidation {
  if (files.length === 0) {
    return { ok: false, status: 400, error: "At least one workbook file is required" };
  }
  if (files.length > limits.maxFiles) {
    return {
      ok: false,
      status: 400,
      error: `A maximum of ${limits.maxFiles} workbook files can be uploaded at once`,
    };
  }

  let totalBytes = 0;
  for (const file of files) {
    const name = file.name.trim().toLowerCase();
    const extension = name.endsWith(".xlsx")
      ? ".xlsx"
      : name.endsWith(".xls")
        ? ".xls"
        : null;
    if (!extension) {
      return {
        ok: false,
        status: 400,
        error: "Only .xls and .xlsx workbook files are accepted",
      };
    }
    if (file.type && file.type !== MIME_BY_EXTENSION[extension]) {
      return {
        ok: false,
        status: 400,
        error: `The MIME type for ${file.name || "the workbook"} does not match its extension`,
      };
    }
    if (!Number.isFinite(file.size) || file.size < 0) {
      return { ok: false, status: 400, error: "Workbook size is invalid" };
    }
    if (file.size > limits.maxFileBytes) {
      return {
        ok: false,
        status: 413,
        error: `Each workbook must be ${Math.floor(limits.maxFileBytes / (1024 * 1024))} MB or smaller`,
      };
    }
    totalBytes += file.size;
    if (totalBytes > limits.maxTotalBytes) {
      return {
        ok: false,
        status: 413,
        error: `The combined workbook size must be ${Math.floor(limits.maxTotalBytes / (1024 * 1024))} MB or smaller`,
      };
    }
  }
  return { ok: true };
}

export async function parseWorkbooksSequentially<T>(
  files: File[],
  parse: (file: File, index: number) => Promise<T>
): Promise<T[]> {
  const parsed: T[] = [];
  for (const [index, file] of files.entries()) parsed.push(await parse(file, index));
  return parsed;
}
