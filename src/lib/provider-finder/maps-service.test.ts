import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMapsService } from "./maps-service";

const EXEC_URL = "https://script.google.com/macros/s/deployment-id/exec";
const geocodeJson = JSON.stringify({
  ok: true,
  results: [{ id: "a", location: { lat: 29.8, lng: -95.1 } }],
});

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

describe("Apps Script maps proxy redirects", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("APPS_SCRIPT_MAPS_WEBAPP_URL", EXEC_URL);
    vi.stubEnv("APPS_SCRIPT_MAPS_SECRET", "test-secret");
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  async function geocode() {
    const logs: string[] = [];
    const result = await getMapsService(logs).geocodeCandidates([{ id: "a", address: "77049" }], logs);
    return result.get("a");
  }

  it("reads a ContentService result from the echo URL with GET", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("https://script.googleusercontent.com/macros/echo?user_content_key=k"))
      .mockResolvedValueOnce(new Response(geocodeJson, { status: 200 }));

    expect(await geocode()).toEqual({ lat: 29.8, lng: -95.1 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "GET" });
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty("body");
  });

  it("re-sends the POST when Google hops to another exec URL", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("https://script.google.com/macros/u/0/s/deployment-id/exec"))
      .mockResolvedValueOnce(new Response(geocodeJson, { status: 200 }));

    expect(await geocode()).toEqual({ lat: 29.8, lng: -95.1 });
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).toMatchObject({
      action: "geocode",
      secret: "test-secret",
    });
  });

  it("refuses a redirect that leaves Google", async () => {
    fetchMock.mockResolvedValueOnce(redirect("https://example.com/steal"));
    await expect(geocode()).rejects.toThrow("not a Google HTTPS URL");
  });
});
