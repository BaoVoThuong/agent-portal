# Bug — badge Interactions có số nhưng log vẫn báo “No interactions yet”

**Found:** 2026-09-01 · **Reported by:** Bao Vo · **Diagnosed against:** working tree hiện tại  
**Status:** open · **Severity:** medium — interaction history có trong database nhưng không hiện khi mở lead lần đầu; agent không thể xem lịch sử liên hệ để xử lý lead đúng ngữ cảnh.

---

## Điều người dùng nhìn thấy

Mở lead **LD36 — Benjamin Truong** trong Event Leads:

- Tab header hiển thị **`Interactions 3`**.
- Phía dưới cùng tab lại hiển thị **`No interactions yet.`**

Hai phần của cùng một drawer đưa ra hai kết quả đối nghịch. Hình chụp cho thấy chính xác trạng thái này.

---

## Evidence từ dữ liệu thật

Đã đọc lead có `display_number = 36` ngày 2026-09-01:

| Field | Giá trị |
| --- | --- |
| Lead ID | `3d0b989e-59e-46b9-aca3-1b04c2d65a68` |
| Client | Benjamin Truong |
| `contact_attempt_count` | `3` |
| Số row trong `lead_interactions` | `3` |
| `first_contacted_at` | 2026-08-28 14:44:35 UTC |
| `last_contacted_at` | 2026-08-31 12:44:35 UTC |

Ba interaction đều là record hợp lệ, không archive/delete và API có thể đọc được:

| Occurred at (UTC) | Actor | Note |
| --- | --- | --- |
| 2026-08-31 12:44:35 | Nam Nguyen | `Second call went to voicemail.` |
| 2026-08-30 14:44:35 | Nam Nguyen | `Texted an introduction and availability.` |
| 2026-08-28 14:44:35 | Nam Nguyen | `No answer on the primary number.` |

`GET /api/leads/:id/interactions` đọc đúng bảng, filter đúng `lead_id`, sort theo `occurred_at desc`, và trả `{ interactions: data ?? [] }` tại `src/app/api/leads/[id]/interactions/route.ts:44-50`. Vì vậy đây **không phải** lỗi import/sample data, phân quyền hay endpoint trả mảng rỗng.

---

## Root cause

`LeadDetailDrawer` có state interaction riêng và `InteractionLog` lại tạo một local state thứ hai từ prop. Fetch bất đồng bộ cập nhật parent, nhưng list con không sync prop mới vào local state của chính nó.

### 1. Lần render đầu luôn truyền mảng rỗng nếu chưa có cache

`src/app/(authed)/leads/_components/LeadDetailDrawer.tsx:156-158`

```ts
const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
const cachedInteractions = lead ? interactionCache.get(lead.id) : undefined;
const [loadedLeadId, setLoadedLeadId] = useState<string | null>(null);
```

Khi user mở LD36 lần đầu trong session, cache chưa có. `visibleInteractions` do đó là `[]`:

```ts
const visibleInteractions =
  loadedLeadId === currentLead.id ? interactions : (cachedInteractions ?? []);
```

### 2. Fetch thành công cập nhật parent và badge

`LeadDetailDrawer.tsx:166-184` fetch `/api/leads/${leadId}/interactions`, rồi gọi:

```ts
setInteractions(payload.interactions as LeadInteraction[]);
setLoadedLeadId(leadId);
```

Sau khi fetch trả 3 row, `visibleInteractions.length` thành `3`. Badge dùng đúng nguồn này:

`LeadDetailDrawer.tsx:509-534`

```tsx
<LeadDetailTabButton
  label="Interactions"
  count={visibleInteractions.length}
/>
...
<InteractionLog initialInteractions={visibleInteractions} />
```

Nên header hiển thị `Interactions 3` là đúng.

### 3. `InteractionLog` chỉ dùng prop ở lần mount đầu

`src/app/(authed)/leads/_components/InteractionLog.tsx:91`

```ts
const [interactions, setInteractions] = useState(initialInteractions);
```

React chỉ dùng đối số `useState(initialInteractions)` ở lần mount đầu. Lúc đó prop là `[]`. Khi parent fetch xong và truyền lại mảng 3 interaction, state `interactions` bên trong `InteractionLog` vẫn là `[]`; không có `useEffect` hay state reconciliation nào để đồng bộ.

Phần render list đọc state local này, không đọc prop:

`InteractionLog.tsx:337-344`

```tsx
{interactions.length === 0 ? (
  <p> No interactions yet. </p>
) : (
  interactions.map(/* ... */)
)}
```

Do đó badge và body dùng hai source of truth khác nhau.

### 4. `key` không giúp khi dữ liệu của cùng lead đến muộn

`InteractionLog` có `key={currentLead.id}`. Key này chỉ remount component khi user đổi sang lead khác. Khi cùng LD36 fetch xong, ID không đổi, component không remount và local state rỗng vẫn giữ nguyên.

Đóng rồi mở lại đúng lead thường có thể khiến lỗi **trông như tự hết**, vì `interactionCache` lúc này đã chứa 3 row và component được mount với `initialInteractions` không rỗng. Đây là hành vi không ổn định theo cache/session, không phải fix.

---

## Trình tự lỗi

```text
t=0     Mở LD36 lần đầu
        parent interactions = [] ; cache trống
        InteractionLog mount → local interactions = []

t=0+    GET /api/leads/<LD36>/interactions đang chạy
        UI list hiển thị “No interactions yet.”

t=100ms API trả 3 records
        parent setInteractions([i1, i2, i3])
        visibleInteractions.length = 3 → badge hiển thị 3
        prop initialInteractions đổi thành [i1, i2, i3]

t=101ms InteractionLog không sync prop
        local interactions vẫn [] → vẫn “No interactions yet.”
```

---

## Impact

- Agent thấy count có lịch sử nhưng không xem được nội dung cuộc gọi/text trước đó.
- Dễ log trùng liên hệ, gọi sai thời điểm, hoặc chọn sai status vì mất context.
- User mất niềm tin vào badge và có thể nghĩ data bị mất.
- Lỗi chỉ dễ thấy ở lần mở đầu/cache miss, nên QA có thể bỏ qua nếu đã từng mở lead đó trong cùng session.

---

## Hướng sửa đề xuất

### Ưu tiên: chỉ giữ một source of truth

`LeadDetailDrawer` đã sở hữu `visibleInteractions` và đã nhận callback `onInteractionSaved`. `InteractionLog` không cần giữ một copy local của chính mảng này.

- Render list trực tiếp từ prop `initialInteractions` (nên đổi tên thành `interactions` để phản ánh đây là current value, không phải only-initial value).
- Sau khi save thành công, gọi `onInteractionSaved` để parent append interaction; parent render lại và list nhận source chính xác.
- Giữ local state của composer (`typeId`, `statusId`, `note`, `saving`) trong `InteractionLog`, nhưng không giữ local history state.

Lợi ích: fetch, cache refresh và post interaction đều đi qua cùng một state; badge và list không thể lệch nhau.

### Fix tối thiểu nếu chưa refactor

Thêm effect sync/reconcile trong `InteractionLog`:

```ts
useEffect(() => {
  setInteractions(initialInteractions);
}, [initialInteractions]);
```

Tuy nhiên cách này cần cẩn thận: một parent refresh đến muộn có thể ghi đè interaction vừa optimistic-append ở child. Nếu dùng phương án này, merge theo `id` hoặc bảo đảm parent update ngay sau save. Vì vậy source-of-truth duy nhất vẫn là cách an toàn hơn.

---

## Acceptance criteria

- Mở LD36 (hoặc bất kỳ lead có interaction) lần đầu khi cache trống: badge và danh sách cùng hiển thị đúng số record.
- Khi API interaction trả sau lần render đầu, list cập nhật mà không cần đóng/mở drawer.
- Khi user tạo interaction mới, badge tăng và row mới xuất hiện đúng một lần.
- Chuyển nhanh giữa hai lead không làm lẫn log của lead A sang lead B.
- Cache hit vẫn render tức thì, rồi refresh nền không làm clear/duplicate list.
- Thêm regression test: mount drawer với `initialInteractions=[]`, resolve fetch với ba interaction, assert badge `3` **và** ba interaction row cùng xuất hiện; không được có `No interactions yet.`.

---

## Out of scope

- Không thay đổi định nghĩa `contact_attempt_count`; DB của LD36 đang nhất quán với số interaction.
- Không thay đổi quyền view/log interaction; API authorization đã qua và dữ liệu được trả thành công.
- Không sửa UI content/card style ngoài việc render đúng history.
