import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  previous: [] as { uploadUrl: string }[],
  resumed: null as { uploadUrl: string } | null,
}));

vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_file: File, options: Record<string, unknown>) { mock.options = options; }
    findPreviousUploads() { return Promise.resolve(mock.previous); }
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
  mock.resumed = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
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
  it("sends 6 MiB chunks directly to Storage with only the signed token", async () => {
    await uploadFileWithTus(file, ticket);
    expect(mock.options).toMatchObject({
      endpoint: "https://project.storage.supabase.co/storage/v1/upload/resumable",
      headers: { "x-signature": "signed-token" },
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
});
