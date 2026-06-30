import { getSupabaseAdmin } from "@/lib/supabase";
import { TASK_ATTACHMENT_MAX_BYTES } from "./attachments";

export const TASK_BUCKET = "task-attachments";

let bucketSetupPromise: Promise<void> | null = null;

export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[^\w.\-]+/g, "_");
  return cleaned.length > 0 ? cleaned : "file";
}

export function buildStoragePath(taskId: string, fileName: string): string {
  const uuid = globalThis.crypto.randomUUID();
  return `tasks/${taskId}/${uuid}-${sanitizeFileName(fileName)}`;
}

function isAlreadyExistsError(error: { message?: string; statusCode?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.statusCode === "409" ||
    message.includes("already exists") ||
    message.includes("duplicate")
  );
}

async function configureTaskBucket(): Promise<void> {
  const supabase = getSupabaseAdmin();
  const options = {
    public: false,
    fileSizeLimit: TASK_ATTACHMENT_MAX_BYTES,
    allowedMimeTypes: null,
  };

  const { error: getError } = await supabase.storage.getBucket(TASK_BUCKET);
  if (getError) {
    const { error: createError } = await supabase.storage.createBucket(
      TASK_BUCKET,
      options
    );
    if (createError && !isAlreadyExistsError(createError)) {
      throw new Error(createError.message);
    }
  }

  const { error: updateError } = await supabase.storage.updateBucket(
    TASK_BUCKET,
    options
  );
  if (updateError) throw new Error(updateError.message);
}

async function ensureTaskBucket(): Promise<void> {
  bucketSetupPromise ??= configureTaskBucket().catch((error: unknown) => {
    bucketSetupPromise = null;
    throw error;
  });
  await bucketSetupPromise;
}

export async function uploadTaskFile(
  path: string,
  data: ArrayBuffer,
  contentType: string
): Promise<void> {
  await ensureTaskBucket();
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

export async function removeTaskFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(TASK_BUCKET).remove(paths);
  if (error) throw new Error(error.message);
}
