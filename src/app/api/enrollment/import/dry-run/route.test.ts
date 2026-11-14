import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getUserAccessByEmail } from "@/lib/rbac/access";
import { canAccessEnrollment } from "@/lib/enrollment/access";
import { canActorImport } from "@/lib/table-config/export-access";
import { recordsFromMatrix } from "@/lib/enrollment/import";
import { POST } from "./route";

vi.mock("@/lib/rbac/access", () => ({ getUserAccessByEmail: vi.fn() }));
vi.mock("@/lib/tasks/access", () => ({ buildTaskActor: vi.fn() }));
vi.mock("@/lib/enrollment/access", () => ({ canAccessEnrollment: vi.fn() }));
vi.mock("@/lib/table-config/export-access", () => ({ canActorImport: vi.fn() }));
vi.mock("@/lib/enrollment/options", () => ({ fetchEnrollmentOptionData: vi.fn() }));
vi.mock("@/lib/enrollment/queries", () => ({ fetchEnrollmentPeople: vi.fn() }));
vi.mock("@/lib/table-config/queries", () => ({ fetchTableColumnOptions: vi.fn(), fetchTableColumns: vi.fn() }));
vi.mock("@/lib/enrollment/import", () => ({ ENROLLMENT_IMPORT_MAX_ROWS: 1000, recordsFromMatrix: vi.fn() }));
vi.mock("@/lib/enrollment/import-rows", () => ({ processEnrollmentImportRows: vi.fn() }));

const oldSecret = process.env.BOT_PORTAL_SECRET;
const secret = "test-secret-with-enough-entropy-123456789";
const url = "http://localhost/api/enrollment/import/dry-run";
const body = JSON.stringify({ program: "aca", actor_email: "disabled@example.com", rows: [["Client Name"]] });

beforeEach(() => {
  process.env.BOT_PORTAL_SECRET = secret;
  vi.mocked(getUserAccessByEmail).mockReset();
});

afterAll(() => {
  if (oldSecret === undefined) delete process.env.BOT_PORTAL_SECRET;
  else process.env.BOT_PORTAL_SECRET = oldSecret;
});

describe("Enrollment import dry-run authorization", () => {
  it("rejects a wrong bot secret before looking up portal accounts", async () => {
    const response = await POST(new Request(url, {
      method: "POST",
      headers: { authorization: "Bearer wrong", "content-type": "application/json" },
      body,
    }));
    expect(response.status).toBe(401);
    expect(getUserAccessByEmail).not.toHaveBeenCalled();
  });

  it("rejects an inactive actor before reading import data", async () => {
    vi.mocked(getUserAccessByEmail).mockResolvedValue({
      userId: "disabled", permissions: [], isActive: false, agentId: null,
    });
    const response = await POST(new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body,
    }));
    expect(response.status).toBe(403);
    expect(getUserAccessByEmail).toHaveBeenCalledWith("disabled@example.com");
  });

  it("counts only rows with data: blank rows pass the size guard, 1,001 data rows do not", async () => {
    vi.mocked(getUserAccessByEmail).mockResolvedValue({
      userId: "u", permissions: ["task.import"], isActive: true, agentId: null,
    });
    vi.mocked(canAccessEnrollment).mockReturnValue(true);
    vi.mocked(canActorImport).mockReturnValue(true);
    vi.mocked(recordsFromMatrix).mockReturnValue({
      headers: ["Client Name"],
      records: Array.from({ length: 1001 }, () => ({})),
      rowNumbers: [],
    });
    // 1.500 dòng trống ở cuối không bị chặn ở bước kích thước thô...
    const rows = [["Client Name"], ...Array.from({ length: 1500 }, () => [null])];
    const response = await POST(new Request(url, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify({ program: "aca", actor_email: "a@example.com", rows }),
    }));
    // ...mà bị chặn vì có 1.001 dòng dữ liệu.
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "At most 1000 rows per import." });
    expect(recordsFromMatrix).toHaveBeenCalled();
  });
});
