import { describe, expect, it } from "vitest";
import { botSecretMatches } from "./bot-secret";

describe("botSecretMatches", () => {
  const secret = "s3cret-value-with-enough-length-1234";

  it("accepts the exact bearer secret", () => {
    expect(botSecretMatches(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects a wrong, missing or differently sized secret", () => {
    expect(botSecretMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(botSecretMatches("Bearer short", secret)).toBe(false);
    expect(botSecretMatches(null, secret)).toBe(false);
    expect(botSecretMatches(secret, secret)).toBe(false);
  });

  it("never matches when the server has no secret configured", () => {
    expect(botSecretMatches("Bearer ", "")).toBe(false);
    expect(botSecretMatches("Bearer anything", undefined)).toBe(false);
  });
});
