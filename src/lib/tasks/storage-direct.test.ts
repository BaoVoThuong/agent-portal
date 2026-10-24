import { beforeEach, describe, expect, it, vi } from "vitest";

const bucket = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  info: vi.fn(),
}));
const storageApi = vi.hoisted(() => ({
  from: vi.fn(() => bucket),
  getBucket: vi.fn(),
  updateBucket: vi.fn(),
  createBucket: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: () => ({ storage: storageApi }),
}));

import {
  buildStoragePath,
  createTaskUploadTicket,
  readTaskFileHead,
  readTaskFileInfo,
} from "./storage";
import { TASK_ATTACHMENT_MAX_BYTES } from "./attachments";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  for (const fn of [...Object.values(bucket), ...Object.values(storageApi)]) fn.mockClear();
  storageApi.getBucket.mockReset();
  storageApi.getBucket.mockResolvedValue({
    data: {
      file_size_limit: TASK_ATTACHMENT_MAX_BYTES,
      allowed_mime_types: [
        "text/csv", "image/gif", "image/heic", "image/jpeg", "application/pdf",
        "image/png", "text/plain", "image/webp", "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
    },
    error: null,
  });
});

describe("buildStoragePath", () => {
  it("uses the given object id, so finalize rebuilds the exact path", () => {
    expect(buildStoragePath("t-1", "Scan 1.pdf", "abc")).toBe("tasks/t-1/abc-Scan_1.pdf");
  });
});

describe("createTaskUploadTicket", () => {
  it("requires a preconfigured 50MB bucket and returns a one-time token", async () => {
    storageApi.getBucket.mockResolvedValue({
      data: {
        file_size_limit: TASK_ATTACHMENT_MAX_BYTES,
        allowed_mime_types: [
          "text/csv", "image/gif", "image/heic", "image/jpeg", "application/pdf",
          "image/png", "text/plain", "image/webp", "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
      }, error: null,
    });
    bucket.createSignedUploadUrl.mockResolvedValue({
      data: { path: "tasks/t-1/abc-a.pdf", token: "tok", signedUrl: "https://x" },
      error: null,
    });
    await expect(createTaskUploadTicket("tasks/t-1/abc-a.pdf")).resolves.toEqual({
      bucket: "task-attachments",
      path: "tasks/t-1/abc-a.pdf",
      token: "tok",
      alreadyUploaded: false,
    });
    expect(storageApi.updateBucket).not.toHaveBeenCalled();
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith("tasks/t-1/abc-a.pdf");
  });

  it("reports an object that is already there instead of failing", async () => {
    bucket.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: "The resource already exists", statusCode: "409" },
    });
    await expect(createTaskUploadTicket("tasks/t-1/abc-a.pdf")).resolves.toEqual({
      bucket: "task-attachments",
      path: "tasks/t-1/abc-a.pdf",
      token: null,
      alreadyUploaded: true,
    });
  });

  it("still fails on any other signing error", async () => {
    bucket.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: { message: "Bucket not found", statusCode: "404" },
    });
    await expect(createTaskUploadTicket("tasks/t-1/abc-a.pdf")).rejects.toThrow("Bucket not found");
  });

  it("rechecks a bucket downgraded after a successful ticket", async () => {
    bucket.createSignedUploadUrl.mockResolvedValue({
      data: { path: "tasks/t-1/abc-a.pdf", token: "tok" }, error: null,
    });
    await createTaskUploadTicket("tasks/t-1/abc-a.pdf");
    storageApi.getBucket.mockResolvedValue({
      data: { file_size_limit: 4 * 1024 * 1024, allowed_mime_types: ["application/pdf"] },
      error: null,
    });
    await expect(createTaskUploadTicket("tasks/t-1/next.pdf")).rejects.toThrow("not configured for 50MB");
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });
});

describe("readTaskFileInfo", () => {
  it("returns size and type, or null for a missing object", async () => {
    bucket.info.mockResolvedValueOnce({
      data: { size: 123, contentType: "application/pdf" },
      error: null,
    });
    await expect(readTaskFileInfo("p")).resolves.toEqual({ size: 123, contentType: "application/pdf" });

    bucket.info.mockResolvedValueOnce({
      data: null,
      error: { message: "Object not found", status: 400, statusCode: "404" },
    });
    await expect(readTaskFileInfo("p")).resolves.toBeNull();

    bucket.info.mockResolvedValueOnce({
      data: null,
      error: { message: "gateway timeout", status: 504, statusCode: "504" },
    });
    await expect(readTaskFileInfo("p")).rejects.toThrow("gateway timeout");
  });
});

describe("readTaskFileHead", () => {
  it("returns even when cancelling the body never settles (Next.js tees fetch bodies)", async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed" }, error: null });
    let served = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!served) controller.enqueue(new Uint8Array(512).fill(7));
        served = true;
      },
      // Mirrors a tee branch: cancel stays pending until the other branch is
      // cancelled, which never happens. Awaiting it hung every finalize.
      cancel: () => new Promise<void>(() => undefined),
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 206 }));
    const head = await Promise.race([
      readTaskFileHead("p", 512).then((buffer) => buffer.byteLength),
      new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ]);
    expect(head).toBe(512);
  });

  it("asks for a byte range and stops after it even if the whole file streams back", async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed" }, error: null });
    // Never ends: reading to the end would hang the test.
    let pulled = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(300).fill(pulled === 0 ? 1 : 2));
        pulled += 1;
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));

    const head = new Uint8Array(await readTaskFileHead("p", 512));

    expect(head.length).toBe(512);
    expect(head[0]).toBe(1);
    expect(head[511]).toBe(2);
    expect(cancelled).toBe(true);
    const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal;
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://signed",
      expect.objectContaining({ headers: { Range: "bytes=0-511" } }),
    );
  });

  it("returns what there is for a file shorter than the range", async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed" }, error: null });
    fetchMock.mockResolvedValue(new Response(new Uint8Array([0x25, 0x50]), { status: 206 }));
    expect(new Uint8Array(await readTaskFileHead("p"))).toEqual(new Uint8Array([0x25, 0x50]));
  });

  it("throws when Storage refuses", async () => {
    bucket.createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed" }, error: null });
    fetchMock.mockResolvedValue(new Response("nope", { status: 403 }));
    await expect(readTaskFileHead("p")).rejects.toThrow("403");
  });
});
