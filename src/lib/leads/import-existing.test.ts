import { describe, expect, it } from "vitest";
import {
  EVENT_NOT_CREATED_YET,
  findExistingLeadMatches,
  type ExistingLeadCandidate,
} from "./import-existing";
import type { TemplateLead } from "./import-template";

const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";

function row(over: Partial<TemplateLead>): TemplateLead {
  return {
    row: 2,
    full_name: null,
    phone: null,
    email: null,
    fub_link: null,
    description: null,
    agentName: null,
    customRaw: {},
    ...over,
  };
}

function lead(over: Partial<ExistingLeadCandidate>): ExistingLeadCandidate {
  return {
    id: "lead-1",
    display_number: 10,
    full_name: null,
    phone: null,
    email: null,
    fub_link: null,
    assigned_to_email: "owner@x.com",
    event_id: OTHER_EVENT,
    event_name: "Health Fair",
    ...over,
  };
}

describe("findExistingLeadMatches", () => {
  it("matches on phone, email and FUB link", () => {
    const leads = [
      lead({ id: "b", phone: "7135550101" }),
      lead({ id: "c", email: "x@example.com" }),
      lead({ id: "d", fub_link: "https://f.followupboss.com/2/people/view/77" }),
    ];
    const matches = findExistingLeadMatches(
      [
        row({ row: 3, phone: "7135550101" }),
        row({ row: 4, email: "x@example.com" }),
        row({ row: 5, fub_link: "http://f.followupboss.com/2/people/view/77" }),
        row({ row: 6, full_name: "Nobody Here" }),
      ],
      leads,
      EVENT,
    );
    expect(matches.map((match) => [match.row, match.matches[0].leadId, match.matches[0].on])).toEqual([
      [3, "b", ["phone"]],
      [4, "c", ["email"]],
      [5, "d", ["fub"]],
    ]);
  });

  // Trùng tên không phải khách cũ (user chốt 2026-10-04): "Elizabeth" khớp
  // lead của hai người khác nhau.
  it("ignores a match on name alone", () => {
    expect(
      findExistingLeadMatches(
        [row({ full_name: "Elizabeth", phone: "7135550199" })],
        [lead({ full_name: "ELIZABETH", phone: "7135550101" })],
        EVENT,
      ),
    ).toEqual([]);
  });

  it("lists one lead once even when several fields match", () => {
    const [match] = findExistingLeadMatches(
      [row({ phone: "7135550101", email: "x@example.com" })],
      [lead({ phone: "7135550101", email: "x@example.com" })],
      EVENT,
    );
    expect(match.matches).toHaveLength(1);
    expect(match.matches[0].on).toEqual(["phone", "email"]);
  });

  // Ở event khác thì chỉ là cảnh báo; cùng event + cùng số thì DB không cho
  // ghi, nên dòng đó bị khoá ở trạng thái bỏ.
  it("blocks a row only when the same phone is already in this event", () => {
    const sameEvent = findExistingLeadMatches(
      [row({ phone: "7135550101" })],
      [lead({ phone: "7135550101", event_id: EVENT })],
      EVENT,
    );
    expect(sameEvent[0].sameEventBlocked).toBe(true);

    const otherEvent = findExistingLeadMatches(
      [row({ phone: "7135550101" })],
      [lead({ phone: "7135550101" })],
      EVENT,
    );
    expect(otherEvent[0].sameEventBlocked).toBe(false);

  });

  // Event gõ tên chưa có: không lead nào nằm trong đó, nên Personal lead cùng
  // số không được coi là "cùng event".
  it("blocks nothing for an event that does not exist yet", () => {
    const [match] = findExistingLeadMatches(
      [row({ phone: "7135550101" })],
      [lead({ phone: "7135550101", event_id: null })],
      EVENT_NOT_CREATED_YET,
    );
    expect(match.sameEventBlocked).toBe(false);
  });

  it("blocks a phone-less row by its FUB link within the same event", () => {
    const [match] = findExistingLeadMatches(
      [row({ fub_link: "https://f.followupboss.com/2/people/view/9" })],
      [lead({ fub_link: "https://f.followupboss.com/2/people/view/9", event_id: null })],
      null,
    );
    expect(match.sameEventBlocked).toBe(true);
  });
});
