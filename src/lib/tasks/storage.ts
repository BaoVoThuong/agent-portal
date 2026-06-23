import { getSupabaseAdmin } from "@/lib/supabase";

export const TASK_BUCKET = "task-attachments";

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.\-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

export function buildStoragePath(taskId: string, fileName: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `tasks/${taskId}/${uuid}-${sanitizeFileName(fileName)}`;
}

export async function uploadTaskFile(
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(TASK_BUCKET)
    .upload(path, data, { contentType, upsert: false });
  if (error) throw new Error(error.message);
}

export async function signTaskFile(path: string, expiresIn = 3600): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(TASK_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data) throw new Error(error?.message ?? "Could not sign file");
  return data.signedUrl;
}

export async function removeTaskFile(path: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(TASK_BUCKET).remove([path]);
  if (error) throw new Error(error.message);
}
