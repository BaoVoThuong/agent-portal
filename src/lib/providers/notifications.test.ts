import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ getSupabaseAdmin: vi.fn() }));
vi.mock("@/lib/tasks/realtime", () => ({ broadcastNotif: vi.fn() }));
vi.mock("./collaboration", () => ({ fetchProviderViewers: vi.fn() }));

import { providerMentionRecipients } from "./notifications";

const tag = (name: string, email: string) => `@[${name}](${email})`;

describe("providerMentionRecipients", () => {
  const viewerEmails = new Set(["ann@x.com", "bao@x.com", "cy@x.com"]);

  it("keeps tagged viewers once, without the author", () => {
    expect(
      providerMentionRecipients({
        body: `${tag("Ann", "Ann@X.com")} ${tag("Bao", "bao@x.com")} ${tag("Ann", "ann@x.com")}`,
        actorEmail: "bao@x.com",
        viewerEmails,
      })
    ).toEqual(["ann@x.com"]);
  });

  it("drops people who cannot open the Provider List", () => {
    expect(
      providerMentionRecipients({
        body: tag("Zed", "zed@x.com"),
        actorEmail: "bao@x.com",
        viewerEmails,
      })
    ).toEqual([]);
  });

  it("only notifies people newly tagged by an edit", () => {
    expect(
      providerMentionRecipients({
        body: `${tag("Ann", "ann@x.com")} ${tag("Cy", "cy@x.com")}`,
        previousBody: tag("Ann", "ann@x.com"),
        actorEmail: "bao@x.com",
        viewerEmails,
      })
    ).toEqual(["cy@x.com"]);
  });
});
