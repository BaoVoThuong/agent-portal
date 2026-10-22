import {
  removeTaskFile,
  sanitizeFileName,
  signTaskFile,
  uploadTaskFile,
} from "@/lib/tasks/storage";

export { removeTaskFile, signTaskFile, uploadTaskFile };

/** `objectId`: see buildStoragePath in lib/tasks/storage.ts. */
export function buildEnrollmentStoragePath(
  recordId: string,
  fileName: string,
  objectId: string = globalThis.crypto.randomUUID(),
): string {
  return `enrollment/${recordId}/${objectId}-${sanitizeFileName(fileName)}`;
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
