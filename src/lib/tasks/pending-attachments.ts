import { checkOperationLimits, LIMITS, type LimitFailure } from "./attachment-limits";
import { ATTACHMENT_ALLOWED_EXTENSIONS } from "./attachments";

export type PendingFile = {
  key: string;
  name: string;
  size: number;
  file: File;
};

export type StagingFailure =
  | LimitFailure
  | { ok: false; limit: "type"; message: string };

export type AddPendingFilesResult =
  | { ok: true; files: PendingFile[] }
  | StagingFailure;

export const ATTACHMENT_ACCEPT_ATTRIBUTE = ATTACHMENT_ALLOWED_EXTENSIONS
  .map((extension) => `.${extension}`)
  .join(",");

function extensionOf(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export function addPendingFiles(
  existing: readonly PendingFile[],
  incoming: readonly File[]
): AddPendingFilesResult {
  const unsupported = incoming.find(
    (file) => !ATTACHMENT_ALLOWED_EXTENSIONS.includes(extensionOf(file.name))
  );
  if (unsupported) {
    return {
      ok: false,
      limit: "type",
      message: `Unsupported file type: ${unsupported.name}.`,
    };
  }

  const staged = incoming.map((file) => ({
    key: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    file,
  }));
  const files = [...existing, ...staged];
  const limits = checkOperationLimits({
    textLength: 0,
    sizes: files.map((file) => file.size),
  });
  if (!limits.ok && limits.limit === "count") {
    return { ...limits, message: `Too many files (max ${LIMITS.maxFiles}).` };
  }
  return limits.ok ? { ok: true, files } : limits;
}

export function removePendingFile(
  files: readonly PendingFile[],
  key: string
): PendingFile[] {
  return files.filter((file) => file.key !== key);
}

export type UploadResult = { name: string; ok: boolean };

export function summariseUploadResults(
  results: readonly UploadResult[]
): string | null {
  const failedNames = results.filter((result) => !result.ok).map((result) => result.name);
  if (failedNames.length === 0) return null;

  const noun = results.length === 1 ? "file" : "files";
  const tail = failedNames.length === 1 ? "it" : "them";
  return `The task was created, but ${failedNames.length} of ${results.length} ${noun} did not upload: ${failedNames.join(", ")}. Press Create again to retry ${tail}.`;
}
