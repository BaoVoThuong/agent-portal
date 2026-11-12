import { afterEach, describe, expect, it, vi } from "vitest";

const worker = { email: "cs@x.com", isManager: false, isWorker: true };

afterEach(() => {
  vi.doUnmock("@/lib/supabase");
  vi.doUnmock("./membership");
  vi.resetModules();
});

async function load(payload: unknown) {
  vi.resetModules();
  const rpc = vi.fn(async () => ({ data: payload, error: null }));
  vi.doMock("@/lib/supabase", () => ({ getSupabaseAdmin: () => ({ rpc }) }));
  const resolveTaskQueueScope = vi.fn(async () => ({
    agentEmails: ["agent@x.com"],
    assistantAgentEmails: ["agent@x.com"],
    seesAllTasks: false,
  }));
  vi.doMock("./membership", () => ({ resolveTaskQueueScope }));
  const { runTaskSearch } = await import("./search");
  return { runTaskSearch, rpc, resolveTaskQueueScope };
}

describe("runTaskSearch scoped RPC", () => {
  it("returns six visible hits and an honest overflow flag from one database call", async () => {
    const tasks = Array.from({ length: 7 }, (_, index) => ({
      id: `task-${index}`, display_number: index + 1, title: `Invoice ${index}`,
      agent_email: "agent@x.com", status: "todo",
    }));
    const { runTaskSearch, rpc } = await load({
      tasks,
      comments: [{ comment_id: "comment-1", task_id: "task-0", task_title: "Invoice 0",
        body: "Review invoice today", author_email: "cs@x.com", created_at: "2026-11-12T00:00:00Z" }],
      files: [{ attachment_id: "file-1", task_id: "task-0", task_title: "Invoice 0",
        comment_id: null, file_name: "invoice.pdf" }],
    });
    const result = await runTaskSearch(worker, "invoice");
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("search_visible_task_content", {
      p_email: "cs@x.com", p_agent_emails: ["agent@x.com"],
      p_sees_all: false, p_pattern: "%invoice%",
    });
    expect(result.tasks).toHaveLength(6);
    expect(result.truncated).toEqual({ tasks: true, comments: false, files: false });
    expect(result.comments[0].snippet.text).toContain("invoice");
    expect(result.files[0].file_name).toBe("invoice.pdf");
  });

  it("passes company-wide scope for managers", async () => {
    const { runTaskSearch, rpc, resolveTaskQueueScope } = await load({ tasks: [], comments: [], files: [] });
    await runTaskSearch({ ...worker, isManager: true }, "invoice");
    expect(resolveTaskQueueScope).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("search_visible_task_content", expect.objectContaining({
      p_sees_all: true, p_agent_emails: [],
    }));
  });

  it("does not call the database for short queries or unauthorized actors", async () => {
    const { runTaskSearch, rpc } = await load({ tasks: [], comments: [], files: [] });
    await runTaskSearch(worker, "x");
    await runTaskSearch({ ...worker, isWorker: false }, "invoice");
    expect(rpc).not.toHaveBeenCalled();
  });
});
