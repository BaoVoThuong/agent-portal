import { afterEach, describe, expect, it, vi } from "vitest";
import { etagFor, ifNoneMatchHits, jsonWithEtag } from "@/lib/http/json-etag";
import { fetchJsonWithEtag, type EtagSnapshot } from "@/lib/http/etag-fetch";

function get(headers: Record<string, string> = {}) {
  return new Request("https://portal.test/api/list", { headers });
}

describe("jsonWithEtag", () => {
  it("returns the JSON body with an ETag the first time", async () => {
    const response = jsonWithEtag(get(), { rows: [1, 2] });

    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe(etagFor(JSON.stringify({ rows: [1, 2] })));
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ rows: [1, 2] });
  });

  it("returns 304 with no body when the client already has this exact list", async () => {
    const etag = etagFor(JSON.stringify({ rows: [1, 2] }));
    const response = jsonWithEtag(get({ "If-None-Match": etag }), { rows: [1, 2] });

    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe(etag);
    expect(await response.text()).toBe("");
  });

  it("sends the full body again once the list changed", async () => {
    const stale = etagFor(JSON.stringify({ rows: [1, 2] }));
    const response = jsonWithEtag(get({ "If-None-Match": stale }), { rows: [1, 2, 3] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows: [1, 2, 3] });
  });
});

describe("ifNoneMatchHits", () => {
  const etag = '"abc"';

  it("matches the weak form a compressing CDN may hand back", () => {
    expect(ifNoneMatchHits('W/"abc"', etag)).toBe(true);
  });

  it("matches one tag out of a list", () => {
    expect(ifNoneMatchHits('"x", W/"abc"', etag)).toBe(true);
  });

  it("does not match a missing header, another tag, or a wildcard", () => {
    expect(ifNoneMatchHits(null, etag)).toBe(false);
    expect(ifNoneMatchHits('"abd"', etag)).toBe(false);
    expect(ifNoneMatchHits("*", etag)).toBe(false);
  });
});

describe("fetchJsonWithEtag", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(...responses: Response[]) {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => {
      const next = responses.shift();
      if (!next) throw new Error("unexpected fetch");
      return next;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function sentIfNoneMatch(fetchMock: ReturnType<typeof stubFetch>, call: number) {
    const init = fetchMock.mock.calls[call]?.[1];
    return new Headers(init?.headers).get("If-None-Match");
  }

  it("re-reads the saved body on 304, as a fresh 200 would", async () => {
    const fetchMock = stubFetch(
      new Response('{"rows":[1]}', { status: 200, headers: { ETag: 'W/"v1"' } }),
      new Response(null, { status: 304 }),
    );
    const slot: { current: EtagSnapshot | null } = { current: null };

    const first = await fetchJsonWithEtag("/api/list?reason=poll", "list", slot);
    const second = await fetchJsonWithEtag("/api/list?reason=focus", "list", slot);

    expect(sentIfNoneMatch(fetchMock, 0)).toBeNull();
    expect(sentIfNoneMatch(fetchMock, 1)).toBe('W/"v1"');
    expect(first).toEqual({ ok: true, status: 200, data: { rows: [1] } });
    expect(second).toEqual({ ok: true, status: 200, data: { rows: [1] } });
    // Mỗi lần là object mới, như response.json() trước đây.
    expect(second.data).not.toBe(first.data);
  });

  it("does not send a tag saved for another key", async () => {
    const fetchMock = stubFetch(
      new Response('{"rows":["aca"]}', { status: 200, headers: { ETag: '"aca"' } }),
      new Response('{"rows":["medicare"]}', { status: 200, headers: { ETag: '"mc"' } }),
    );
    const slot: { current: EtagSnapshot | null } = { current: null };

    await fetchJsonWithEtag("/api/list?program=aca", "aca", slot);
    const result = await fetchJsonWithEtag("/api/list?program=medicare", "medicare", slot);

    expect(sentIfNoneMatch(fetchMock, 1)).toBeNull();
    expect(result.data).toEqual({ rows: ["medicare"] });
    expect(slot.current?.key).toBe("medicare");
  });

  it("keeps the saved body when a request fails, and returns the error body", async () => {
    stubFetch(
      new Response('{"rows":[1]}', { status: 200, headers: { ETag: '"v1"' } }),
      new Response('{"error":"busy"}', { status: 503 }),
    );
    const slot: { current: EtagSnapshot | null } = { current: null };

    await fetchJsonWithEtag("/api/list", "list", slot);
    const failed = await fetchJsonWithEtag("/api/list", "list", slot);

    expect(failed).toEqual({ ok: false, status: 503, data: { error: "busy" } });
    expect(slot.current?.etag).toBe('"v1"');
  });

  it("returns null data for a non-JSON error body", async () => {
    stubFetch(new Response("<html>", { status: 502 }));
    const slot: { current: EtagSnapshot | null } = { current: null };

    expect(await fetchJsonWithEtag("/api/list", "list", slot)).toEqual({
      ok: false,
      status: 502,
      data: null,
    });
  });

  it("throws on a 200 that is not JSON, like response.json() did", async () => {
    stubFetch(new Response("<html>", { status: 200 }));
    const slot: { current: EtagSnapshot | null } = { current: null };

    await expect(fetchJsonWithEtag("/api/list", "list", slot)).rejects.toThrow();
    expect(slot.current).toBeNull();
  });

  it("treats a 304 with nothing saved as a failed read", async () => {
    stubFetch(new Response(null, { status: 304 }));
    const slot: { current: EtagSnapshot | null } = { current: null };

    expect(await fetchJsonWithEtag("/api/list", "list", slot)).toEqual({
      ok: false,
      status: 304,
      data: null,
    });
  });

  it("forgets the saved body when a 200 comes back without an ETag", async () => {
    stubFetch(
      new Response('{"rows":[1]}', { status: 200, headers: { ETag: '"v1"' } }),
      new Response('{"rows":[2]}', { status: 200 }),
    );
    const slot: { current: EtagSnapshot | null } = { current: null };

    await fetchJsonWithEtag("/api/list", "list", slot);
    await fetchJsonWithEtag("/api/list", "list", slot);

    expect(slot.current).toBeNull();
  });
});
