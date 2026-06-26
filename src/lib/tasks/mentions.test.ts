import { describe, expect, it } from "vitest";
import { parseMentions } from "@/lib/tasks/mentions";

describe("parseMentions", () => {
  it("extracts emails from @[Name](email) tokens", () => {
    const body = "hi @[Khang Nguyen](khang@x.com) and @[Bao](bao@x.com)";
    expect(parseMentions(body)).toEqual(["khang@x.com", "bao@x.com"]);
  });

  it("dedups repeated mentions", () => {
    const body = "@[A](a@x.com) ... @[A again](a@x.com)";
    expect(parseMentions(body)).toEqual(["a@x.com"]);
  });

  it("ignores plain @text and malformed tokens", () => {
    expect(parseMentions("hey @khang, see @[Bad](not-an-email)")).toEqual([]);
    expect(parseMentions("no mentions here")).toEqual([]);
  });
});
