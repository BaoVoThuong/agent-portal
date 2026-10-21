import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => {
  const uploadToSignedUrl = vi.fn();
  const from = vi.fn(() => ({ uploadToSignedUrl }));
  return { uploadToSignedUrl, from, client: { storage: { from } } as unknown };
});
vi.mock("@/lib/supabase-browser", () => ({
  getBrowserSupabase: () => browser.client,
}));

import { recoverPendingAttachments, uploadAttachment } from "./upload-attachment";

const ENDPOINT = "/api/enrollment/r-1/attachments";
const REQUEST_ID = "3f2b8a1e-5c4d-4e6f-8a9b-0c1d2e3f4a5b";
const TICKET = {
  upload: {
    bucket: "task-attachments",
    path: `enrollment/r-1/${REQUEST_ID}-app.pdf`,
    token: "one-time",
    content_type: "application/pdf",
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "app.pdf", {
  type: "",
});
const fetchMock = vi.fn();

function sentBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

beforeEach(() => {
  fetchMock.mockReset();
  browser.uploadToSignedUrl.mockReset();
  browser.from.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("uploadAttachment", () => {
  it("prepares, PUTs the bytes to Storage with the route's type, then finalizes", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    browser.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });

    const response = await uploadAttachment(
      ENDPOINT,
      file,
      { commentId: "c-1", clientRequestId: REQUEST_ID },
      { "x-enrollment-client-source": "tab-1" },
    );

    expect(response.ok).toBe(true);
    expect(sentBodies()).toEqual([
      expect.objectContaining({ action: "prepare", file_name: "app.pdf", size: 5, comment_id: "c-1", client_request_id: REQUEST_ID }),
      expect.objectContaining({ action: "finalize", file_name: "app.pdf", size: 5, comment_id: "c-1", client_request_id: REQUEST_ID }),
    ]);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      "x-enrollment-client-source": "tab-1",
    });
    expect(browser.from).toHaveBeenCalledWith("task-attachments");
    const [path, token, bytes, options] = browser.uploadToSignedUrl.mock.calls[0];
    expect([path, token]).toEqual([TICKET.upload.path, "one-time"]);
    expect(bytes).toBeInstanceOf(ArrayBuffer);
    expect(options).toEqual({ contentType: "application/pdf" });
  });

  it("skips the upload when the route already recorded this request id", async () => {
    fetchMock.mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    const response = await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({ attachment: { id: "a-1" } });
    expect(browser.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finalizes when an earlier attempt already uploaded the object", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    browser.uploadToSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "The resource already exists", statusCode: "409" },
    });
    expect((await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID })).ok).toBe(true);
    expect(sentBodies().map((body) => body.action)).toEqual(["prepare", "finalize"]);
  });

  it("goes straight to finalize when the route says the object is already there", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ upload: { ...TICKET.upload, token: null, already_uploaded: true } }))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    expect((await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID })).ok).toBe(true);
    expect(browser.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(sentBodies().map((body) => body.action)).toEqual(["prepare", "finalize"]);
  });

  it("returns the Storage error without finalizing", async () => {
    fetchMock.mockResolvedValueOnce(json(TICKET));
    browser.uploadToSignedUrl.mockResolvedValue({
      data: null,
      error: { message: "Payload too large", status: 413, statusCode: "413" },
    });
    const response = await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("max 50MB");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("finalizes an object that Storage committed despite reporting a network error", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    browser.uploadToSignedUrl.mockRejectedValue(new Error("Failed to fetch"));

    const response = await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID });
    expect(response.ok).toBe(true);
    expect(sentBodies().map((body) => body.action)).toEqual(["prepare", "finalize"]);
  });

  it("returns the upload error when the object did not land", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ error: "The upload did not finish. Please try again." }, 400));
    browser.uploadToSignedUrl.mockRejectedValue(new Error("Network connection lost"));

    const response = await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("Network connection lost");
  });

  it("retries a transient finalize failure with the same request id", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ error: "Temporary failure" }, 500))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    browser.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });

    const response = await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID });
    expect(response.ok).toBe(true);
    expect(sentBodies().map((body) => body.action)).toEqual(["prepare", "finalize", "finalize"]);
    expect(new Set(sentBodies().map((body) => body.client_request_id))).toEqual(new Set([REQUEST_ID]));
  });

  it("recovers a completed PUT after the tab reloads", async () => {
    const values = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ error: "The upload did not finish. Please try again." }, 400))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    browser.uploadToSignedUrl.mockRejectedValue(new Error("Connection lost"));

    expect((await uploadAttachment(ENDPOINT, file, { commentId: "c-1", clientRequestId: REQUEST_ID })).ok).toBe(false);
    expect(await recoverPendingAttachments(ENDPOINT)).toBe(1);
    expect(await recoverPendingAttachments(ENDPOINT)).toBe(0);
    expect(sentBodies()[2]).toMatchObject({
      action: "finalize",
      comment_id: "c-1",
      client_request_id: REQUEST_ID,
    });
  });

  it("passes the route's refusal straight through", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "Forbidden" }, 403));
    const response = await uploadAttachment(ENDPOINT, file, { clientRequestId: REQUEST_ID });
    expect(response.status).toBe(403);
    expect(browser.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it("makes up a request id when the caller has none, and reuses it for finalize", async () => {
    fetchMock
      .mockResolvedValueOnce(json(TICKET))
      .mockResolvedValueOnce(json({ attachment: { id: "a-1" } }));
    browser.uploadToSignedUrl.mockResolvedValue({ data: {}, error: null });
    await uploadAttachment(ENDPOINT, file);
    const [prepare, finalize] = sentBodies();
    expect(prepare.client_request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(finalize.client_request_id).toBe(prepare.client_request_id);
  });
});
