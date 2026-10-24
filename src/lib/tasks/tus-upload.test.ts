import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  previous: [] as { uploadUrl: string }[],
  previousError: false,
  resumed: null as { uploadUrl: string } | null,
}));

vi.mock("tus-js-client", () => ({
  Upload: class {
    options: Record<string, unknown>;
    constructor(_file: File, options: Record<string, unknown>) {
      this.options = options;
      mock.options = options;
    }
    findPreviousUploads() {
      return mock.previousError ? Promise.reject(new Error("URL storage unavailable")) : Promise.resolve(mock.previous);
    }
    resumeFromPreviousUpload(previous: { uploadUrl: string }) { mock.resumed = previous; }
    start() {
      (mock.options?.onProgress as ((uploaded: number, total: number) => void) | undefined)?.(5, 10);
      (mock.options?.onSuccess as () => void)();
    }
  },
}));

import { uploadFileWithTus } from "./tus-upload";

beforeEach(() => {
  mock.options = null;
  mock.previous = [];
  mock.previousError = false;
  mock.resumed = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
});
afterEach(() => vi.unstubAllEnvs());

const ticket = {
  bucket: "task-attachments",
  path: "tasks/t-1/request-1-photo.png",
  token: "signed-token",
  contentType: "image/png",
};
const file = new File(["image"], "photo.png", { type: "" });

describe("Supabase resumable upload", () => {
  it("sends 6 MiB chunks directly to Storage with the public key and signed token", async () => {
    await uploadFileWithTus(file, ticket);
    expect(mock.options).toMatchObject({
      endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable/sign",
      headers: { apikey: "public-anon-key", "x-signature": "signed-token" },
      metadata: {
        bucketName: "task-attachments",
        objectName: ticket.path,
        contentType: "image/png",
      },
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
    });
  });

  it("resumes the same path and keeps different comments separate", async () => {
    mock.previous = [{ uploadUrl: "https://previous" }];
    await uploadFileWithTus(file, ticket);
    expect(mock.resumed).toEqual(mock.previous[0]);
    const fingerprint = mock.options?.fingerprint as () => Promise<string>;
    const first = await fingerprint();
    await uploadFileWithTus(file, { ...ticket, path: "tasks/t-1/another-comment-photo.png" });
    expect(await (mock.options?.fingerprint as () => Promise<string>)()).not.toBe(first);
  });

  it("reports byte progress before confirmation", async () => {
    const progress = vi.fn();
    await uploadFileWithTus(file, ticket, progress);
    expect(progress).toHaveBeenCalledWith(5, 10);
  });

  it("still uploads when browser resume storage is unavailable", async () => {
    mock.previousError = true;
    await expect(uploadFileWithTus(file, ticket)).resolves.toBeUndefined();
    expect(mock.options?.storeFingerprintForResuming).toBe(false);
  });

  it("reports missing public gateway key before attempting upload", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    await expect(uploadFileWithTus(file, ticket)).rejects.toThrow("not configured");
    expect(mock.options).toBeNull();
  });
});
