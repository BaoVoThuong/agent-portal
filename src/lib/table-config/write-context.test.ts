import { describe, expect, it, vi } from "vitest";
import { TableConfigUnavailableError, fetchWriteValidationContext } from "./write-context";

describe("fetchWriteValidationContext", () => {
  it("uses one RPC with deduplicated, bounded inputs", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { columns: [], options: [], matched_person_emails: [] },
      error: null,
    });
    const supabase = { rpc } as never;

    await fetchWriteValidationContext(
      {
        scope: "cs",
        mode: "patch",
        touchedSystemKeys: ["summary", "summary"],
        touchedCustomKeys: ["carrier", "carrier"],
        submittedCustomValues: { carrier: "option-1" },
      },
      supabase
    );

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("table_config_write_context", {
      p_scope: "cs",
      p_mode: "patch",
      p_touched_system_keys: ["summary"],
      p_touched_custom_keys: ["carrier"],
      p_submitted_custom_values: { carrier: "option-1" },
    });
  });

  it("maps missing RPC/schema errors to a typed availability error", async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "PGRST202", message: "table_config_write_context not found" },
      }),
    } as never;

    await expect(
      fetchWriteValidationContext({
        scope: "aca",
        mode: "create",
        touchedSystemKeys: [],
        touchedCustomKeys: [],
        submittedCustomValues: {},
      }, supabase)
    ).rejects.toBeInstanceOf(TableConfigUnavailableError);
  });
});
