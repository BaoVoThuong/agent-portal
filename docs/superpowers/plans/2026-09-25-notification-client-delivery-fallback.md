# Thông báo tới trễ khi realtime lỡ ping — Implementation Plan

> **Cho người thực hiện:** dùng `superpowers:subagent-driven-development` hoặc
> `superpowers:executing-plans`. Các bước có ô `- [ ]` để đánh dấu.

**Mục tiêu:** CS đang mở portal phải thấy toast/chuông của thông báo mới trong
vòng **≤ 2 phút** kể cả khi realtime im tiếng, thay vì chờ tới khi có thao tác
khác hoặc một ping may mắn sau đó.

**Kiến trúc:** Không đụng backend. Sửa đúng một lỗ hổng ở client: vòng lặp nền
chỉ cập nhật con số trên chuông mà không bao giờ nạp nội dung mới, nên không có
gì báo cho người dùng biết.

**Tech:** Next.js 16.2.4 · React 19 · Supabase Realtime · vitest 2.1.9

## Ràng buộc chung

- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH"`
- **Không chạy `npm run build`** khi dev server đang chạy. Dùng `npx tsc --noEmit`.
- Mọi thay đổi logic ghi vào `changelog.md`.
- Kiểm chứng sau mỗi task: `npx tsc --noEmit` và `npx vitest run`.
- **Không commit file plan này cho tới khi code hiện thực nó đã xong.**

---

## 1. Đã đo được gì (24/09/2026, production, 14 ngày)

**Backend KHÔNG chậm.** Khoảng cách từ lúc hành động xảy ra tới lúc dòng thông
báo được ghi:

| Đường | Mẫu | Trung vị | p95 | Lớn nhất | Trễ > 60s |
| --- | ---: | ---: | ---: | ---: | ---: |
| hoạt động `assigned` → thông báo | 110 | **0,84s** | 1,09s | 1,46s | **0** |
| tạo task → thông báo `task_created` | 1090 | **1,22s** | 1,73s | 2,47s | **0** |

Không một ca nào chạm 60 giây, nói gì tới 15 phút. Nên **toàn bộ độ trễ người
dùng cảm nhận nằm ở khâu giao tới trình duyệt**, không phải ở khâu ghi.

**Vì sao lại rơi đúng tầm 15–20 phút.** Khi realtime lỡ một ping, thứ duy nhất
kéo thông báo ra là một lần tải đầy đủ kế tiếp — mà lần đó thường do **thông báo
kế tiếp** của chính người đó kích hoạt. Khoảng cách giữa hai thông báo liên tiếp
của cùng một người (33 người nhận, 10.011 mẫu):

```
trung vị 1,8 phút · p75 10,7 phút · p90 38,3 phút
20% số khoảng cách vượt 15 phút
```

Đó chính là hình dạng của lời phàn nàn: phần lớn thời gian thông báo tới ngay,
thỉnh thoảng im ru 15–20 phút.

## 2. Lỗ hổng, đọc thẳng từ code

`src/app/(authed)/_components/NotificationBell.tsx`:

```ts
const loadSummary = useCallback(async () => {
  const res = await fetch("/api/tasks/notifications?mode=summary", …);
  const data = await res.json();
  setUnread(data.unread as number);     // ← chỉ có vậy
  setTopic((data.topic as string | null) ?? null);
}, []);
```

`loadSummary` **chỉ đổi con số trên chuông**. Nó không nạp item, không dựng
toast, không kêu chuông, không tạo popup hệ điều hành. Chỉ `load()` mới làm
những việc đó.

Mà vòng lặp nền thì luôn gọi `loadSummary`:

```ts
const t = setInterval(() => {
  if (document.visibilityState === "visible") void loadSummary();
}, pollMs);                              // 120s khi realtime "live", 30s khi không
```

Và khi tab quay lại foreground mà chuông đang đóng, cũng chỉ `loadSummary()`.

Hệ quả: **con số trên chuông nhảy, nhưng không có gì kêu lên.** Người dùng chỉ
biết khi tự bấm vào chuông, tải lại trang, hoặc có một ping realtime sau đó.

Nặng thêm vì `realtimeLive` chỉ phản ánh **đã subscribe được socket**:

```ts
.subscribe((status) => {
  if (status === "SUBSCRIBED") setRealtimeLive(true);
  …
});
```

Socket còn mở nhưng ping rơi mất thì trạng thái vẫn là "live", nên vòng lặp đi
theo nhịp chậm 120 giây — và vẫn không báo gì.

---

## Task 1 — Vòng lặp nền phát hiện có thông báo mới thì nạp đầy đủ

Đây là phần sửa chính. Sau task này, trường hợp xấu nhất là **120 giây**, thay
vì chờ vô định.

**Files:**
- Tạo: `src/lib/notifications/unread-watermark.ts`
- Tạo: `src/lib/notifications/unread-watermark.test.ts`
- Sửa: `src/app/(authed)/_components/NotificationBell.tsx`

**Interfaces:**
- Produces: `shouldFullLoad(previous: number | null, next: number): boolean`

> **[codex]** `unread` là một aggregate **không đơn điệu** của ba bảng notification,
> nên không thể làm watermark tin cậy. Ví dụ mốc cũ là 5, một notification mới đến
> (+1) đồng thời một notification cũ bị đọc ở tab khác (-1): summary vẫn trả 5 và
> hàm này sẽ bỏ qua full load. Ngay trong cùng tab, `markRead`/`markAllRead` hiện
> cũng không đồng bộ ref đề xuất. Vì vậy Task 1 chưa thể bảo đảm mục tiêu ≤ 2 phút.
> Nếu giữ ràng buộc “không đụng backend”, fallback phải là full `load()` theo nhịp
> xác định; nếu muốn vẫn poll summary rẻ, API cần trả một cursor/revision đơn điệu
> cho notification mới thay vì chỉ trả count.

- [ ] **Bước 1: Viết bài kiểm thử thất bại**

```ts
import { describe, expect, it } from "vitest";
import { shouldFullLoad } from "@/lib/notifications/unread-watermark";

describe("shouldFullLoad", () => {
  it("số chưa đọc TĂNG thì phải nạp đầy đủ để còn dựng toast", () => {
    expect(shouldFullLoad(2, 3)).toBe(true);
  });

  it("không đổi thì thôi — nạp lại chỉ tốn request", () => {
    expect(shouldFullLoad(3, 3)).toBe(false);
  });

  // Người dùng vừa đọc ở tab khác. Không phải thông báo mới.
  it("số chưa đọc GIẢM thì không nạp", () => {
    expect(shouldFullLoad(5, 1)).toBe(false);
  });

  // Lần đo đầu tiên chưa có mốc để so. Nạp lúc này sẽ dựng toast cho những
  // thông báo cũ mà người dùng đã thấy từ lâu.
  it("chưa có mốc trước đó thì không nạp", () => {
    expect(shouldFullLoad(null, 4)).toBe(false);
  });

  it("từ 0 lên 1 vẫn tính là mới", () => {
    expect(shouldFullLoad(0, 1)).toBe(true);
  });
});
```

> **[codex]** Năm test này chỉ chứng minh comparator, không chứng minh hành vi
> thực tế của `NotificationBell`. Cần ít nhất test component/fetch mock cho: summary
> tăng → full load → đúng một toast/chime; full load lỗi → lượt summary sau vẫn retry;
> và new notification + read ở tab khác làm count không tăng → vẫn không bị bỏ sót
> (nếu thiết kế đổi sang cursor hoặc full poll).

- [ ] **Bước 2: Chạy cho nó trượt**

Run: `npx vitest run src/lib/notifications/unread-watermark.test.ts`
Expected: FAIL — không tìm thấy module.

- [ ] **Bước 3: Cài đặt**

```ts
/**
 * Vòng lặp nền có nên nâng cấp thành một lần tải ĐẦY ĐỦ không.
 *
 * `loadSummary` rẻ nhưng chỉ đổi con số trên chuông; chỉ `load()` mới dựng
 * toast, kêu chuông và tạo popup hệ điều hành. Không có luật này thì khi realtime
 * lỡ một ping, người dùng thấy số nhảy mà không có gì báo — phải tự bấm vào
 * chuông mới biết.
 */
export function shouldFullLoad(previous: number | null, next: number): boolean {
  // Lần đầu chưa có mốc so sánh. Nạp lúc này là dựng toast cho thông báo cũ.
  if (previous === null) return false;
  return next > previous;
}
```

- [ ] **Bước 4: Chạy lại cho xanh**

Run: `npx vitest run src/lib/notifications/unread-watermark.test.ts`
Expected: PASS (5 tests)

- [ ] **Bước 5: Nối vào `NotificationBell`**

Thêm một ref giữ mốc, và cho `loadSummary` tự nâng cấp:

```ts
const lastUnreadRef = useRef<number | null>(null);

const loadSummary = useCallback(async () => {
  try {
    const res = await fetch("/api/tasks/notifications?mode=summary", {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = await res.json();
    const next = data.unread as number;
    setTopic((data.topic as string | null) ?? null);

    // Có thông báo mới: nạp đầy đủ để còn dựng toast. Đây là đường dự phòng
    // DUY NHẤT khi realtime im tiếng — không có nó, con số trên chuông nhảy
    // mà không có gì báo cho người dùng.
    if (shouldFullLoad(lastUnreadRef.current, next)) {
      lastUnreadRef.current = next;
      await load();
      return;
    }
    lastUnreadRef.current = next;
    setUnread(next);
  } catch {
    // Lỗi mạng thoáng qua; lượt sau thử lại.
  }
}, [load]);
```

> **[codex]** Không được advance watermark trước `await load()`. `load()` đang tự
> nuốt lỗi và không trả success/failure; nếu full request lỗi sau khi ref đã thành
> `next`, các summary kế tiếp cùng count sẽ không gọi full load nữa — notification
> vẫn bị bỏ lỡ vô thời hạn. Cần commit cursor/mốc chỉ sau full load thành công và
> chặn/serialize các `loadSummary()` chồng nhau, nếu không response cũ đến muộn còn
> có thể ghi đè mốc mới.

Và trong `load()`, sau `setUnread(data.unread as number)`, đồng bộ mốc:

```ts
lastUnreadRef.current = data.unread as number;
```

> **Vì sao đồng bộ ở cả hai chỗ:** `load()` cũng đổi số chưa đọc. Để mốc lệch
> thì lượt `loadSummary` kế tiếp so với một con số cũ và nâng cấp thừa một lần
> — mỗi lần thừa là một request đầy đủ vô ích.

- [ ] **Bước 6: Kiểm chứng**

```bash
npx tsc --noEmit && npx vitest run
```

- [ ] **Bước 7: Commit**

```bash
git add src/lib/notifications/unread-watermark.ts \
        src/lib/notifications/unread-watermark.test.ts \
        "src/app/(authed)/_components/NotificationBell.tsx"
git commit -m "fix(notifications): vòng lặp nền nạp đầy đủ khi có thông báo mới"
```

---

## Task 2 — Phân biệt "socket đã nối" với "realtime còn sống"

Sau Task 1 trường hợp xấu nhất là 120 giây. Task này kéo xuống 30 giây khi
realtime thực sự đã chết.

**Files:**
- Sửa: `src/app/(authed)/_components/NotificationBell.tsx`

- [ ] **Bước 1: Ghi lại thời điểm nhận ping gần nhất**

```ts
const lastRealtimeSignalRef = useRef<number>(Date.now());
```

Đặt `lastRealtimeSignalRef.current = Date.now();` ngay trong handler
`.on("broadcast", { event: "new" }, …)`, và mỗi khi `subscribe` báo
`SUBSCRIBED`.

> **[codex]** “5 phút không có broadcast” không chứng minh realtime chết: với một
> CS đang yên lặng, đó là trạng thái bình thường. Theo đề xuất này, sau 5 phút mọi
> tab idle sẽ poll 30 giây mãi đến khi có notification/re-subscribe, làm tăng tải mà
> vẫn không đo được sức khoẻ channel. Chỉ nên hạ nhịp dựa trên heartbeat/connection
> signal thực sự, hoặc hoãn Task 2 cho tới khi có telemetry chứng minh vấn đề này.

- [ ] **Bước 2: Nhịp vòng lặp theo SỨC KHOẺ, không theo trạng thái socket**

```ts
/**
 * Quá lâu không nghe thấy gì từ realtime thì coi như nó đã chết, dù socket vẫn
 * báo SUBSCRIBED. `SUBSCRIBED` chỉ nói "đã nối được", không nói "ping có tới".
 * Đây đúng là khe hở làm thông báo tới trễ: socket còn mở, ping rơi mất, và
 * vòng lặp vẫn đi theo nhịp chậm.
 */
const REALTIME_SILENCE_MS = 5 * 60 * 1000;

const pollMs =
  realtimeLive && Date.now() - lastRealtimeSignalRef.current < REALTIME_SILENCE_MS
    ? POLL_REALTIME_MS
    : POLL_FALLBACK_MS;
```

> **[Claude]** Cố ý KHÔNG đưa `lastRealtimeSignalRef` vào deps của effect: nó là
> ref nên đổi giá trị không kích hoạt render, và effect này chỉ cần đọc nó lúc
> đặt interval. Muốn nhịp đổi ngay giữa chừng thì phải chuyển sang state — lúc
> đó mỗi ping lại dựng lại interval, đắt hơn phần lợi thu được.

> **[codex]** Nhận xét trên khiến Task 2 không đạt kết quả đã hứa: `pollMs` chỉ
> được tính khi effect chạy. Khi ref vượt ngưỡng 5 phút sẽ không có render/effect
> mới, nên interval 120 giây hiện tại vẫn giữ nguyên; nó không tự chuyển sang 30
> giây. Một timer/state hoặc việc tính health ngay trong mỗi tick là bắt buộc nếu
> vẫn triển khai hướng này — nhưng trước hết cần giải quyết vấn đề “silence ≠ dead”
> ở comment trên.

- [ ] **Bước 3: `npx tsc --noEmit`, thử tay, changelog, commit.**

---

## Task 3 — Chốt chống báo trùng

Phải chắc rằng lần nạp đầy đủ do Task 1 kích hoạt không dựng toast lặp khi một
ping realtime tới ngay sau đó.

**Files:**
- Sửa: `src/app/(authed)/_components/NotificationBell.tsx` (chỉ thêm test, nếu cần)

- [ ] **Bước 1: Đọc lại `seenIds`**

`load()` đã lọc bằng `seenIds.current`:

```ts
const unseen = list.filter((n) => !seenIds.current.has(n.id));
const fresh = unseen.filter((n) => !n.is_read);
list.forEach((n) => seenIds.current.add(n.id));
```

Cơ chế chống trùng **đã có sẵn** và hoạt động theo id, không theo thời điểm. Hai
lần `load()` liền nhau chỉ dựng toast một lần cho cùng một thông báo.

- [ ] **Bước 2: Xác nhận bằng tay** — mở hai tab, assign một task, kiểm rằng mỗi
      tab chỉ dựng đúng một toast và chỉ MỘT tab kêu chuông
      (xem `alertFreshNotifications`).

Không cần đổi code nếu bước 1 và 2 đều đúng. Ghi lại kết luận vào changelog.

> **[codex]** Bước xác nhận này chưa cô lập được đường lỗi chính của plan. Ngắt
> mạng có thể làm channel đổi sang `CLOSED`/`TIMED_OUT` và đi vào fallback 30 giây
> sẵn có, hoặc tạo reconnect; nó không chứng minh được trường hợp broadcast bị lỡ
> khi channel vẫn `SUBSCRIBED`. Nên mock/chặn event `new` nhưng vẫn giữ socket
> subscribe, rồi kiểm chứng polling đưa notification mới ra toast đúng một lần.

---

## Task 4 — Ghi vết khi broadcast thất bại

Để lần sau có sự cố thì có bằng chứng, thay vì lại phải suy đoán.

**Files:**
- Sửa: `src/lib/tasks/notifications.ts`

- [ ] **Bước 1:** `insertNotifications` đã trả về kết quả broadcast nhưng **mọi
      nơi gọi đều bỏ qua**. Thêm một dòng cảnh báo phía server khi nó `false`:

> **[codex]** Tiền đề này không đúng hoàn toàn: `sendBroadcastMessages()` đã
> `console.error` sau hai lần thất bại, kèm `messageCount` và failure; log đó còn
> phủ cả enrollment/time-off vì tất cả dùng `broadcastNotif`. Một `console.warn` ở
> `insertNotifications` vừa trùng log vừa chỉ phủ task; một số caller task cũng đã
> biến `false` thành warning. Nếu cần observability tốt hơn, nên bổ sung field/metric
> có cấu trúc ở `sendBroadcastMessages()` thay vì thêm log lặp ở tầng này.

```ts
const broadcast = await broadcastNotif(rows.map((r) => r.recipient_email));
if (!broadcast) {
  // Không làm hỏng thao tác — thông báo đã nằm trong database và vòng lặp nền
  // của client sẽ nhặt được (Task 1). Nhưng phải để lại vết: không có dòng này
  // thì một đợt realtime chết chỉ hiện ra dưới dạng "người dùng kêu trễ".
  console.warn(
    `[notifications] broadcast thất bại cho ${rows.length} người nhận`,
  );
}
```

- [ ] **Bước 2:** `npx tsc --noEmit`, changelog, commit.

---

## 3. Thứ tự và tiêu chí dừng

1. **Task 1 là thứ đáng làm nhất** — một mình nó đã đưa trường hợp xấu nhất từ
   "vô định" về 120 giây. Làm xong task này là có thể trả lời CS.
2. Task 2 và 4 làm sau, độc lập với nhau.
3. Task 3 chỉ là xác nhận, không đổi code nếu `seenIds` đã đủ.

**Không làm trong plan này:** outbox/retry bền vững cho broadcast ở server. Đo
được rồi hẵng làm — hiện chưa có số liệu nào cho biết broadcast thất bại bao
nhiêu phần trăm, và Task 4 sinh ra đúng để lấy số đó.

> **[codex]** Với thiết kế Task 1 hiện tại, fallback vẫn phụ thuộc vào unread count
> và có thể bỏ lỡ event, nên không nên xem nó là cơ chế sửa chữa đủ mạnh để kết luận
> outbox/retry chưa cần thiết. Hãy quyết định lại sau khi chọn được fallback xác định
> (full poll hoặc cursor) và thu telemetry ở shared broadcast layer.

## 4. Cách nghiệm thu

Hai tài khoản, A assign task cho B:

1. B mở portal, **không** bấm vào chuông. Ngắt mạng B vài giây rồi nối lại để
   socket bỏ lỡ ping.
2. Kỳ vọng: trong vòng ≤ 2 phút B thấy toast + chuông, không phải chờ tới thông
   báo kế tiếp.
3. Trường hợp realtime khoẻ: toast phải tới trong vài giây, và **chỉ một lần**.

> **[codex]** “≤ 2 phút” không thể là hard guarantee ở browser: interval có thể bị
> throttle, tab có thể mất visibility, và full fetch còn có network latency. Nên ghi
> rõ phạm vi nghiệm thu là tab foreground/online và dùng ngưỡng có buffer (ví dụ
> “lượt poll kế tiếp + thời gian request”), thay vì biến 120 giây thành SLA tuyệt đối.

## 5. Nhật ký

| Việc | Commit | Kết quả đo |
| --- | --- | --- |
| Task 1–4 | chưa làm | — |

---

# Kết quả hiện thực (25/09/2026)

## Nhận comment của codex: đúng 5/5, đã đổi thiết kế theo

Tôi đã kiểm từng điểm trong code trước khi nhận, không nhận suông.

**1. Mốc theo số chưa đọc là sai — ĐÚNG.** Xác nhận ở
`src/app/api/tasks/notifications/route.ts`: `unread` là **tổng của ba bảng**
(`task_notifications` + `enrollment_notifications` + `time_off_notifications`),
lên xuống hai chiều. Một cái mới tới (+1) đúng lúc một cái cũ được đọc ở tab
khác (−1) thì tổng không đổi và vòng lặp bỏ lỡ hẳn.

→ **Đã bỏ hẳn `shouldFullLoad`/watermark.** Thay bằng **mốc thời điểm** của
thông báo mới nhất: `hasNewerNotification(seenAt, latestAt)`. Đọc/xoá không làm
thời điểm lùi lại, nên nó đơn điệu thật.

**2. Không được tiến mốc trước `await load()` — ĐÚNG và quan trọng.** `load()`
nuốt lỗi và không báo thành bại; tiến mốc trước là request hỏng một lần thì mọi
lượt sau thấy mốc bằng nhau rồi thôi — mất thông báo vĩnh viễn.

→ `load()` nay trả `Promise<boolean>`, và **mốc chỉ tiến bên trong `load()`, sau
khi đã cầm được danh sách**. Thêm `summaryInFlightRef` chặn chồng lượt: một lượt
chậm trả về sau lượt mới hơn sẽ ghi đè mốc bằng dữ liệu cũ.

**3. Task 2 sai tiền đề VÀ không chạy — ĐÚNG cả hai.** "5 phút không có
broadcast" với một CS đang yên lặng là chuyện bình thường, không phải realtime
chết. Và `pollMs` chỉ được tính lúc effect chạy, nên ref vượt ngưỡng cũng không
đổi được interval.

→ **Bỏ Task 2.** Không cần nữa: với mốc thời điểm, trường hợp xấu nhất đã là
"lượt poll kế tiếp", không còn vô định. Hạ nhịp thêm chỉ đổi 120 giây lấy 30
giây, đổi lại là mọi tab đang rảnh đều poll dày hơn.

**4. Task 4 trùng log — ĐÚNG.** `sendBroadcastMessages()` trong
`src/lib/tasks/realtime.ts` **đã** `console.error` sau khi thử lại hỏng, và nó
phủ cả enrollment lẫn time-off vì dùng chung `broadcastNotif`.

→ **Bỏ Task 4.** Thêm `console.warn` ở `insertNotifications` vừa trùng vừa hẹp hơn.

**5. "≤ 2 phút" không thể là cam kết cứng — ĐÚNG.** Interval bị throttle, tab mất
visibility, request có độ trễ mạng.

→ Đã viết lại phần nghiệm thu bên dưới cho đúng phạm vi.

## Đã làm

**Backend** — `mode=summary` trả thêm `latestAt`: thời điểm mới nhất trong cả ba
bảng thông báo của người đó. Ba truy vấn `order by created_at desc limit 1`,
**chạy song song** với bốn truy vấn đếm sẵn có nên không cộng dồn độ trễ. Đo
thật: `counts;dur≈420ms` cho cả bảy truy vấn.

> Ràng buộc "không đụng backend" trong bản plan đầu là thứ đã ép ra thiết kế
> yếu. Codex nói thẳng điều đó và đúng — nên tôi bỏ ràng buộc ấy.

**Client** — `src/app/(authed)/_components/NotificationBell.tsx`:
- `load()` trả `Promise<boolean>`, tự đặt mốc từ danh sách vừa nạp
- `loadSummary()` so `latestAt` với mốc; mới hơn thì gọi `load()` để còn dựng
  toast, kêu chuông, tạo popup
- lần quan sát đầu tiên chỉ đặt mốc, KHÔNG nạp — tránh dựng toast cho thông báo
  cũ người dùng đã đọc từ lâu
- `summaryInFlightRef` chặn chồng lượt

**Logic thuần** — `src/lib/notifications/delivery-cursor.ts`, **10 test**, trong
đó có bài khoá đúng hai bẫy: mốc không lùi khi đọc bớt ở tab khác, và so theo
thời điểm thật chứ không so chuỗi (hai múi giờ khác nhau thì thứ tự chữ cái
không còn là thứ tự thời gian — đây là lỗi tôi đã viết ra rồi tự bắt được).

**Task 3** — không đổi code. `load()` đã lọc bằng `seenIds` theo id, nên hai lần
nạp liền nhau chỉ dựng toast một lần cho cùng một thông báo.

## Còn thiếu, nói thẳng

Codex đúng ở điểm **10 test kia chỉ chứng minh hàm so sánh, không chứng minh
hành vi của `NotificationBell`**. Repo hiện chưa có hạ tầng test component:
`vitest.config.ts` đặt `environment: "node"` và chỉ quét `*.test.ts`, không có
jsdom hay testing-library.

Dựng hạ tầng đó là một việc riêng, đáng làm nhưng không nên gói vào bản sửa này.
Trước mắt phần rủi ro nhất — luật so mốc — đã được khoá bằng test.

## Nghiệm thu (đã sửa phạm vi theo comment 5)

Phạm vi: **tab đang ở foreground và có mạng**. Không cam kết cho tab nền, vì
trình duyệt tự bóp nhịp `setInterval`.

Cách thử đúng đường lỗi — **không** ngắt mạng, vì ngắt mạng làm channel chuyển
sang `CLOSED`/`TIMED_OUT` và rơi vào nhánh dự phòng 30 giây vốn đã có, tức không
tái hiện được đúng tình huống "socket còn SUBSCRIBED nhưng ping rơi mất":

1. Chặn riêng event `new` ở tầng channel (hoặc tạm bỏ handler `.on("broadcast")`)
   mà vẫn giữ subscribe.
2. Từ tài khoản khác, assign một task cho người đang mở portal.
3. Kỳ vọng: trong khoảng **một lượt poll kế tiếp cộng thời gian request**, toast
   và chuông phải tới — **đúng một lần**.

## Nhật ký

| Việc | Trạng thái | Ghi chú |
| --- | --- | --- |
| Task 1 — mốc phát hiện thông báo mới | **xong** | đổi từ watermark sang cursor theo comment 1+2 |
| Task 2 — sức khoẻ realtime | **bỏ** | sai tiền đề và không chạy được, comment 3 |
| Task 3 — chống báo trùng | **xong, không đổi code** | `seenIds` đã đủ |
| Task 4 — ghi vết broadcast | **bỏ** | log đã có sẵn, comment 4 |
