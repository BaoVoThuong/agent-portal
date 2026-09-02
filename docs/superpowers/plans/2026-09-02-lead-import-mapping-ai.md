# Import lead — bảng map cột cố định + AI gợi ý

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development hoặc superpowers:executing-plans. Các bước dùng checkbox (`- [ ]`).

**Goal:** Màn hình Import hiện **danh sách cột đích cố định** (trường hệ thống + cột custom đã cấu hình), mỗi cột chọn nguồn từ file; Sonnet 5 đọc tiêu đề + 10 dòng đầu rồi điền sẵn mapping, người dùng sửa lại chỗ nào sai.

**Architecture:** Ba lớp tách bạch — (1) danh sách cột đích dựng từ Lead Table Config, (2) route AI trả về gợi ý **đã được kiểm chứng lại ở server**, (3) dialog ghép hai thứ đó thành bảng map. Phần quyết định (dựng danh sách, làm sạch output của model, đổi mapping thành hàng lead) nằm trong `src/lib/` để test được.

**Tech Stack:** Next.js 16.2.4, TypeScript, Anthropic SDK (`@anthropic-ai/sdk` đã có), vitest, xlsx.

---

## Quyết định đã chốt với người dùng (2026-09-02)

| Câu hỏi | Chốt |
| --- | --- |
| Cột đích gồm gì? | **Trường hệ thống + cột custom đã cấu hình.** Product và Event vẫn chọn **một lần cho cả file** như hiện nay, không map theo dòng. |
| LLM chạy lúc nào? | **Tự chạy ngay khi chọn file.** |
| LLM được nhìn gì? | **Tiêu đề + 10 dòng đầu, nguyên vẹn.** Người dùng đã cân nhắc và chấp nhận việc dữ liệu khách được gửi tới Anthropic. |
| Model | **Sonnet 5** (`claude-sonnet-5`). Key `ANTHROPIC_API_KEY` đã có sẵn trong môi trường. |

---

## Hiện trạng (đã đối chiếu source)

**Mapping hiện tại chỉ có ba trường**, `src/lib/leads/import-parse.ts:17`:

```ts
export type LeadColumnMapping = {
  full_name?: string;
  phone: string;
  email?: string;
};
```

**Cột thừa được nhặt theo TÊN, không theo map** — `parseLeadRows`:

```ts
    for (const [header, value] of Object.entries(record)) {
      if (mappedKeys.has(header)) continue;
      if (value === null || value === undefined || value === "") continue;
      customValues[slugifyColumnKey(header)] = value;
    }
```

Tức cột Excel tên `Secondary Phone` tự rơi vào `custom_values.secondary_phone` **nhờ trùng tên sau khi slugify**. Đó là phỏng đoán, không phải lựa chọn của người dùng — và nó chính là thứ bảng map sẽ thay thế.

**Đoán cột hiện tại** là ba biểu thức chính quy, `LeadImportDialog.tsx:216-223`: `/phone|cell|mobile/i`, `/name/i`, `/e-?mail/i`.

**Cột của scope `lead` trong Table Config** (14 cột, 13 hệ thống + 1 custom):

```
name, product, status, lastContact, interactionHistory, phone,
secondary_phone (custom), email, assignee, attempts, followUp,
event, createdAt, key
```

**Chỉ một phần trong số đó nhận được từ file import.** `attempts`, `interactionHistory`, `lastContact`, `createdAt`, `key` là do hệ thống tự sinh hoặc do việc ghi tương tác cập nhật — cho map vào là mở đường ghi đè dữ liệu vận hành bằng một file Excel. Danh sách cột đích vì vậy phải **lọc**, không phải lấy nguyên bảng config.

**Hạ tầng AI đã có**: `src/lib/ai/client.ts` xuất `getAnthropic()`, dùng cho AI dashboard chat với `AI_MODEL = "claude-sonnet-4-6"`. Plan này **không đụng hằng đó** — đổi nó là đổi luôn hành vi của tính năng chat; khai một hằng riêng cho việc map.

---

## Global Constraints

- **Thư mục làm việc**: `/Users/vothuongbao/Project/Web/agent-portal`.
- **Test**: vitest `environment: "node"`, `include: ["src/**/*.test.ts"]`. **`.tsx` KHÔNG chạy test được** — phần quyết định phải nằm trong `src/lib/`.
- **Bốn lệnh kiểm tra** trước mỗi commit: `npm run typecheck` · `npm run lint` · `npm run test:run` · `npm run build`
- **Changelog bắt buộc**, mới nhất trên cùng.
- **KHÔNG tự push.** Phải nêu tên remote.
- **Trước khi push**: `node scripts/check-tracked-imports.mjs` rồi build từ checkout sạch.
- **Không có SQL.** Không thêm bảng, không thêm cột.
- **KHÔNG BAO GIỜ tin thẳng output của model.** Mọi gợi ý phải được đối chiếu lại với danh sách tiêu đề thật và danh sách cột đích thật trước khi tới tay người dùng. Model có thể bịa tên cột, trả JSON hỏng, hoặc map hai trường vào cùng một nguồn.
- **Ngôn ngữ**: comment giải thích *tại sao* viết tiếng Việt; chuỗi hiển thị viết **tiếng Anh**.

---

## File Structure

**Tạo mới**

| File | Trách nhiệm |
| --- | --- |
| `src/lib/leads/import-targets.ts` | Dựng danh sách cột đích từ Table Config (có lọc) |
| `src/lib/leads/import-targets.test.ts` | Test |
| `src/lib/leads/import-mapping.ts` | Kiểu mapping mới + làm sạch gợi ý của model + đổi mapping thành hàng lead |
| `src/lib/leads/import-mapping.test.ts` | Test, gồm ca model bịa tên cột |
| `src/lib/ai/import-mapping-agent.ts` | Gọi Sonnet 5, trả gợi ý thô |
| `src/app/api/leads/import/suggest-mapping/route.ts` | Route AI, kiểm quyền + làm sạch |

**Sửa**

| File | Sửa gì |
| --- | --- |
| `src/lib/leads/import-parse.ts` | `parseLeadRows` nhận mapping dạng bản ghi; bỏ việc nhặt cột thừa theo tên |
| `src/lib/leads/import-parse.test.ts` | Cập nhật theo chữ ký mới |
| `src/app/api/leads/import/route.ts` | Đọc mapping dạng mới |
| `src/app/(authed)/leads/_components/LeadImportDialog.tsx` | Bảng map + gọi AI khi chọn file |
| `src/app/(authed)/leads/_components/LeadsClient.tsx` | Truyền `columns` xuống dialog |
| `changelog.md` | Một mục |

---

## Task 1: Danh sách cột đích

**Files:** Create `src/lib/leads/import-targets.ts`, `src/lib/leads/import-targets.test.ts`

**Interfaces:**
- Produces: `type LeadImportTarget = { key: string; label: string; required: boolean; isCustom: boolean }`
- Produces: `buildLeadImportTargets(columns: readonly TableColumn[]): LeadImportTarget[]`

**Luật lọc — đọc kỹ, đây là phần dễ làm sai nhất của task này.**

Không phải cột nào trong Table Config cũng nhận được từ file. Ba nhóm:

1. **Nhận được** — `name`, `phone`, `email`, và **mọi cột custom** chưa archive.
2. **Không nhận** vì đã chọn một lần cho cả file trong dialog — `product`, `event`, `assignee`, `status`.
3. **Không nhận** vì do hệ thống tự sinh — `attempts`, `interactionHistory`, `lastContact`, `createdAt`, `key`. Cho map vào là mở đường ghi đè dữ liệu vận hành bằng một file Excel: `attempts` do việc ghi tương tác cộng lên, `lastContact` do lần liên hệ gần nhất quyết định. Một file import không được phép nói dối về những chuyện đó.

`phone` là cột **bắt buộc** duy nhất — giữ nguyên luật hiện có.

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/leads/import-targets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLeadImportTargets } from "./import-targets";
import type { TableColumn } from "@/lib/table-config/types";

const col = (over: Partial<TableColumn>): TableColumn =>
  ({
    id: "id",
    scope: "lead",
    key: "x",
    label: "X",
    type: "text",
    is_system: true,
    position: 1,
    pinned: false,
    hidden_default: false,
    show_in_detail: true,
    required: false,
    archived_at: null,
    ...over,
  }) as TableColumn;

describe("buildLeadImportTargets", () => {
  it("nhận ba trường hệ thống mà file cấp được", () => {
    const out = buildLeadImportTargets([
      col({ key: "name", label: "Name" }),
      col({ key: "phone", label: "Phone" }),
      col({ key: "email", label: "Email" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["name", "phone", "email"]);
  });

  it("phone là cột bắt buộc duy nhất", () => {
    const out = buildLeadImportTargets([
      col({ key: "name" }),
      col({ key: "phone" }),
      col({ key: "email" }),
    ]);
    expect(out.find((t) => t.key === "phone")?.required).toBe(true);
    expect(out.find((t) => t.key === "name")?.required).toBe(false);
  });

  it("LOẠI cột do hệ thống tự sinh", () => {
    // Cho map `attempts` là để một file Excel nói dối về số lần đã gọi — con số
    // đó do việc ghi tương tác cộng lên, không phải do ai gõ vào.
    const out = buildLeadImportTargets([
      col({ key: "phone" }),
      col({ key: "attempts", label: "Attempts", type: "number" }),
      col({ key: "lastContact", label: "Last contact", type: "date" }),
      col({ key: "interactionHistory" }),
      col({ key: "createdAt" }),
      col({ key: "key" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["phone"]);
  });

  it("LOẠI cột đã chọn một lần cho cả file", () => {
    const out = buildLeadImportTargets([
      col({ key: "phone" }),
      col({ key: "product" }),
      col({ key: "event" }),
      col({ key: "assignee" }),
      col({ key: "status" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["phone"]);
  });

  it("nhận mọi cột custom chưa archive", () => {
    const out = buildLeadImportTargets([
      col({ key: "phone" }),
      col({ key: "secondary_phone", label: "Secondary Phone", is_system: false }),
      col({ key: "cu", label: "Cũ", is_system: false, archived_at: "2026-01-01" }),
    ]);
    expect(out.map((t) => t.key)).toEqual(["phone", "secondary_phone"]);
    expect(out.find((t) => t.key === "secondary_phone")?.isCustom).toBe(true);
  });

  it("giữ nhãn admin đặt, không tự chế nhãn", () => {
    // Admin đổi "Phone" thành "Mobile number" thì bảng map phải gọi đúng tên đó.
    const out = buildLeadImportTargets([col({ key: "phone", label: "Mobile number" })]);
    expect(out[0].label).toBe("Mobile number");
  });

  it("phone luôn có mặt kể cả khi config thiếu", () => {
    // Không có phone thì không import được dòng nào; thà hiện ô trống bắt chọn
    // còn hơn một bảng map thiếu mất trường bắt buộc.
    const out = buildLeadImportTargets([col({ key: "name" })]);
    expect(out.some((t) => t.key === "phone" && t.required)).toBe(true);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/import-targets.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Step 3: Viết module**

Tạo `src/lib/leads/import-targets.ts`:

```ts
import type { TableColumn } from "@/lib/table-config/types";

export type LeadImportTarget = {
  /** `name` | `phone` | `email` | khoá của một cột custom. */
  key: string;
  /** Nhãn admin đặt trong Table Config. */
  label: string;
  required: boolean;
  isCustom: boolean;
};

/** Ba trường hệ thống mà một file import cấp được. */
const IMPORTABLE_SYSTEM_KEYS = ["name", "phone", "email"] as const;

/**
 * Danh sách cột đích cho bảng map.
 *
 * Cố ý KHÔNG lấy nguyên bảng Table Config. Hai nhóm bị loại:
 *
 *  - **Chọn một lần cho cả file** (`product`, `event`, `assignee`, `status`):
 *    người dùng đã chọn trong dialog, đưa vào bảng map là hỏi hai lần một câu.
 *
 *  - **Do hệ thống tự sinh** (`attempts`, `lastContact`, `interactionHistory`,
 *    `createdAt`, `key`): cho map vào là mở đường ghi đè dữ liệu vận hành bằng
 *    một file Excel. `attempts` do việc ghi tương tác cộng lên; `lastContact` do
 *    lần liên hệ gần nhất quyết định. Một file import không được nói dối về
 *    những chuyện đó.
 *
 * Cột custom thì nhận hết — chúng sinh ra chính là để chứa dữ liệu ngoài.
 */
export function buildLeadImportTargets(
  columns: readonly TableColumn[]
): LeadImportTarget[] {
  const active = columns.filter((column) => !column.archived_at);
  const byKey = new Map(active.map((column) => [column.key, column]));

  const targets: LeadImportTarget[] = [];
  for (const key of IMPORTABLE_SYSTEM_KEYS) {
    const column = byKey.get(key);
    // `phone` phải có mặt kể cả khi config thiếu: không có nó thì không import
    // được dòng nào, và một bảng map thiếu trường bắt buộc thì vô dụng.
    if (!column && key !== "phone") continue;
    targets.push({
      key,
      label: column?.label ?? "Phone",
      required: key === "phone",
      isCustom: false,
    });
  }

  for (const column of active) {
    if (column.is_system) continue;
    targets.push({
      key: column.key,
      label: column.label,
      required: false,
      isCustom: true,
    });
  }
  return targets;
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/import-targets.test.ts`
Expected: PASS 7 test.

- [ ] **Step 5: Bốn lệnh kiểm tra + commit**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

```bash
git add src/lib/leads/import-targets.ts src/lib/leads/import-targets.test.ts
git commit -m "feat(leads): danh sách cột đích cho bảng map khi import"
```

---

## Task 2: Kiểu mapping mới và làm sạch gợi ý

**Files:** Create `src/lib/leads/import-mapping.ts`, `src/lib/leads/import-mapping.test.ts`

**Interfaces:**
- Produces: `type LeadImportMapping = Record<string, string>` — khoá cột đích → tiêu đề cột trong file
- Produces: `sanitizeSuggestedMapping(raw: unknown, headers: readonly string[], targets: readonly LeadImportTarget[]): LeadImportMapping`
- Produces: `guessMappingByName(headers: readonly string[], targets: readonly LeadImportTarget[]): LeadImportMapping`

**Vì sao phải làm sạch:** model trả về JSON tự do. Bốn thứ nó có thể làm sai, và cả bốn đều phải bị chặn **trước khi tới tay người dùng** — không phải để bảo vệ hệ thống khỏi kẻ xấu, mà vì một bảng map trỏ vào cột không tồn tại sẽ hỏng ở bước parse với thông báo chẳng ai hiểu:

1. Bịa tên cột không có trong file.
2. Trả khoá đích không nằm trong danh sách.
3. Map **hai** trường đích vào **cùng một** cột nguồn.
4. Trả về thứ không phải object, hoặc giá trị không phải chuỗi.

- [ ] **Step 1: Viết test thất bại**

Tạo `src/lib/leads/import-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guessMappingByName, sanitizeSuggestedMapping } from "./import-mapping";
import type { LeadImportTarget } from "./import-targets";

const targets: LeadImportTarget[] = [
  { key: "name", label: "Name", required: false, isCustom: false },
  { key: "phone", label: "Phone", required: true, isCustom: false },
  { key: "email", label: "Email", required: false, isCustom: false },
  { key: "secondary_phone", label: "Secondary Phone", required: false, isCustom: true },
];
const headers = ["Ho ten", "SDT", "Mail", "SDT phu"];

describe("sanitizeSuggestedMapping", () => {
  it("giữ lại gợi ý hợp lệ", () => {
    expect(
      sanitizeSuggestedMapping(
        { name: "Ho ten", phone: "SDT", email: "Mail" },
        headers,
        targets
      )
    ).toEqual({ name: "Ho ten", phone: "SDT", email: "Mail" });
  });

  it("BỎ cột model bịa ra", () => {
    // Model có thể trả về một tiêu đề không hề có trong file. Để lọt thì bước
    // parse sẽ hỏng với thông báo chẳng ai hiểu.
    expect(
      sanitizeSuggestedMapping({ name: "Ho ten", phone: "Cot Khong Ton Tai" }, headers, targets)
    ).toEqual({ name: "Ho ten" });
  });

  it("BỎ khoá đích không nằm trong danh sách", () => {
    expect(
      sanitizeSuggestedMapping({ phone: "SDT", attempts: "SDT phu" }, headers, targets)
    ).toEqual({ phone: "SDT" });
  });

  it("một cột nguồn chỉ được dùng cho MỘT đích", () => {
    // Model hay map cả `phone` lẫn `secondary_phone` vào cùng một cột. Giữ đích
    // đầu tiên theo thứ tự danh sách, bỏ cái sau.
    const out = sanitizeSuggestedMapping(
      { phone: "SDT", secondary_phone: "SDT" },
      headers,
      targets
    );
    expect(out).toEqual({ phone: "SDT" });
  });

  it("chịu được JSON hỏng mà không nổ", () => {
    expect(sanitizeSuggestedMapping(null, headers, targets)).toEqual({});
    expect(sanitizeSuggestedMapping("linh tinh", headers, targets)).toEqual({});
    expect(sanitizeSuggestedMapping([1, 2], headers, targets)).toEqual({});
    expect(sanitizeSuggestedMapping({ phone: 42 }, headers, targets)).toEqual({});
  });
});

describe("guessMappingByName", () => {
  it("khớp tiêu đề tiếng Anh thông dụng", () => {
    expect(
      guessMappingByName(["Full Name", "Mobile", "E-mail"], targets)
    ).toEqual({ name: "Full Name", phone: "Mobile", email: "E-mail" });
  });

  it("khớp cột custom theo nhãn, không phân biệt hoa thường và dấu cách", () => {
    expect(
      guessMappingByName(["Phone", "secondary phone"], targets).secondary_phone
    ).toBe("secondary phone");
  });

  it("không khớp thì bỏ trống, KHÔNG đoán bừa", () => {
    // Đoán bừa tệ hơn để trống: người dùng thấy ô trống thì biết phải chọn, còn
    // thấy một lựa chọn sai thì tin và bấm Import.
    expect(guessMappingByName(["Column1", "Column2"], targets)).toEqual({});
  });

  it("một cột nguồn không bị gán cho hai đích", () => {
    expect(
      Object.values(guessMappingByName(["Phone number", "Name"], targets))
    ).toEqual([...new Set(Object.values(guessMappingByName(["Phone number", "Name"], targets)))]);
  });
});
```

- [ ] **Step 2: Chạy để thấy hỏng**

Run: `npx vitest run src/lib/leads/import-mapping.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Step 3: Viết module**

Tạo `src/lib/leads/import-mapping.ts`:

```ts
import type { LeadImportTarget } from "./import-targets";

/** Khoá cột đích → tiêu đề cột trong file. Thiếu khoá = chưa map. */
export type LeadImportMapping = Record<string, string>;

/** Luật đoán theo tên, dùng cho ba trường hệ thống. */
const NAME_PATTERNS: Record<string, RegExp> = {
  name: /(full\s*)?name|ho\s*ten|khach/i,
  phone: /phone|cell|mobile|sdt|so\s*dien\s*thoai/i,
  email: /e-?mail|mail/i,
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * Đoán mapping từ tên cột, không gọi mạng.
 *
 * Chạy TRƯỚC khi hỏi AI, và là thứ hiện ra ngay nếu AI hỏng hoặc chậm. Đoán
 * bừa thì tệ hơn để trống: người dùng thấy ô trống thì biết phải chọn, còn thấy
 * một lựa chọn sai thì tin và bấm Import.
 */
export function guessMappingByName(
  headers: readonly string[],
  targets: readonly LeadImportTarget[]
): LeadImportMapping {
  const mapping: LeadImportMapping = {};
  const used = new Set<string>();
  for (const target of targets) {
    const pattern = NAME_PATTERNS[target.key];
    const label = normalize(target.label);
    const match = headers.find((header) => {
      if (used.has(header)) return false;
      if (pattern?.test(header)) return true;
      // Cột custom: khớp theo nhãn admin đặt.
      return normalize(header) === label;
    });
    if (match) {
      mapping[target.key] = match;
      used.add(match);
    }
  }
  return mapping;
}

/**
 * Làm sạch gợi ý của model trước khi cho nó chạm vào giao diện.
 *
 * KHÔNG BAO GIỜ tin thẳng output của model. Bốn thứ nó làm sai được, và cả bốn
 * đều bị chặn ở đây — không phải để chống kẻ xấu, mà vì một bảng map trỏ vào
 * cột không tồn tại sẽ hỏng ở bước parse với thông báo chẳng ai hiểu.
 */
export function sanitizeSuggestedMapping(
  raw: unknown,
  headers: readonly string[],
  targets: readonly LeadImportTarget[]
): LeadImportMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const headerSet = new Set(headers);
  const targetKeys = new Set(targets.map((target) => target.key));
  const source = raw as Record<string, unknown>;

  const mapping: LeadImportMapping = {};
  const used = new Set<string>();
  // Duyệt theo THỨ TỰ DANH SÁCH ĐÍCH, không theo thứ tự khoá model trả về: khi
  // model map hai đích vào cùng một cột nguồn, đích đứng trước trong danh sách
  // được giữ — và thứ tự đó ổn định giữa các lần chạy.
  for (const target of targets) {
    const value = source[target.key];
    if (typeof value !== "string") continue;
    if (!targetKeys.has(target.key)) continue;
    if (!headerSet.has(value)) continue;
    if (used.has(value)) continue;
    mapping[target.key] = value;
    used.add(value);
  }
  return mapping;
}
```

- [ ] **Step 4: Chạy để thấy xanh**

Run: `npx vitest run src/lib/leads/import-mapping.test.ts`
Expected: PASS 9 test.

- [ ] **Step 5: Bốn lệnh kiểm tra + commit**

```bash
git add src/lib/leads/import-mapping.ts src/lib/leads/import-mapping.test.ts
git commit -m "feat(leads): kiểu mapping import mới và bộ làm sạch gợi ý"
```

---

## Task 3: `parseLeadRows` theo mapping mới

**Files:** Modify `src/lib/leads/import-parse.ts`, `src/lib/leads/import-parse.test.ts`

**Interfaces:**
- Consumes: `LeadImportMapping` từ Task 2
- Produces: `parseLeadRows(records, mapping: LeadImportMapping)` — **đổi tham số thứ hai**

**Thay đổi hành vi phải nói rõ:** hiện `parseLeadRows` nhặt **mọi cột không map** vào `custom_values` theo tên đã slugify. Sau task này, **chỉ cột được map mới vào `custom_values`**. Cột không map bị bỏ hẳn.

Đó là chủ đích: bảng map sinh ra để người dùng nói rõ cột nào đi đâu. Giữ lại việc nhặt theo tên là để hai cơ chế cùng quyết một chuyện — đúng loại mâu thuẫn đã gây ra vài lỗi trong đợt trước.

- [ ] **Step 1: Sửa kiểu và thân hàm**

Trong `src/lib/leads/import-parse.ts`:

```ts
import type { LeadImportMapping } from "./import-mapping";
```

Xoá `export type LeadColumnMapping = { … }` và mọi chỗ dùng nó; đổi chữ ký:

```ts
export function parseLeadRows(
  records: readonly Record<string, unknown>[],
  mapping: LeadImportMapping
): ParseResult {
```

Trong thân hàm, thay khối lấy giá trị:

```ts
  records.forEach((record, index) => {
    const excelRow = index + 2;
    const phone = normalizePhone(cell(record, mapping.phone));
    if (!phone) {
      skipped.push({ row: excelRow, reason: "Missing phone number" });
      return;
    }
    if (seenPhones.has(phone)) {
      skipped.push({ row: excelRow, reason: "Duplicate phone number in this file" });
      return;
    }
    seenPhones.add(phone);

    // CHỈ cột được map mới vào custom_values. Bản trước nhặt mọi cột không map
    // theo tên đã slugify — một phỏng đoán, không phải lựa chọn của người dùng.
    // Giữ cả hai cơ chế là để chúng cùng quyết một chuyện rồi mâu thuẫn nhau.
    const customValues: Record<string, unknown> = {};
    for (const [targetKey, header] of Object.entries(mapping)) {
      if (targetKey === "name" || targetKey === "phone" || targetKey === "email") continue;
      const value = record[header];
      if (value === null || value === undefined || value === "") continue;
      customValues[targetKey] = value;
    }

    const email = cell(record, mapping.email);
    rows.push({
      row: excelRow,
      full_name: cell(record, mapping.name),
      phone,
      email: email ? email.toLowerCase() : null,
      custom_values: customValues,
    });
  });
```

Chú ý: khoá trường tên là **`name`** (khớp Table Config), không phải `full_name` như kiểu cũ. Trường trong `ParsedLead` vẫn là `full_name` vì đó là tên cột trong DB.

Xoá luôn biến `mappedKeys` và `slugifyColumnKey` nếu không còn ai dùng (kiểm bằng grep).

- [ ] **Step 2: Cập nhật test hiện có**

Trong `src/lib/leads/import-parse.test.ts`, đổi mọi `mapping` sang dạng mới. Ví dụ:

```ts
const mapping = { name: "Name", phone: "Cell", email: "Email" };
```

Và ca "keeps the rest as custom values" nay phải đổi ý nghĩa — thêm cột custom vào mapping:

```ts
  it("chỉ đưa cột ĐƯỢC MAP vào custom values", () => {
    const result = parseLeadRows(
      [{ Name: "An Nguyen", Cell: "(714) 555-0123", Email: "an@x.com", Language: "VI", Notes: "bỏ qua" }],
      { name: "Name", phone: "Cell", email: "Email", language: "Language" }
    );
    expect(result.rows).toEqual([{
      row: 2,
      full_name: "An Nguyen",
      phone: "7145550123",
      email: "an@x.com",
      // `Notes` không được map nên không vào. Trước đây nó tự rơi vào
      // custom_values.notes theo tên — một phỏng đoán, không phải lựa chọn.
      custom_values: { language: "VI" },
    }]);
    expect(result.skipped).toEqual([]);
  });
```

- [ ] **Step 3: Chạy test**

Run: `npx vitest run src/lib/leads/import-parse.test.ts src/lib/leads/import-validate.test.ts`
Expected: PASS. `import-validate` không đổi vì nó nhận `ParsedLead` chứ không nhận mapping.

- [ ] **Step 4: Sửa route import**

Trong `src/app/api/leads/import/route.ts`, thay khối đọc mapping:

```ts
  let mapping: LeadImportMapping;
  try {
    const parsed = JSON.parse(String(form.get("mapping") ?? "")) as Record<string, unknown>;
    // Chỉ nhận cặp chuỗi→chuỗi. Client là nơi dựng bảng map, nhưng route vẫn
    // phải tự kiểm: một payload méo phải ra 400 có lời giải thích, không phải
    // một lỗi lạ ở giữa vòng lặp parse.
    mapping = Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === "string" && typeof value === "string"
      )
    ) as LeadImportMapping;
  } catch {
    return NextResponse.json({ error: "Column mapping is missing." }, { status: 400 });
  }
  if (!mapping.phone) {
    return NextResponse.json(
      { error: "Choose which column holds the phone number." },
      { status: 400 }
    );
  }
```

Thêm `import type { LeadImportMapping } from "@/lib/leads/import-mapping";`

- [ ] **Step 5: Bốn lệnh kiểm tra + commit**

```bash
git add src/lib/leads/import-parse.ts src/lib/leads/import-parse.test.ts src/app/api/leads/import/route.ts
git commit -m "feat(leads): parseLeadRows theo bảng map cột thay vì đoán theo tên"
```

---

## Task 4: Route AI gợi ý mapping

**Files:** Create `src/lib/ai/import-mapping-agent.ts`, `src/app/api/leads/import/suggest-mapping/route.ts`

**Interfaces:**
- Produces: `suggestImportMapping(input): Promise<unknown>` — trả JSON **thô** của model, chưa làm sạch
- Produces: `POST /api/leads/import/suggest-mapping` → `{ mapping: LeadImportMapping }`

**Model:** `claude-sonnet-5`. **Không đụng** `AI_MODEL` trong `src/lib/ai/client.ts` — hằng đó đang phục vụ AI dashboard chat, đổi nó là đổi luôn hành vi của tính năng khác.

- [ ] **Step 1: Viết agent**

Tạo `src/lib/ai/import-mapping-agent.ts`:

```ts
import { getAnthropic } from "./client";

/** Người dùng chốt Sonnet 5 cho việc này (2026-09-02). Tách khỏi AI_MODEL của
 *  dashboard chat: đổi hằng kia là đổi hành vi của một tính năng khác. */
const IMPORT_MAPPING_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 1024;
/** Người dùng chốt 10 dòng. Đủ để nhìn ra hình dạng dữ liệu mà không thổi
 *  prompt lên vô hạn với file 2.000 dòng. */
export const SAMPLE_ROW_LIMIT = 10;
/** Ô quá dài (ghi chú dài dòng) không giúp đoán cột, chỉ tốn token. */
const MAX_CELL_LENGTH = 120;

export type MappingSuggestionInput = {
  headers: readonly string[];
  /** Tối đa SAMPLE_ROW_LIMIT dòng, mỗi ô đã cắt ngắn. */
  sampleRows: readonly Record<string, unknown>[];
  targets: readonly { key: string; label: string; required: boolean }[];
};

function trimCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text;
}

/**
 * Hỏi model xem cột nào trong file nên đổ vào trường nào.
 *
 * Trả về JSON **thô**. Người gọi PHẢI cho qua `sanitizeSuggestedMapping` trước
 * khi dùng — model có thể bịa tên cột, trả khoá lạ, hoặc map hai trường vào
 * cùng một nguồn.
 */
export async function suggestImportMapping(
  input: MappingSuggestionInput
): Promise<unknown> {
  const rows = input.sampleRows.slice(0, SAMPLE_ROW_LIMIT).map((record) => {
    const out: Record<string, string> = {};
    for (const header of input.headers) out[header] = trimCell(record[header]);
    return out;
  });

  const prompt = [
    "You map spreadsheet columns onto the fields of a CRM lead import.",
    "",
    "TARGET FIELDS (map into these; use the exact key):",
    ...input.targets.map(
      (t) => `- ${t.key}: "${t.label}"${t.required ? " (required)" : ""}`
    ),
    "",
    "SPREADSHEET HEADERS:",
    JSON.stringify(input.headers),
    "",
    `FIRST ${rows.length} DATA ROWS:`,
    JSON.stringify(rows, null, 2),
    "",
    "Rules:",
    "- Reply with ONLY a JSON object, no prose and no code fence.",
    "- Keys are target field keys; values are the EXACT header string.",
    "- Omit a field entirely when no column fits. Do not guess.",
    "- Never use the same header for two fields.",
    "- Judge by the DATA, not only the header text: a column named",
    "  \"Column3\" holding \"(714) 555-0123\" is the phone column.",
  ].join("\n");

  const response = await getAnthropic().messages.create({
    model: IMPORT_MAPPING_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  // Model đôi khi bọc trong ```json dù đã dặn. Lấy object đầu tiên tìm được thay
  // vì bắt nó phải đúng tuyệt đối — đây là chỗ rẻ để tha thứ.
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Viết route**

Tạo `src/app/api/leads/import/suggest-mapping/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildLeadActor, canManageLeads, isLeadViewAdmin } from "@/lib/leads/access";
import { sanitizeSuggestedMapping } from "@/lib/leads/import-mapping";
import { buildLeadImportTargets } from "@/lib/leads/import-targets";
import { suggestImportMapping, SAMPLE_ROW_LIMIT } from "@/lib/ai/import-mapping-agent";
import { fetchTableColumns } from "@/lib/table-config/queries";

export const dynamic = "force-dynamic";

/** Cùng cổng quyền với chính việc import: gợi ý mapping là một bước của nó. */
export async function POST(request: Request) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = buildLeadActor(session.user.permissions, email, {
    isAdmin: isLeadViewAdmin(session.user),
  });
  if (!canManageLeads(actor)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    headers?: unknown;
    sampleRows?: unknown;
  } | null;
  const headers = Array.isArray(body?.headers)
    ? body.headers.filter((h): h is string => typeof h === "string")
    : [];
  const sampleRows = Array.isArray(body?.sampleRows)
    ? (body.sampleRows.filter(
        (r) => r && typeof r === "object" && !Array.isArray(r)
      ) as Record<string, unknown>[])
    : [];
  if (headers.length === 0) {
    return NextResponse.json({ error: "No columns to map." }, { status: 400 });
  }

  // Cột đích dựng ở SERVER từ Table Config, không nhận từ client: client có thể
  // gửi một danh sách bịa, và model sẽ ngoan ngoãn map vào đó.
  const targets = buildLeadImportTargets(await fetchTableColumns("lead"));

  try {
    const raw = await suggestImportMapping({
      headers,
      sampleRows: sampleRows.slice(0, SAMPLE_ROW_LIMIT),
      targets,
    });
    // Làm sạch ở server chứ không ở client: client tin gì thì tin, nhưng thứ
    // rời khỏi route này phải đã đúng.
    return NextResponse.json({
      mapping: sanitizeSuggestedMapping(raw, headers, targets),
    });
  } catch (error) {
    // Gợi ý hỏng KHÔNG được làm hỏng việc import. Trả mapping rỗng kèm lời giải
    // thích; màn hình rơi về phần đoán theo tên và người dùng vẫn map tay được.
    console.error("Lead import mapping suggestion failed", error);
    return NextResponse.json({
      mapping: {},
      error: "Could not suggest a mapping. Map the columns manually.",
    });
  }
}
```

Kiểm tên hàm đọc cột: chạy `grep -n "export async function fetchTableColumns" -A 4 src/lib/table-config/queries.ts` và sửa lời gọi cho khớp chữ ký thật (có thể cần truyền `supabase`).

- [ ] **Step 3: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 4: Thử route bằng tay**

Cần đăng nhập nên thử qua trình duyệt: mở DevTools → Console trên `/leads`, chạy:

```js
await (await fetch("/api/leads/import/suggest-mapping", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    headers: ["Ho ten", "So DT", "Mail"],
    sampleRows: [{ "Ho ten": "An Nguyen", "So DT": "(714) 555-0123", "Mail": "an@x.com" }],
  }),
})).json();
```
Expected: `{ mapping: { name: "Ho ten", phone: "So DT", email: "Mail" } }`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/import-mapping-agent.ts "src/app/api/leads/import/suggest-mapping/route.ts"
git commit -m "feat(leads): route AI gợi ý mapping cột khi import"
```

---

## Task 5: Bảng map trong dialog

**Files:** Modify `src/app/(authed)/leads/_components/LeadImportDialog.tsx`, `src/app/(authed)/leads/_components/LeadsClient.tsx`, `changelog.md`

- [ ] **Step 1: Truyền `columns` xuống dialog**

Trong `LeadsClient.tsx`, thêm vào chỗ render `<LeadImportDialog …>`:

```tsx
        columns={columns}
```

`LeadsClient` đã có sẵn prop `columns` — nó đang truyền cho `LeadAddDialog` theo đúng cách này.

- [ ] **Step 2: Nhận prop và dựng danh sách đích**

Trong `LeadImportDialog.tsx`, thêm `columns: TableColumn[];` vào kiểu props và `columns,` vào destructure. Rồi:

```tsx
  const targets = useMemo(() => buildLeadImportTargets(columns), [columns]);
```

- [ ] **Step 3: Đổi state mapping**

```tsx
  const [mapping, setMapping] = useState<LeadImportMapping>({});
  const [aiState, setAiState] = useState<"idle" | "asking" | "done" | "failed">("idle");
  /** Trường nào do AI điền — để gắn nhãn, và để không đè lên chỉnh tay. */
  const [aiFilled, setAiFilled] = useState<ReadonlySet<string>>(new Set());
```

- [ ] **Step 4: Chọn file → đoán theo tên, rồi hỏi AI**

Thay khối `setMapping({ full_name: …, phone: …, email: … })` bằng:

```tsx
      // Đoán theo tên trước: nó tức thì, không tốn tiền, và là thứ hiện ra nếu
      // AI hỏng hoặc chậm.
      const localGuess = guessMappingByName(nextHeaders, targets);
      setMapping(localGuess);
      setAiFilled(new Set());
      setAiState("asking");
      void fetch("/api/leads/import/suggest-mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          headers: nextHeaders,
          sampleRows: nextRecords.slice(0, 10),
        }),
      })
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          const suggested = (payload?.mapping ?? {}) as LeadImportMapping;
          setMapping((current) => {
            // Gợi ý AI chỉ ĐIỀN CHỖ TRỐNG, không đè lên thứ người dùng đã tự
            // chọn. Người ta sửa xong mà AI trả về muộn rồi ghi đè là mất công
            // gõ, và tệ hơn: họ không thấy nó đổi.
            const merged = { ...current };
            const filled = new Set<string>();
            for (const [key, header] of Object.entries(suggested)) {
              if (merged[key]) continue;
              if (Object.values(merged).includes(header)) continue;
              merged[key] = header;
              filled.add(key);
            }
            setAiFilled(filled);
            return merged;
          });
          setAiState("done");
        })
        .catch(() => setAiState("failed"));
```

**Chú ý về React Compiler**: gọi `setAiFilled` bên trong hàm cập nhật của `setMapping` là cấm — hàm cập nhật phải thuần. Tách ra:

```tsx
        .then(async (response) => {
          const payload = await response.json().catch(() => null);
          const suggested = (payload?.mapping ?? {}) as LeadImportMapping;
          const merged = { ...localGuess };
          const filled = new Set<string>();
          for (const [key, header] of Object.entries(suggested)) {
            if (merged[key]) continue;
            if (Object.values(merged).includes(header)) continue;
            merged[key] = header;
            filled.add(key);
          }
          setMapping(merged);
          setAiFilled(filled);
          setAiState("done");
        })
```

Ghép trên `localGuess` chứ không trên `current`: lượt hỏi AI bắt đầu ngay sau khi đặt `localGuess`, và người dùng chưa kịp sửa gì trong khoảng đó.

- [ ] **Step 5: Vẽ bảng map**

Thay khối ba dropdown hiện tại bằng danh sách đích:

```tsx
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#172b4d]">Map columns</h3>
            {aiState === "asking" ? (
              <span className="text-xs font-semibold text-[#6b778c]">
                Reading your file…
              </span>
            ) : aiState === "failed" ? (
              <span className="text-xs font-semibold text-[#974f0c]">
                Could not suggest a mapping — map the columns below.
              </span>
            ) : null}
          </div>
          {targets.map((target) => (
            <label key={target.key} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-sm font-semibold text-[#42526e]">
                {target.label}
                {target.required ? <span className="text-[#bf2600]"> *</span> : null}
              </span>
              <select
                value={mapping[target.key] ?? ""}
                onChange={(event) =>
                  setMapping((current) => {
                    const next = { ...current };
                    if (event.target.value) next[target.key] = event.target.value;
                    else delete next[target.key];
                    return next;
                  })
                }
                className="h-9 min-w-0 flex-1 rounded border border-[#dfe1e6] px-2 text-sm"
              >
                <option value="">Not mapped</option>
                {headers.map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
              {aiFilled.has(target.key) ? (
                <span className="shrink-0 rounded bg-[#deebff] px-1.5 py-0.5 text-[10px] font-bold text-[#0055cc]">
                  AI
                </span>
              ) : null}
            </label>
          ))}
        </div>
```

Nhãn **AI** cho người dùng biết ô nào máy điền để họ soi kỹ ô đó trước. Không có nhãn thì gợi ý sai trông y hệt lựa chọn của chính họ.

- [ ] **Step 6: Thêm import**

```ts
import {
  guessMappingByName,
  type LeadImportMapping,
} from "@/lib/leads/import-mapping";
import { buildLeadImportTargets } from "@/lib/leads/import-targets";
import type { TableColumn } from "@/lib/table-config/types";
```

- [ ] **Step 7: Bốn lệnh kiểm tra**

Run: `npm run typecheck && npm run lint && npm run test:run && npm run build`

- [ ] **Step 8: Kiểm tay — sáu ca**

1. **File tiêu đề rõ ràng** (`Name, Phone, Email`). Expected: cả ba map sẵn ngay lập tức từ luật tên; AI có thể xác nhận lại, không đổi gì.
2. **File tiêu đề tiếng Việt** (`Ho ten, So DT, Mail, SDT phu`). Expected: AI map đúng cả bốn, ô nào AI điền có nhãn **AI**.
3. **File tiêu đề vô nghĩa** (`Column1, Column2, Column3` với dữ liệu thật bên dưới). Expected: luật tên bỏ trống hết; AI nhận ra cột nào là điện thoại **nhờ nhìn dữ liệu**. Đây là ca chứng minh việc gửi 10 dòng mẫu có tác dụng.
4. **Sửa tay một ô AI đã điền** rồi Import. Expected: dùng đúng lựa chọn của người dùng.
5. **Không map Phone.** Expected: nút Import mờ.
6. **Rút mạng rồi chọn file.** Expected: hiện *"Could not suggest a mapping — map the columns below"*, luật tên vẫn chạy, map tay vẫn import được. **Gợi ý hỏng không được làm hỏng việc import.**

- [ ] **Step 9: Changelog + commit**

```markdown
## 2026-09-02 — Import lead: bảng map cột cố định + AI gợi ý

- **Loại**: feature.
- Màn hình Import nay hiện **danh sách cột đích cố định** dựng từ Lead Table Config, mỗi cột chọn nguồn từ file. Trước đó chỉ có ba dropdown Name/Phone/Email, còn cột khác thì tự rơi vào `custom_values` **theo tên đã slugify** — một phỏng đoán, không phải lựa chọn của người dùng.
- **Danh sách đích được LỌC, không lấy nguyên Table Config.** Bỏ `product`/`event`/`assignee`/`status` (đã chọn một lần cho cả file, đưa vào đây là hỏi hai lần một câu) và bỏ `attempts`/`lastContact`/`interactionHistory`/`createdAt`/`key` (do hệ thống tự sinh — cho map vào là mở đường ghi đè dữ liệu vận hành bằng một file Excel).
- **Sonnet 5 đọc tiêu đề + 10 dòng đầu rồi điền sẵn mapping.** Chạy ngay khi chọn file. Người dùng đã cân nhắc và chấp nhận việc dữ liệu khách được gửi tới Anthropic.
- **Không bao giờ tin thẳng output của model.** `sanitizeSuggestedMapping` chặn bốn thứ: bịa tên cột không có trong file, trả khoá đích lạ, map hai trường vào cùng một nguồn, và JSON hỏng. Không phải để chống kẻ xấu — mà vì một bảng map trỏ vào cột không tồn tại sẽ hỏng ở bước parse với thông báo chẳng ai hiểu.
- **Cột đích dựng ở server**, không nhận từ client: client gửi một danh sách bịa thì model sẽ ngoan ngoãn map vào đó.
- **Gợi ý AI chỉ điền chỗ trống**, không đè lên lựa chọn người dùng đã sửa. Ô nào AI điền có nhãn **AI** để họ soi kỹ ô đó trước.
- **Gợi ý hỏng không làm hỏng việc import**: rơi về đoán theo tên, map tay vẫn chạy.
- Model tách khỏi `AI_MODEL` của dashboard chat — đổi hằng kia là đổi hành vi của một tính năng khác.
```

```bash
git add "src/app/(authed)/leads/_components/LeadImportDialog.tsx" "src/app/(authed)/leads/_components/LeadsClient.tsx" changelog.md
git commit -m "feat(leads): bảng map cột khi import, có AI gợi ý"
```

---

## Task 6: Cổng kiểm cuối

- [ ] **Step 1:** `node scripts/check-tracked-imports.mjs` → `ok`
- [ ] **Step 2:** Build từ checkout sạch:

```bash
SCRATCH=$(mktemp -d)/clean
mkdir -p "$SCRATCH"
git archive HEAD | tar -x -C "$SCRATCH"
cp .env.local "$SCRATCH/.env.local"
cp -R node_modules "$SCRATCH/node_modules"   # symlink KHÔNG dùng được: Turbopack từ chối symlink trỏ ra ngoài gốc dự án
cd "$SCRATCH" && npm run build
```
- [ ] **Step 3:** Hỏi remote. **Không tự push.**

---

## Phụ lục: cố ý KHÔNG làm

- **Không map `product`/`event` theo dòng.** Người dùng chốt giữ nguyên cách chọn một lần cho cả file. Muốn đổi thì phải giải quyết thêm: file nhiều product thì lượt chia tự động phải tách theo nhóm, và giá trị lạ trong cột đó cần luật xử lý.
- **Không map `assignee`.** Gán người từ file sẽ đi vòng qua cơ chế chia pool, và một email sai trong file thì lặng lẽ không gán được ai.
- **Không lưu lại mapping cho lần import sau.** Có ích khi tháng nào cũng nhập cùng một mẫu file, nhưng cần một bảng lưu và một màn hình quản lý — việc riêng.
- **Không dùng AI để làm sạch dữ liệu** (sửa số điện thoại, tách họ tên). Ở đây AI chỉ trả lời một câu: cột nào đi đâu. Để nó sửa dữ liệu là mở một loại lỗi rất khó truy.
- **Không đặt hạn mức gọi AI theo người dùng.** Route đã chặn ở `lead.manage` và mỗi lượt chọn file chỉ gọi một lần. Cần thì thêm sau, kèm số đo thật.
