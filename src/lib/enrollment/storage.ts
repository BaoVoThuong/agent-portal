import {
  removeTaskFile,
  sanitizeFileName,
  signTaskFile,
  uploadTaskFile,
} from "@/lib/tasks/storage";

export { removeTaskFile, signTaskFile, uploadTaskFile };

export function buildEnrollmentStoragePath(recordId: string, fileName: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `enrollment/${recordId}/${uuid}-${sanitizeFileName(fileName)}`;
}

export async function uploadEnrollmentFile(
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<void> {
  await uploadTaskFile(path, data, contentType);
}

export async function signEnrollmentFile(path: string): Promise<string> {
  return signTaskFile(path);
}
