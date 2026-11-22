# Audit log Vercel production 22/11/2026: sửa và tối ưu (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Giảm Fast Origin Transfer (FOT, 77% tiền usage Vercel tuần 16–20/11) và các request thừa của agent-portal mà người dùng không thấy khác. Có số liệu thời gian xử lý theo route, để audit sau không phải đoán.

**Architecture:** Làm theo 3 lớp.
- (A) Đo trước. Dữ liệu đang có chỉ là cuối tuần (mục 1), nên Task 0 lấy số liệu một ngày làm việc: log 24h, metrics 30 phút theo route, 2 câu SQL chỉ đọc, và bật log thời gian.
- (B) Ba sửa nhỏ, không cần chờ số đo:
  - Task 1: chỉ prefetch chi tiết khi chuột dừng trên dòng.
  - Task 2: Sidebar thôi prefetch toàn trang. Việc này cần user chốt.
  - Task 3: `/api/app-version` hết gọi đôi và không đi qua proxy.
- (C) Hai sửa lớn ở mục 6: làm mới một hồ sơ thay vì cả list, và bỏ chữ comment khỏi payload list. Chỉ làm khi Task 0 cho thấy đây là nguồn FOT chính và user chốt.

**Tech Stack:** Next.js 16.2.4 App Router (`src/proxy.ts`, `<Link prefetch>`), React 19.2, Supabase (PostgREST + Realtime broadcast), Vercel Pro (Fluid compute, region syd1, KHÔNG có Observability Plus), Vitest 2 (môi trường `node`).

## Trạng thái

- [x] 22/11/2026: plan viết xong. File plan chưa commit. Quy ước: plan chỉ vào git cùng commit code đầu tiên hiện thực nó (Task 1).
- [x] 22/11/2026, user duyệt 3 điểm: bật `ROUTE_PERF_LOGS` + redeploy; user tự chạy SQL; Task 2 chấp nhận "bấm menu thấy skeleton trước".
- [x] 22/11 11:17 UTC: Task 0 bước 1 xong. Production: `dpl_D1qL4dZ7x88ZfwRuyCcWkdbBztE2` → `dpl_E6ZDRYAEAfJbvEPZt3P7odY9ChNS`, cùng code, chỉ thêm env.
- [x] 22/11 11:41 UTC: sửa theo review của Codex (mục "Review @codex" cuối plan). Job đo giờ kiểm từng lệnh, chỉ ghi `DONE` khi dữ liệu đủ; có tổng FOT của project để đối soát; sửa kỳ vọng RSC ở Task 4. Lúc test còn bắt thêm lỗi `--project can't be combined with --next`: bản cũ sẽ âm thầm chỉ lấy 10.000 dòng log đầu.
- [ ] Task 0 bước 2–4 đã hẹn giờ, chạy tự động trên máy Mac: job `~/Project/Web/vercel-audit/tools/run_measure.sh`, **PID 40652** (đặt lại 22/11 11:41 UTC sau khi sửa script; job cũ PID 15532 đã dừng). Job chụp metrics thứ Hai 23/11 13:00 UTC → thứ Ba 24/11 01:00 UTC rồi tải log 24h. Kết quả: `analyze.txt` + `metrics_summary.txt`, cùng `DONE` (đủ dữ liệu) hoặc `FAILED` (lý do), trong `~/Project/Web/vercel-audit/2026-11-23/`.
- [ ] Task 0 bước 5: chờ user chạy 2 câu SQL (file `~/Project/Web/vercel-audit/list-size.sql`, `comment-growth.sql`).
- [x] Task 1–3: user đã bảo implement 22/11; code xong, chưa commit/deploy. Typecheck, lint và build pass; toàn bộ 2.139 test pass trước khi thêm 2 test hover cuối, rồi 11 test liên quan pass. `/api/app-version` trên localhost trả 200 không cần cookie. Hai bước chạy test để thấy fail không thực hiện vì code được viết cùng lượt.

### Ghi chú thực thi @codex — 22/11/2026

- **Task 1 đã code:** thêm `src/lib/ui/hover-intent.ts`, hook và 6 test; gắn vào dòng Enrollment, thẻ Kanban Task và dòng Task. Hover dưới 150 ms bị huỷ khi chuột rời; luồng mở chi tiết vẫn tải ngay.
- **Task 2 đã code:** bỏ `prefetch={true}` ở hai loại link Sidebar, dùng mặc định của Next.js 16. User đã chấp nhận skeleton khi bấm menu trong phần trạng thái ở trên.
- **Task 3 đã code:** chặn hai sự kiện kiểm phiên bản cách nhau dưới 10 giây; loại đúng `/api/app-version` khỏi matcher proxy. Đã gọi route trên bản build localhost không có cookie: HTTP 200, JSON `{"version":null}`.
- **Đã kiểm:** `npm run typecheck`, `npm run lint` (0 lỗi, 2 cảnh báo cũ), `npx vitest run` (2.139 test pass trước khi thêm 2 test hover cuối), `npx vitest run src/lib/ui/hover-intent.test.ts src/lib/app-version.test.ts` (11 test pass sau thay đổi cuối), `npm run build` pass. `git diff --check` sạch. Hai bước chạy test để thấy fail được để mở vì không chạy red phase.
- **Còn chờ:** Task 0 đo ngày làm việc và hai câu SQL của user; Task 4 commit/push/deploy và đo sau deploy; hướng lớn P4/P5 chỉ chọn khi có số Task 0. Chưa commit hay push.

## Global Constraints

- **Không commit, không push** khi user chưa bảo. Mỗi task có bước commit, nhưng chỉ chạy khi user đồng ý.
- Thư mục có thể dùng chung với Codex. Trước khi sửa, chạy `git status`, `git branch --show-current` và `git log --oneline -3`. Khi commit, `git add` đúng từng file của task, **không** dùng `git add -A` hay `git add .`. Lúc viết plan: `main` sạch, `origin/main` = `6c8d9fa`, `vercel/main` = `6ea85a4`.
- Mọi thay đổi LOGIC ghi vào `agent-portal/changelog.md` (entry mới ở trên cùng, tiếng Việt, theo mẫu các entry có sẵn).
- Không chạy SQL ghi. SQL trong plan chỉ có `select`. Những việc sau **phải hỏi user trước**: chạy SQL trên production, đổi env Vercel, redeploy, bật add-on Vercel.
- `.env.local` trỏ thẳng production. Thử tay trên localhost là đọc/ghi dữ liệu thật.
- Không poll production bằng `curl` (checkpoint của Vercel chặn). Chỉ đọc production qua `vercel logs`, `vercel metrics`, `vercel usage`.
- Next.js 16.2.4 khác các bản cũ (`AGENTS.md`). Trước khi đổi `Link`/`proxy`, đọc `node_modules/next/dist/docs/`. Mọi đoạn docs trích trong plan đều lấy từ thư mục đó.
- Vitest chạy môi trường `node`, chỉ nhận `src/**/*.test.ts` (`vitest.config.ts`), không có jsdom/testing-library. Logic cần test phải nằm trong file `.ts` thuần; component chỉ gọi lại.
- Lệnh kiểm, chạy trong `agent-portal/`: `npx vitest run <file>`, `npm run typecheck` (`tsc --noEmit`), `npm run lint` (`eslint`), `npm run build`.
- PATH cho CLI (shell của agent có thể thiếu): `export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.12.0/bin:$PATH`.
- Plan này không đổi schema, không đổi route mà Slack bot gọi (`AGENTS.md`).
- Log không chứa email, token hay nội dung khách hàng.

---

## 1. Nguồn dữ liệu: có gì, thiếu gì (đọc trước)

Kiểm lúc 22/11/2026 ~10:45 UTC (Chủ nhật). Observability Plus đã tắt từ 15/11.

| Nguồn | Giữ được | Thông báo khi xin quá giới hạn |
|---|---|---|
| `vercel logs` (runtime) | ~24h | `--since 2d` hay `1d`: `The pro plan does not retain runtime logs for the requested time range.`; `--since 23h50m` lỗi định dạng → phải dùng mốc ISO (script A ở mục 8) |
| `vercel logs requests` (CDN) | ~24h | `Observability Plus is required for CDN requests older than 1 day.` |
| `vercel metrics vercel.function_invocation.*` | **30 phút gần nhất**, nhưng VẪN cho `--group-by route` | `Observability Plus is required for function invocations that start more than 30 minutes ago.` |
| `vercel metrics vercel.external_api_request.*` | không có | `Observability Plus is required for this query.` (kể cả 30 phút) |
| `vercel usage` | nhiều tuần, theo ngày / project, KHÔNG theo route | — |
| Speed Insights (LCP/INP/CLS) | không có: chưa cài `@vercel/speed-insights`, usage "Speed Insights Plus Events" = 0 | — |
| SQL production đo kích thước list | auto-mode chặn Claude chạy (22/11) | user tự chạy (Task 0, bước 5) |

Hệ quả:
- Cửa sổ log 24h là 21/11 10:46 UTC → 22/11 10:41 UTC, tức **Thứ Bảy–Chủ nhật**. Không có log lỗi hay latency nào của các ngày làm việc 16–20/11.
- Các số ở mục 2.2–2.8 (1.129 request) chỉ dùng để thấy **cơ chế**. Không dùng để ngoại suy ra tổng.
- Số 7 ngày duy nhất là `vercel usage` (mục 2.1).

## 2. Dẫn chứng

### 2.1 Chi phí theo tuần (`vercel usage`, project `agent-portal-vercel`)

Lệnh: `vercel usage --since 2026-11-09 --until 2026-11-13 --group-by project --json` (đổi ngày cho tuần sau). Cả hai tuần đều là Thứ Hai–Thứ Sáu theo giờ LA. ETag/304 (`b4b42c2`) deploy 14/11 17:06 UTC.

| | 09–13/11 (chưa ETag) | 16–20/11 (đã có ETag) | Thay đổi |
|---|---|---|---|
| Function invocations | 760.041 | 730.917 | −3,8% |
| CDN requests | 393.495 | 365.944 | −7,0% |
| Invocation / CDN request | 1,93 | 2,00 | |
| **Fast Origin Transfer** | **18,43 GB ($5,11)** | **23,29 GB ($6,52)** | **+26,4%** |
| FOT / invocation | ≈24,2 KB | ≈31,9 KB | +31% |
| Fast Data Transfer (CDN → trình duyệt) | 11,58 GB | 7,71 GB | −33,5% |
| Fluid Active CPU | 5,48 h ($0,96) | 5,41 h ($0,95) | ≈ |
| Fluid Provisioned Memory | 33,68 GB-h ($0,50) | 31,67 GB-h ($0,47) | ≈ |
| Observability Events | 3.566.201 ($4,28) | 0 (Plus tắt 15/11) | |
| Usage của project | $11,78 | $8,44 | |

Tuần 16–20/11, FOT là $6,52 / $8,44 = **77%** usage. Đây là khoản duy nhất đang tăng.

FOT theo ngày, GB (`vercel usage --since 2026-11-01 --until 2026-11-22 --breakdown daily --json`). Số này là của cả team, nhưng các project khác cộng lại < 0,03 GB/tuần:

| 09/11 | 10/11 | 11/11 | 12/11 | 13/11 | 16/11 | 17/11 | 18/11 | 19/11 | 20/11 |
|---|---|---|---|---|---|---|---|---|---|
| 3,11 | 3,62 | 3,40 | 4,15 | 4,19 | 4,34 | 4,53 | 4,93 | 4,95 | 4,55 |

Usage cả team mỗi ngày làm việc: $2,30–2,61 (09–13/11) xuống $1,61–1,79 (16–20/11). Phần chênh chủ yếu là Observability Events về 0.

Số đo trước ETag (`changelog.md:27`, entry 2026-11-14, đo khi còn Plus): `/api/enrollment` ~120 KB/lượt, `/api/tasks` ~200 KB/lượt, hai route chiếm ~85% FOT, ~19.000 lượt/ngày làm việc. ETag nhắm đúng hai route này, nhưng FOT tuần sau vẫn TĂNG trong khi số invocation gần như không đổi. Vậy trung bình mỗi phản hồi 200 phải nặng hơn, hoặc có nhiều phản hồi 200 hơn. Mục 2.4 và 2.6 chỉ ra hai cơ chế có thể gây ra điều đó. Task 0 sẽ xác nhận cơ chế nào là chính.

### 2.2 Lỗi: 24h cuối tuần không có lỗi thật

- Runtime log: 164 dòng (160 info, 4 error).
- CDN request: 1.129, trong đó **0 request 4xx/5xx**. Không có timeout, crash hay unhandled exception.
- Deployment trong log: `dpl_D1qL4dZ7x88ZfwRuyCcWkdbBztE2` (production tạo 15/11).

| Dòng error | Route | Số lần | Đầu → cuối (UTC) |
|---|---|---|---|
| `(node:8) [DEP0169] DeprecationWarning: url.parse() behavior is not standardized and prone to errors that have security implications…` | `/api/cron/check-overdue` | 3 | 21/11 12:16:01 → 22/11 06:07:30 |
| cùng dòng | `/api/cron/check-enrollment-due` | 1 | 21/11 13:00:22 |

- Nguồn: `web-push` 3.6.7 (bản mới nhất) gọi `url.parse`. Vô hại, không sửa.
- Noise: 14 request có UA bot/curl. Trong đó 4 lượt `curl/8.18.0` gọi `/api/cron/check-overdue` là GitHub Actions `task-reminders.yml`, hợp lệ. WAF cho qua 100%.
- Project `eps-slack-bot`: 290 request, 288×200 (287 lượt `/api/cron/retry`, tức mỗi 5 phút), 2×404 ở `/`; 0 dòng runtime.

### 2.3 Request 24h theo route (1.129 request; script B, mục 3)

| Request | Tỉ lệ | Route |
|---|---|---|
| 264 | 23,4% | GET `/api/enrollment/[id]/detail` |
| 137 | 12,1% | GET `/enrollment.rsc` |
| 109 | 9,7% | GET `/api/tasks/notifications` (100% trả 200) |
| 106 | 9,4% | GET `/api/enrollment` (69 lượt 304, 37 lượt 200) |
| 91 | 8,1% | GET `/api/app-version` (100% CDN MISS) |
| 53 | 4,7% | GET `/api/enrollment/option-sets` (100% trả 200) |
| 41 / 28 / 27 / 18 | | `/tasks.rsc`, `/tasks/leads.rsc`, `/tasks/providers.rsc`, `/config.rsc` |

- Tổng `.rsc` là **268 (23,7%)**, tất cả `streaming_func` MISS.
- Theo `pathType`: 992 `streaming_func`, 85 `static`, 28 `prerender`, 24 `redirect`.
- Theo quốc gia: US 1.106, VN 23.
- Traffic theo giờ: 17–20h UTC 21/11 và 01h UTC 22/11.

### 2.4 ETag chỉ có tác dụng ở `poll`/`focus`; `broadcast` và `parent` luôn chở nguyên list

Ghép runtime log (dòng `[enrollment-list] reason=…`, `src/app/api/enrollment/route.ts:110`) với CDN request log theo `requestId`. Ghép được 106/106 lượt (script B, mục 4):

| reason | 200 (nguyên list) | 304 (không body) | Tỉ lệ 304 |
|---|---|---|---|
| `poll` (mỗi 60 s) | 3 | 31 | 91% |
| `focus` (quay lại tab) | 2 | 34 | 94% |
| `broadcast` (người khác vừa sửa) | 20 | 3 | **13%** |
| `parent` (chính mình vừa sửa) | 12 | 1 | **8%** |

Vì sao:
- Mọi lý do đều gọi cùng một URL lấy cả list: `EnrollmentClient.tsx:1442` → `fetchJsonWithEtag(\`/api/enrollment?program=${program}&reason=${runReason}\`, …)`.
- ETag là sha1 của TOÀN BỘ JSON (`src/lib/http/json-etag.ts:29-34`). Một comment mới trong phạm vi người xem là đủ đổi ETag, nên lần tải sau trả nguyên list.
- Comment và file đính kèm đều phát broadcast **cấp list**. Payload chỉ có `sourceId`, không có id hồ sơ (`src/lib/enrollment/realtime.ts:98-110`):
  ```ts
  const payload: Record<string, string> = sourceId ? { sourceId } : {};
  return sendEnrollmentBroadcastMessages(
    topics.map((topic) => ({ topic, event: "changed", payload })),
  );
  ```
  Các chỗ gọi: `src/app/api/enrollment/[id]/comments/route.ts:186`, `src/app/api/enrollment/[id]/attachments/route.ts:480`, `src/app/api/enrollment/[id]/route.ts:681` và `:779`.
- Mỗi tab đang mở list của chương trình đó nhận broadcast và tải lại cả list (`EnrollmentClient.tsx:1580` `void refetch("broadcast")`, debounce 300 ms).
- Chính người sửa cũng tải lại cả list qua `reloadDetailAndParent` → `onParentRefresh` → `refetch("parent")` (`EnrollmentClient.tsx:4522-4532`, `:2278`).
- Payload list chở cả chữ của MỌI comment. RPC `enrollment_list_child_stats` có `string_agg(nullif(body, ''), ' ') as comment_search_text` (`supabase/rollouts/2026-11-09-enrollment-list-child-stats.sql:12`), gắn vào từng hồ sơ ở `src/lib/enrollment/queries.ts:276`. Chỉ phần lọc dùng nó (`src/lib/enrollment/filtering.ts:6-13`). Vì vậy list nặng dần theo số comment.

Ví dụ thật, hồ sơ `4993e855…`, 21/11 UTC. Mỗi lần chính người dùng ghi xong là có một GET detail ngay sau:
```
20:09:45 POST comments     20:09:46 POST attachments   20:09:49 POST attachments
20:09:50 GET detail        20:09:53 GET detail
20:09:54 POST comments     20:09:55 POST attachments   20:09:57 POST attachments  20:09:57 PATCH
20:09:58 GET detail        20:10:01 POST comments  20:10:02 GET detail  20:10:03 POST comments  20:10:04 GET detail
```

Kết luận (vẫn là giả thuyết, Task 0 xác nhận):
- Ngày làm việc có nhiều lượt ghi, nên tỉ lệ 304 thấp hơn nhiều so với 65% của cuối tuần.
- Mỗi lượt ghi tốn (số tab đang mở list + 1) phản hồi nguyên list, trong khi list lại lớn dần.
- Hai điều này giải thích được việc FOT không giảm, dù ETag vẫn hoạt động đúng.

### 2.5 Rê chuột qua dòng là tải chi tiết hồ sơ

Code:
- `EnrollmentClient.tsx:3066`: `onMouseEnter={() => prefetchEnrollmentDetail(record.id)}`. Không có độ trễ, không huỷ khi chuột rời.
- `src/lib/enrollment/detail-cache.ts:272-275`: chỉ bỏ qua nếu cache còn hạn (TTL 5 phút, `:8`).
- Task Board có cùng kiểu: `TaskCard.tsx:98` và `TaskRowItem.tsx:354` gọi `prefetchTaskDetail(task.id)`.

Mỗi lượt detail khá nặng (`src/app/api/enrollment/[id]/detail/route.ts:48-77`): `auth`, `scope`, `upload_recovery`, `loadEnrollmentDetail` (comment + reaction + URL file đã ký), `pendingCommentUploads`.

Số liệu 24h:
- 264 GET detail cho 158 hồ sơ.
- **100/158 hồ sơ chỉ bị gọi đúng 1 lần.**
- Phân bố số lượt/hồ sơ: {1: 100, 2: 34, 3: 15, 4: 5, 6: 2, 9: 1, 10: 1}.
- Phút đông nhất: **27 lượt** (21/11 20:15), 26 (18:52), 25 (18:48). Đây là kiểu chuột lướt qua bảng, mỗi dòng một request.

Số cũ của Task (plan `2026-10-17-vercel-log-fixes.md`, mục 5.4, đo 14–17/10): detail task 17.138 lượt, trong khi chỉ mở khoảng 2.776 lần.

### 2.6 Sidebar prefetch toàn trang cho mọi mục menu

Code:
- `src/app/(authed)/_components/Sidebar.tsx:416` và `:445`: `<Link … prefetch …>`, tức `prefetch={true}`. Có từ 04/05/2026 (`git blame`: 035cf21, d9ae1606).
- Nhóm "Task Management" (`Sidebar.tsx:113-160`) có `/tasks`, 4 link `/enrollment?program=aca|medicare|medicaid|other_service`, `/tasks/leads`, `/tasks/providers`…

Docs Next 16 đi kèm repo:
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:302-303`:
  > `"auto"` or `null` (default): … For dynamic routes, the partial route down to the nearest segment with a `loading.js` boundary will be prefetched.
  > `true`: The full route will be prefetched for both static and dynamic routes.
- `…/05-config/01-next-config-js/staleTimes.md:29`: `static` (mặc định 5 phút) "is used … when the `prefetch` prop on `Link` is set to `true`". Theo `link.md:298`, hết hạn mà chuột đi qua link thì prefetch lại.

"Full route" ở đây là chạy luôn `page.tsx`, mà các trang này tải nguyên list ở server:
- `enrollment/page.tsx:68` `fetchEnrollmentRecords(program, resolvedScope)` (đưa vào `initialRecords={records}`, `:113`), kèm people, agents, options, table columns.
- `tasks/page.tsx:51` `fetchTasksForActor(actor)`.
- `tasks/leads/page.tsx:44` `fetchAllLeads(`.
- `tasks/providers/page.tsx:39,47` `fetchLiveProviderRows` + `fetchBacklogProviderRows`.

Số liệu 24h:
- 268 `.rsc` (23,7% request).
- 112/137 `/enrollment.rsc` đến ngay sau một `/enrollment.rsc` khác, trong vòng ≤2 s, cùng UA và edge. Log cắt query string, nên 4 chương trình đều hiện là `/enrollment`.
- Trong ±3 s quanh một `/enrollment.rsc` (cùng UA) có: `/enrollment.rsc` 124, `/tasks/leads.rsc` 73, `/tasks.rsc` 64, `/tasks/providers.rsc` 56, `/config.rsc` 34.
- Nghĩa là mỗi lần tải trang, cả chùm trang nặng được render đầy đủ ở server (đọc DB, chở cả list vào RSC), dù người dùng không mở.

Giới hạn của dẫn chứng:
- `prefetch` đã có từ tháng 5, nên không giải thích được việc FOT tăng sau 15/11. Đo 14/11 cho thấy mọi route ngoài 2 route list chiếm ~15% FOT, và `.rsc` nằm trong 15% đó. Dù vậy, đây vẫn là tải DB thừa trên mọi lần tải trang.
- Log không tách được lượt prefetch với lượt bấm mở trang. CDN request log chỉ có các trường `requestPath`, `route`, `pathType`, `cacheResult`, `httpStatus`…, không có header. Dimension của `vercel metrics` cũng không có header. Cả hai loại đều hiện là `/enrollment.rsc`.
- Sau Task 2, lượt bấm mở trang vẫn tải RSC đầy đủ (đúng như docs), nên phải so **tổng** FOT của các route trang, chuẩn hoá theo traffic (Task 4 bước 3). Không so KB/lượt.

### 2.7 `/api/app-version` bị gọi đôi và đi qua proxy

- 91 lượt; **32 lượt đến ngay sau lượt trước, trong vòng ≤2 s**, cùng UA và edge.
- `src/app/(authed)/_components/NewVersionBanner.tsx:37-39`: kiểm mỗi 5 phút, cộng `visibilitychange` và `focus` cùng gọi `check`. Quay lại tab là bắn cả hai sự kiện, không có chặn.
- Matcher của `src/proxy.ts:22` không loại `api/app-version`, nên mỗi lượt chạy thêm proxy (NextAuth).
- Nội dung trả về là `NEXT_PUBLIC_APP_VERSION`, đã nằm sẵn trong bundle JS gửi cho mọi người (`next.config.ts:15-24`). Bỏ qua proxy không lộ gì mới.

### 2.8 Mỗi request chạy 2 function (suy luận, chưa có task)

- Tỉ lệ invocation / CDN request = 2,00 (tuần 16–20/11). Usage "Edge Middleware Invocations" = 0, nên `proxy.ts` (runtime Node) chạy như một function riêng.
- Proxy chỉ chặn người chưa đăng nhập (`proxy.ts:5-14`); từng route vẫn tự kiểm quyền.
- Chi phí nhỏ (Active CPU cả project $0,95/tuần), nhưng mỗi request đều cộng thêm một chặng. Xem mục 7.

### 2.9 Không có số liệu thời gian xử lý

`src/lib/server-timing.ts:17-28`:
```ts
const override = env.ROUTE_PERF_LOGS ?? env.TASK_DETAIL_PERF_LOGS;
if (override === "1") return true;
if (override === "0") return false;
return env.NODE_ENV !== "production" && env.NODE_ENV !== "test";
```
- Production mặc định tắt. Code đã có 20 nhãn `RouteTiming` (23 chỗ gọi): `enrollment-list`, `enrollment-detail`, `enrollment-update`, `enrollment-create`, `tasks-list`, `task-detail`, `tasks-update`, `task-notifications`, `provider-list-page`, `provider-list`, `provider-detail`, `lead-comments`…
- Bật env lên là có dòng `[perf:<label>] status=… auth=…ms … route_total=…ms` trong runtime log.

## 3. Vấn đề → hướng fix → task

Sắp theo "dễ mà tác động lớn" lên trước.

| # | Vấn đề | Dẫn chứng | Hướng fix | Tác động | Độ khó | Ở đâu |
|---|---|---|---|---|---|---|
| P1 | FOT +26% dù đã có ETag, chưa biết route nào | 2.1 | Đo theo route giờ cao điểm (miễn phí) + SQL đo kích thước list + log thời gian | Quyết định P4/P5 | Dễ | Task 0 |
| P2 | Rê chuột là tải chi tiết (Enrollment + Task) | 2.5 | Chỉ prefetch khi chuột dừng 150 ms | Request/DB: cao (23,4% request cuối tuần); FOT: chưa đo | Dễ | Task 1 |
| P3 | Sidebar prefetch toàn trang | 2.6 | Bỏ `prefetch` → mặc định "auto" (chỉ tới `loading.tsx`) | DB + FOT: trung bình–cao (23,7% request là `.rsc`). UX: bấm menu thấy skeleton trước | Dễ, **cần user chốt** | Task 2 |
| P6 | app-version gọi đôi + qua proxy | 2.7 | Bỏ lần kiểm cách lần trước < 10 s; loại khỏi matcher proxy | Thấp | Dễ | Task 3 |
| P7 | Không có p75/p95 | 2.9 | Bật `ROUTE_PERF_LOGS=1` cho ngày đo | Có dữ liệu chẩn đoán | Dễ (cấu hình, cần user) | Task 0 bước 1 |
| P4 | broadcast/parent chở nguyên list | 2.4 | Làm mới đúng hồ sơ bị đổi | FOT: có thể lớn nhất | Trung bình–khó | Mục 6.1, chờ Task 0 |
| P5 | `comment_search_text` trong list | 2.4 | Tải chỉ mục tìm comment riêng khi người dùng tìm | Mỗi list 200 nhẹ đi (bao nhiêu thì chờ SQL) | Trung bình | Mục 6.2, chờ Task 0 |
| P8 | DEP0169 | 2.2 | Không sửa | — | — | — |

## 4. File Structure

| File | Việc | Task |
|---|---|---|
| `src/lib/ui/hover-intent.ts` (mới) | Logic hẹn giờ thuần: hẹn khi chuột vào, huỷ khi chuột rời. Test được trong node. | 1 |
| `src/lib/ui/hover-intent.test.ts` (mới) | Test cho file trên | 1 |
| `src/lib/ui/use-hover-intent.ts` (mới) | Hook React bọc `createHoverIntent`, huỷ hẹn khi dòng bị gỡ | 1 |
| `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` | `EnrollmentRowItem` (`:2972`, thân hàm bắt đầu `:3003`, dòng `:3066`) | 1 |
| `src/app/(authed)/tasks/_components/TaskCard.tsx` | import `:16`, thân `:63`, dòng `:98` | 1 |
| `src/app/(authed)/tasks/_components/TaskRowItem.tsx` | import `:38`, thân `:282`, dòng `:354` | 1 |
| `src/app/(authed)/_components/Sidebar.tsx` | bỏ `prefetch` ở `:416`, `:445` | 2 |
| `src/lib/app-version.ts`, `src/lib/app-version.test.ts` | `versionCheckDue` + test | 3 |
| `src/app/(authed)/_components/NewVersionBanner.tsx` | dùng `versionCheckDue` | 3 |
| `src/proxy.ts` | loại `api/app-version` khỏi matcher | 3 |
| `changelog.md` | 3 entry | 1, 2, 3 |

Không có SQL, không đổi schema.

---

## 5. Tasks

> **Task 1–3 CHƯA làm.** User dặn 22/11: "đo xong hết, hoàn thiện plan là được, chưa cần code". Chỉ code khi user bảo; khi đó kiểm lại số dòng trích ở dưới (lấy ngày 22/11).

### Task 0: Đo một ngày làm việc (không đổi code)

**Mục đích:** Có số FOT, latency và cold start theo route trong giờ cao điểm, cộng kích thước payload list, để chọn giữa mục 6.1 và 6.2. Kết quả ghi vào cuối plan (mục 9).

Chuẩn bị (đã làm 22/11): 5 script ở mục 8 nằm ở `~/Project/Web/vercel-audit/tools/`, ngoài repo (`~/Project/Web` không phải git repo). Log cuối tuần 21–22/11 lưu ở `~/Project/Web/vercel-audit/2026-11-22_weekend_{runtime,requests}.jsonl` để so sánh.

- [x] **Bước 1: Hỏi user, rồi bật log thời gian.** Đã làm 22/11 11:17 UTC: env `ROUTE_PERF_LOGS` (Config, Production), redeploy ra `dpl_E6ZDRYAEAfJbvEPZt3P7odY9ChNS`, `eps-portal.vercel.app` đã gắn sang bản mới. Câu hỏi: "Bật env `ROUTE_PERF_LOGS=1` trên production và redeploy bản đang chạy để có p50/p95 theo route trong 1–2 ngày làm việc? Log runtime miễn phí khi không có Plus; Observability Events = 0 từ 16/11." Nếu user đồng ý:
  ```bash
  cd ~/Project/Web/agent-portal
  export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.12.0/bin:$PATH
  vercel env add ROUTE_PERF_LOGS production --value 1 --no-sensitive
  vercel env ls production | grep ROUTE_PERF_LOGS          # Expected: ROUTE_PERF_LOGS … Production
  vercel ls --environment production 2>/dev/null | head -8 # lấy URL deployment Ready mới nhất
  vercel redeploy <URL-vừa-lấy> --target production        # ~1 phút, tự gắn lại eps-portal.vercel.app
  ```
  Env chỉ có hiệu lực ở deployment mới. Vì vậy redeploy là bắt buộc.

- [x] **Bước 2: Chọn giờ đo.** Đã chọn **thứ Hai 23/11**, 13:00 UTC → 01:00 UTC thứ Ba. Khung này phủ giờ làm việc của user US: 08:00 sáng miền Đông tới 17:00 chiều miền Tây (20:00 thứ Hai → 08:00 thứ Ba giờ VN). Traffic 99% từ US (US 1.106 / VN 23 cuối tuần).
  - **Tránh thứ Năm 26/11 và thứ Sáu 27/11**: Lễ Tạ ơn Mỹ, traffic không đại diện. Task 4 nên so với một thứ Hai khác (30/11 hoặc 07/12).
  - Nếu cần đo lại ngày khác: chạy script A + B với log 24h của hôm trước, xem mục "theo giờ UTC" để chọn giờ.

- [ ] **Bước 3 + 4 đã hẹn giờ.** Job F (mục 8) chạy nền, **PID 40652** (đặt 22/11 11:41 UTC, thay job cũ 15532 đã dừng khi sửa script theo review). PID ghi ở `~/Project/Web/vercel-audit/2026-11-23/job.pid`, tiến độ ở `job.log` cùng thư mục. Lệnh đã chạy:
  ```bash
  cd ~/Project/Web
  nohup zsh ~/Project/Web/vercel-audit/tools/run_measure.sh ~/Project/Web/vercel-audit/2026-11-23 2026-11-23T13:00:00Z 24 \
    > ~/Project/Web/vercel-audit/2026-11-23/job.log 2>&1 & disown
  ```
  - **Cách job tự kiểm** (sau review Codex 22/11):
    - Mỗi lượt metrics ghi 11 file JSON, gồm 2 file tổng không group-by (`fot_out_total`, `count_total`) làm mẫu số. Mỗi file qua `check_metrics_json.py` (exit 0, không `error`, có `summary`), hỏng thì thử lại 1 lần, rồi ghi một dòng `ok`/`fail` vào `manifest.tsv`; stderr giữ ở `<file>.err`.
    - Tải log: mỗi trang phải exit 0 và có dòng summary; hỏng thì thử lại tới 3 lần rồi báo lỗi, không coi lỗi là hết trang.
    - `summarize_metrics.py` thoát 1 nếu thiếu lượt, có file hỏng, hoặc các nhóm route phủ dưới 99% tổng FOT.
    - Mọi bước đạt thì có `DONE`; bước nào hỏng thì có `FAILED` ghi lý do, và máy hiện thông báo macOS.
  - **Đã test 22/11** (mục 8):
    - Chạy thật 1 lượt → `DONE`.
    - CLI giả lỗi toàn bộ → `FAILED` đủ 5 lý do, 11/11 dòng `fail` trong manifest, không có `DONE`.
    - CLI giả lỗi khi lật sang trang 2 → script tải log thoát 1, báo "không tải được trang 2".
    - Lật trang thật với trang 100 bản ghi → 1.161/1.161 request và 164/164 runtime, khớp tải một lượt, không trùng, không thiếu.
    - Chính bài test cuối bắt được lỗi `--project can't be combined with --next` của bản cũ: có lỗi đó, thứ Hai chỉ lấy được 10.000 dòng log đầu mà không ai biết.
  - Kiểm tiến độ: `cat ~/Project/Web/vercel-audit/2026-11-23/job.log`. Dừng: `kill $(cat ~/Project/Web/vercel-audit/2026-11-23/job.pid)`.
  - **Điều kiện:** Mac phải bật, cắm sạc và KHÔNG gập máy từ 20:00 thứ Hai tới ~08:30 thứ Ba giờ VN. `caffeinate -i -s` chỉ chặn ngủ khi rảnh; gập máy thì vẫn ngủ. Ngủ giữa chừng thì lượt metrics bị trễ hoặc mất, và `summarize_metrics.py` sẽ báo thiếu lượt. Máy tắt hoặc khởi động lại thì job mất, phải chạy lại lệnh trên với ngày mới.
  - Có `DONE`: đọc `analyze.txt` + `metrics_summary.txt`, rồi làm bước 6. Có `FAILED`: đọc lý do trong `FAILED`, mục "VẤN ĐỀ" cuối `metrics_summary.txt` và `manifest.tsv`. Chỉ dùng phần dữ liệu đủ, và ghi rõ phần thiếu vào mục 9.

  Chạy tay (nếu không dùng job). Máy phải thức trong lúc chạy:
  ```bash
  cd ~/Project/Web/agent-portal
  caffeinate -i zsh ~/Project/Web/vercel-audit/tools/metrics_loop.sh ~/Project/Web/vercel-audit/$(date -u +%Y-%m-%d) 16 &
  ```
  Script chụp 16 lượt × 30 phút = 8 giờ. Mỗi lượt ghi 11 file JSON:
  - tổng FOT ra và tổng invocation không group-by,
  - FOT ra và invocation theo cùng chiều `route + pathType`,
  - FOT vào theo route, invocation theo route + status,
  - TTFB p75/p95, duration p95, cold start (`functionStartType`), RAM đỉnh,
  - cộng một dòng mỗi file trong `manifest.tsv`.

  Chạy xong:
  ```bash
  python3 -I ~/Project/Web/vercel-audit/tools/summarize_metrics.py ~/Project/Web/vercel-audit/<ngày> 16
  ```
  Expected:
  - Dòng "Độ phủ: 16 lượt / mong đợi 16".
  - Bảng "FOT ra" có MB, % trên tổng project, KB/lượt (chia cho invocation cùng `route + pathType`) và số lượt; tiếp theo là bảng gộp theo route.
  - Dòng "phủ ≥ 99%". Exit 0 nếu đủ dữ liệu, exit 1 kèm mục "VẤN ĐỀ" nếu thiếu.

- [ ] **Bước 4: Hôm sau, lấy log 24h và phân tích.** Job F đã gồm bước này. Lệnh dưới là để chạy tay.
  ```bash
  cd ~/Project/Web/agent-portal
  zsh ~/Project/Web/vercel-audit/tools/fetch_vercel_logs.sh runtime  ~/Project/Web/vercel-audit/<ngày>/runtime.jsonl
  zsh ~/Project/Web/vercel-audit/tools/fetch_vercel_logs.sh requests ~/Project/Web/vercel-audit/<ngày>/requests.jsonl
  python3 -I ~/Project/Web/vercel-audit/tools/analyze_vercel_logs.py ~/Project/Web/vercel-audit/<ngày>/runtime.jsonl ~/Project/Web/vercel-audit/<ngày>/requests.jsonl
  ```
  Expected:
  - Mỗi lệnh tải in "xong <nguồn>: N bản ghi, K trang" và exit 0. Exit 1 nghĩa là log không trọn; đừng dùng.
  - `analyze_vercel_logs.py` in 7 mục như ở mục 2 của plan này. Mục 7 có dòng `[perf:…]` nếu bước 1 đã bật.
  - Mỗi trang tối đa 10.000 dòng. Script tự lật trang, bỏ `-p` khi dùng `--next`.

- [ ] **Bước 5: User chạy 2 câu SQL chỉ đọc** (auto-mode chặn Claude). Chạy lúc nào cũng được, không phụ thuộc giờ đo. Hai file đã có sẵn từ 22/11 ở `~/Project/Web/vercel-audit/` (`list-size.sql`, `comment-growth.sql`), nội dung như dưới. Chạy xong, dán JSON vào chat để điền mục 9. File thứ nhất `~/Project/Web/vercel-audit/list-size.sql`:
  ```sql
  -- Kích thước payload list Enrollment theo chương trình: phần hồ sơ và phần chữ comment.
  with r as (
    select id,program,client_name,description,fub_link,due_date,stage_id,carrier_id,platform_id,
           consent_id,payment_status_id,aca_status_id,pcp_2025,pcp_2026,custom_values,agent_email,
           caller_email,responsible_enroll_email,qc_checked_by_email,qc_checked_at,due_soon_notified_at,
           overdue_notified_at,overdue_reminded_at,qc_stale_notified_at,closed_at,created_by_email,
           created_at,updated_by_email,updated_at,archived_at,stage_entered_at,stage_entered_source,
           last_activity_at,last_activity_by_email,carrier_ids
    from enrollment_records where archived_at is null
  ), c as (
    select er.program, count(*) as comments, coalesce(sum(octet_length(cm.body)), 0) as comment_text_bytes
    from enrollment_comments cm join enrollment_records er on er.id = cm.record_id
    where er.archived_at is null and cm.deleted_at is null
    group by er.program
  )
  select r.program, count(*) as records,
         sum(octet_length(row_to_json(r)::text)) as record_json_bytes,
         max(c.comments) as comments, max(c.comment_text_bytes) as comment_text_bytes
  from r left join c on c.program = r.program
  group by r.program order by r.program;
  ```
  File thứ hai `~/Project/Web/vercel-audit/comment-growth.sql`:
  ```sql
  -- Comment mới mỗi ngày trong 21 ngày: list có đang phình nhanh không.
  select created_at::date as day, count(*) as comments, sum(octet_length(body)) as bytes
  from enrollment_comments
  where created_at >= now() - interval '21 days' and deleted_at is null
  group by 1 order by 1;
  ```
  Chạy từ worktree `agent-portal-slack-bot`, vì CLI chạy trong `agent-portal/` lỗi `failed to parse environment file: .env.local`:
  ```bash
  cd ~/Project/Web/agent-portal-slack-bot
  supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f ~/Project/Web/vercel-audit/list-size.sql -o json
  supabase db query --linked --project-ref cxdgupxfhvtsitmcmpiw -f ~/Project/Web/vercel-audit/comment-growth.sql -o json
  ```
  JSON trả về xếp key theo ABC, không theo thứ tự cột. CLI có thể tạo `supabase/.temp/`: đừng commit thư mục đó.

- [ ] **Bước 6: Điền mục 9 và chọn hướng theo bảng dưới, rồi hỏi user.**

  | Kết quả Task 0 | Việc tiếp theo |
  |---|---|
  | `/api/enrollment` (hoặc `/api/tasks`) là FOT lớn nhất, và phần lớn lượt 200 có `reason` là `broadcast`/`parent` | Mục 6.1 (hoặc 6.3 cho Task) |
  | `comment_text_bytes` ≥ ~30% của `record_json_bytes + comment_text_bytes` ở ACA | Mục 6.2 |
  | Route `/enrollment` / `/tasks` (`pathType` = `streaming_func`, là RSC của trang) chiếm nhiều FOT | Task 2 là sửa chính; sau deploy so **tổng** FOT các route trang chuẩn hoá theo traffic (Task 4 bước 3), không so KB/lượt |
  | `metrics_summary.txt` báo độ phủ < 99% hoặc thiếu lượt | Chỉ kết luận trên phần đã phủ, ghi rõ % phủ vào mục 9. Đo bù ngày khác nếu thiếu quá 1/4 số lượt |
  | `/api/enrollment/[id]/detail` chiếm nhiều FOT | Task 1 đã xử lý phần rê chuột. Nếu vẫn lớn: bỏ GET detail sau khi tự ghi, dùng phản hồi của lượt ghi |
  | `fot_in_bytes` lớn (body upload) | Kiểm `POST …/attachments`: file lớn phải đi thẳng Supabase (đã làm 24/10) |
  | p95 `ttfb_ms` > 3.000 ms ở route nào | Mở plan riêng cho route đó, dựa trên các chặng `[perf:…]` |

  Task 0 không có commit.

---

### Task 1: Chỉ prefetch chi tiết khi chuột dừng trên dòng

**Files:**
- Create: `src/lib/ui/hover-intent.ts`
- Create: `src/lib/ui/hover-intent.test.ts`
- Create: `src/lib/ui/use-hover-intent.ts`
- Modify: `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx` (`:186-192` import, `:3002-3003`, `:3066`)
- Modify: `src/app/(authed)/tasks/_components/TaskCard.tsx` (`:16`, `:62-63`, `:98`)
- Modify: `src/app/(authed)/tasks/_components/TaskRowItem.tsx` (`:38`, `:281-282`, `:354`)
- Modify: `changelog.md`

**Interfaces:**
- Produces: `HOVER_PREFETCH_DELAY_MS = 150`; `createHoverIntent(delayMs?: number): HoverIntent` với `HoverIntent = { enter(onIntent: () => void): void; cancel(): void }`; `useHoverIntent(onIntent: () => void, delayMs?: number): { onMouseEnter: () => void; onMouseLeave: () => void }`.
- Consumes: `prefetchEnrollmentDetail(id: string): void` (`src/lib/enrollment/detail-cache.ts:272`) và `prefetchTaskDetail(id: string): void` (`src/lib/tasks/detail-cache.ts:309`). Không đổi hai hàm này.

**Vì sao 150 ms:** Dòng bảng cao 44 px (`min-h-11`). Lướt chuột ~1.000 px/s thì mỗi dòng chỉ ~44 ms dưới chuột, nên 150 ms lọc được kiểu lướt qua. Plan 17/10 (mục 5.4) cũng đề xuất ~150 ms.

**Không làm chậm lúc mở:** Bấm mở hồ sơ trước 150 ms vẫn tải ngay. `openRecordById` (`EnrollmentClient.tsx:2017-2018`) tự gọi `prefetchEnrollmentDetail(id)`; drawer Task tự tải detail khi mở (`TaskDetailDrawer.tsx:543`).

**Vì sao không dùng ref:** `eslint-config-next` 16 bật các rule React Compiler của `react-hooks`. Callback được truyền vào lúc `enter`, nên hook không phải đọc hay ghi ref trong render.

- [x] **Bước 1: Viết test (chưa có code nên sẽ fail)**

`src/lib/ui/hover-intent.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHoverIntent, HOVER_PREFETCH_DELAY_MS } from "./hover-intent";

describe("createHoverIntent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once the pointer has rested on the row for the delay", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent();
    intent.enter(onIntent);
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS - 1);
    expect(onIntent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("never fires when the pointer leaves first (sweeping across rows)", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent();
    intent.enter(onIntent);
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS - 50);
    intent.cancel();
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS * 10);
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("keeps a single pending timer when enter repeats", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent();
    intent.enter(onIntent);
    intent.enter(onIntent);
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS);
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("can fire again on a later hover", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent();
    intent.enter(onIntent);
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS);
    intent.cancel();
    intent.enter(onIntent);
    vi.advanceTimersByTime(HOVER_PREFETCH_DELAY_MS);
    expect(onIntent).toHaveBeenCalledTimes(2);
  });

  it("honours a custom delay", () => {
    const onIntent = vi.fn();
    const intent = createHoverIntent(400);
    intent.enter(onIntent);
    vi.advanceTimersByTime(399);
    expect(onIntent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIntent).toHaveBeenCalledTimes(1);
  });

  it("treats cancel without enter as a no-op", () => {
    const intent = createHoverIntent();
    expect(() => intent.cancel()).not.toThrow();
  });
});
```

- [ ] **Bước 2: Chạy để thấy fail**

Run: `npx vitest run src/lib/ui/hover-intent.test.ts`
Expected: FAIL với `Failed to resolve import "./hover-intent"` (hoặc "Cannot find module").

- [x] **Bước 3: Viết code tối thiểu**

`src/lib/ui/hover-intent.ts`:
```ts
/**
 * Hover-intent cho prefetch khi rê chuột qua dòng bảng (Enrollment, Task).
 *
 * Trước 2026-11: `onMouseEnter` prefetch ngay, nên lướt chuột qua bảng là mỗi
 * dòng bắn một GET detail (auth + scope + comment + URL file đã ký). Audit log
 * Vercel 22/11/2026: `GET /api/enrollment/[id]/detail` là route bị gọi nhiều
 * nhất (264/1.129 request trong 24h, có phút 27 lượt), 100/158 hồ sơ chỉ bị gọi
 * đúng một lần. Nay chỉ chạy khi chuột DỪNG trên dòng `delayMs`; rời dòng trước
 * đó thì huỷ.
 */
export const HOVER_PREFETCH_DELAY_MS = 150;

export type HoverIntent = {
  /** Chuột vào dòng: hẹn chạy `onIntent` sau `delayMs`. Đang có hẹn thì giữ hẹn cũ. */
  enter(onIntent: () => void): void;
  /** Chuột rời dòng (hoặc dòng bị gỡ): huỷ hẹn còn treo. */
  cancel(): void;
};

export function createHoverIntent(delayMs: number = HOVER_PREFETCH_DELAY_MS): HoverIntent {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    enter(onIntent) {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        onIntent();
      }, delayMs);
    },
    cancel() {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}
```

- [x] **Bước 4: Chạy để thấy pass**

Run: `npx vitest run src/lib/ui/hover-intent.test.ts`
Expected: PASS, 6 test.

- [x] **Bước 5: Viết hook**

`src/lib/ui/use-hover-intent.ts`:
```ts
"use client";

import { useEffect, useState } from "react";
import { createHoverIntent, HOVER_PREFETCH_DELAY_MS } from "./hover-intent";

/**
 * Handler chuột cho một dòng bảng: `onIntent` chỉ chạy khi chuột dừng trên dòng
 * `delayMs` (xem hover-intent.ts). Dòng bị gỡ khỏi DOM thì huỷ hẹn còn treo.
 */
export function useHoverIntent(
  onIntent: () => void,
  delayMs: number = HOVER_PREFETCH_DELAY_MS,
): { onMouseEnter: () => void; onMouseLeave: () => void } {
  const [intent] = useState(() => createHoverIntent(delayMs));
  useEffect(() => () => intent.cancel(), [intent]);
  return {
    onMouseEnter: () => intent.enter(onIntent),
    onMouseLeave: () => intent.cancel(),
  };
}
```

- [x] **Bước 6: Gắn vào dòng Enrollment**

Trong `src/app/(authed)/enrollment/_components/EnrollmentClient.tsx`, thêm import ngay sau dòng `:192` (`import { fetchJsonWithEtag, type EtagSnapshot } from "@/lib/http/etag-fetch";`):
```ts
import { useHoverIntent } from "@/lib/ui/use-hover-intent";
```
Đầu thân `EnrollmentRowItem` (`:3002-3003`). Hàm không có `return` sớm nào trước JSX (`:3064`), nên gọi hook ở đây hợp lệ.

Trước:
```tsx
}) {
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  const has = (key: EnrollmentColumn["key"]) => columns.some((column) => column.key === key);
```
Sau:
```tsx
}) {
  const hoverPrefetch = useHoverIntent(() => prefetchEnrollmentDetail(record.id));
  const stage = record.stage_id ? optionsById.get(record.stage_id) ?? null : null;
  const has = (key: EnrollmentColumn["key"]) => columns.some((column) => column.key === key);
```
Dòng `:3066`.

Trước:
```tsx
      onMouseEnter={() => prefetchEnrollmentDetail(record.id)}
      onDoubleClick={() => onOpen(record.id)}
```
Sau:
```tsx
      onMouseEnter={hoverPrefetch.onMouseEnter}
      onMouseLeave={hoverPrefetch.onMouseLeave}
      onDoubleClick={() => onOpen(record.id)}
```
`prefetchEnrollmentDetail` vẫn được dùng ở `openRecordById` (`:2018`), nên giữ nguyên import của nó.

- [x] **Bước 7: Gắn vào thẻ Kanban Task**

`TaskCard.tsx` không có `"use client"`, nhưng chỉ được import bởi `KanbanBoard.tsx` (dòng 1 là `"use client"`). Vì vậy nó chạy ở client và dùng hook được.

Thêm import sau `:16` (`import { prefetchTaskDetail } from "@/lib/tasks/detail-cache";`):
```ts
import { useHoverIntent } from "@/lib/ui/use-hover-intent";
```
Đầu thân `TaskCard` (`:62-63`). Không có `return` sớm trước `:93`.

Trước:
```tsx
}) {
  const isTerminal = task.status === "done" || task.status === "cancel";
```
Sau:
```tsx
}) {
  const hoverPrefetch = useHoverIntent(() => prefetchTaskDetail(task.id));
  const isTerminal = task.status === "done" || task.status === "cancel";
```
Dòng `:98`.

Trước:
```tsx
      onMouseEnter={() => prefetchTaskDetail(task.id)}
```
Sau:
```tsx
      onMouseEnter={hoverPrefetch.onMouseEnter}
      onMouseLeave={hoverPrefetch.onMouseLeave}
```

- [x] **Bước 8: Gắn vào dòng danh sách Task**

`TaskRowItem.tsx` có `"use client"`. Thêm import sau `:38` (`import { prefetchTaskDetail } from "@/lib/tasks/detail-cache";`):
```ts
import { useHoverIntent } from "@/lib/ui/use-hover-intent";
```
Đầu thân `TaskRowItem` (`:281-282`). Không có `return` sớm trước `:352`.

Trước:
```tsx
}) {
  const fallbackLabelByEmail = new Map(
```
Sau:
```tsx
}) {
  const hoverPrefetch = useHoverIntent(() => prefetchTaskDetail(task.id));
  const fallbackLabelByEmail = new Map(
```
Dòng `:354`.

Trước:
```tsx
      onMouseEnter={() => prefetchTaskDetail(task.id)}
      onDoubleClick={() => {
```
Sau:
```tsx
      onMouseEnter={hoverPrefetch.onMouseEnter}
      onMouseLeave={hoverPrefetch.onMouseLeave}
      onDoubleClick={() => {
```

- [x] **Bước 9: Kiểm toàn bộ**

Run: `npx vitest run src/lib/ui/hover-intent.test.ts && npm run typecheck && npm run lint && npx vitest run`
Expected: test mới pass; typecheck 0 lỗi; lint 0 lỗi (cảnh báo có sẵn từ trước như `public/sw.js` thì giữ nguyên); toàn bộ test pass như trước khi sửa.

Không thể thử prefetch trên localhost: `next dev` không prefetch, và `.env.local` là DB thật. Hiệu quả đo ở Task 4.

- [x] **Bước 10: Ghi changelog** (đầu `changelog.md`, ngay dưới đoạn giới thiệu):
```markdown
## 2026-11-22 — Rê chuột qua dòng Enrollment/Task chỉ tải chi tiết khi chuột dừng 150 ms

- Trước: chuột chạm dòng là `prefetchEnrollmentDetail` / `prefetchTaskDetail` chạy ngay, nên lướt qua bảng bắn một GET detail cho mỗi dòng. Audit log Vercel 22/11: `GET /api/enrollment/[id]/detail` là route bị gọi nhiều nhất (264/1.129 request trong 24h, có phút 27 lượt, 100/158 hồ sơ chỉ bị gọi đúng 1 lần).
- Nay: chỉ prefetch khi chuột dừng trên dòng 150 ms (`lib/ui/hover-intent.ts`, hook `lib/ui/use-hover-intent.ts`); rời dòng trước đó thì huỷ. Áp cho dòng Enrollment, thẻ Kanban Task và dòng danh sách Task.
- Mở hồ sơ/task không chậm hơn: lúc mở vẫn tự tải chi tiết như cũ.
```

- [ ] **Bước 11: Commit (chỉ khi user đồng ý).** Commit này kèm luôn file plan:
```bash
git add src/lib/ui/hover-intent.ts src/lib/ui/hover-intent.test.ts src/lib/ui/use-hover-intent.ts \
  "src/app/(authed)/enrollment/_components/EnrollmentClient.tsx" \
  "src/app/(authed)/tasks/_components/TaskCard.tsx" \
  "src/app/(authed)/tasks/_components/TaskRowItem.tsx" \
  changelog.md docs/superpowers/plans/2026-11-22-vercel-prod-audit-fixes.md
git commit -m "perf(enrollment,tasks): prefetch row detail only after the pointer rests on the row"
```

---

### Task 2: Sidebar thôi prefetch toàn trang

**Files:**
- Modify: `src/app/(authed)/_components/Sidebar.tsx:413-418`, `:442-447`
- Modify: `changelog.md`

**Interfaces:** không có. Chỉ đổi prop `prefetch` của `next/link`.

- [x] **Bước 0: Hỏi user, chờ trả lời rồi mới làm.** Câu hỏi:

  "Menu bên trái đang tải sẵn TOÀN BỘ dữ liệu của mọi trang trong nhóm đang mở (Health CS, 4 chương trình Enrollment, Lead, Provider…) mỗi lần tải trang, và tải lại sau 5 phút. Cuối tuần, việc này chiếm 23,7% request, và mỗi lượt đọc nguyên list từ DB. Mình muốn đổi sang mặc định của Next: chỉ tải sẵn khung trang. Sau khi đổi, bấm menu sẽ hiện skeleton (`loading.tsx`) ngay, rồi dữ liệu hiện sau khoảng một lượt tải trang, thay vì có sẵn dữ liệu nếu đã prefetch trong 5 phút. Đồng ý không?"

  Nếu user không đồng ý thì dừng Task 2 và ghi lý do vào mục 9.

- [x] **Bước 1: Đọc docs.** Đọc `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md:294-330` (giá trị `prefetch`) và `node_modules/next/dist/docs/01-app/02-guides/prefetching.md:24-60`. Các trang đích đều có `loading.tsx`: `src/app/(authed)/loading.tsx`, `tasks/loading.tsx`, `enrollment/loading.tsx`, `config/loading.tsx`, `dashboard/health/loading.tsx`. Vì vậy "auto" chỉ prefetch tới boundary đó.

- [x] **Bước 2: Bỏ `prefetch` ở link con.**

Trước (`:413-418`):
```tsx
                        <Link
                          key={child.label}
                          href={child.href ?? "#"}
                          prefetch
                          className={`${styles.navItem} py-2 text-sm`}
                        >
```
Sau:
```tsx
                        <Link
                          key={child.label}
                          href={child.href ?? "#"}
                          className={`${styles.navItem} py-2 text-sm`}
                        >
```

- [x] **Bước 3: Bỏ `prefetch` ở link cấp 1, kèm ghi chú.**

Trước (`:442-447`):
```tsx
            <Link
              key={item.href ?? idx}
              href={item.href ?? "#"}
              prefetch
              className={styles.navItem}
            >
```
Sau:
```tsx
            // Không đặt `prefetch` (= true): với trang động, true là render CẢ
            // page.tsx — Enrollment/Task/Lead/Provider đọc nguyên list từ DB —
            // cho mọi mục menu đang hiện, mỗi lần tải trang và lại sau 5 phút.
            // Mặc định "auto" chỉ prefetch tới loading.tsx. Audit 22/11/2026:
            // .rsc là 23,7% request, 112/137 lượt /enrollment.rsc đi theo chùm.
            <Link
              key={item.href ?? idx}
              href={item.href ?? "#"}
              className={styles.navItem}
            >
```

- [x] **Bước 4: Kiểm**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: cả ba thành công. Bảng route của `next build` vẫn đánh dấu các trang này là động (ƒ).

- [x] **Bước 5: Ghi changelog**
```markdown
## 2026-11-22 — Menu trái không còn render sẵn toàn bộ các trang

- `Sidebar.tsx` bỏ `prefetch` (= true) trên mọi `Link`. Với trang động, `true` làm Next render cả `page.tsx` của mọi mục menu đang hiện (Enrollment 4 chương trình, Task, Lead, Provider… mỗi trang đọc nguyên list từ DB) ngay khi tải trang và lại sau 5 phút. Audit log Vercel 22/11: `.rsc` chiếm 23,7% request, 112/137 lượt `/enrollment.rsc` đi theo chùm ≤2 s.
- Nay dùng mặc định "auto": chỉ prefetch tới `loading.tsx`. Bấm menu thấy skeleton ngay, dữ liệu hiện sau một lượt tải trang.
```

- [ ] **Bước 6: Commit (chỉ khi user đồng ý)**
```bash
git add "src/app/(authed)/_components/Sidebar.tsx" changelog.md
git commit -m "perf(nav): stop fully prefetching every sidebar page"
```

---

### Task 3: `/api/app-version` hết gọi đôi và không đi qua proxy

**Files:**
- Modify: `src/lib/app-version.ts`
- Modify: `src/lib/app-version.test.ts`
- Modify: `src/app/(authed)/_components/NewVersionBanner.tsx:21-35`
- Modify: `src/proxy.ts:18-24`
- Modify: `changelog.md`

**Interfaces:**
- Produces: `MIN_VERSION_CHECK_GAP_MS = 10_000`; `versionCheckDue(lastCheckedAt: number | null, now: number): boolean`.
- Consumes: `APP_VERSION`, `isNewerDeployment` (`src/lib/app-version.ts`, giữ nguyên).

- [x] **Bước 1: Viết test (sẽ fail)**

Sửa `src/lib/app-version.test.ts`. Dòng import đầu file đổi thành:
```ts
import { describe, expect, it } from "vitest";
import { isNewerDeployment, MIN_VERSION_CHECK_GAP_MS, versionCheckDue } from "./app-version";
```
Thêm vào cuối file:
```ts
describe("versionCheckDue", () => {
  it("checks the first time", () => {
    expect(versionCheckDue(null, 1_000)).toBe(true);
  });

  it("skips the twin event that lands right after (visibilitychange + focus)", () => {
    expect(versionCheckDue(1_000, 1_050)).toBe(false);
    expect(versionCheckDue(1_000, 1_000 + MIN_VERSION_CHECK_GAP_MS - 1)).toBe(false);
  });

  it("checks again once the gap has passed", () => {
    expect(versionCheckDue(1_000, 1_000 + MIN_VERSION_CHECK_GAP_MS)).toBe(true);
  });
});
```

- [ ] **Bước 2: Chạy để thấy fail**

Run: `npx vitest run src/lib/app-version.test.ts`
Expected: FAIL với lỗi kiểu `versionCheckDue is not a function` (không có export đó).

- [x] **Bước 3: Viết code**

Thêm vào cuối `src/lib/app-version.ts`:
```ts
/**
 * Quay lại tab bắn cả `visibilitychange` lẫn `focus` gần như cùng lúc, nên một
 * lần quay lại thành 2 request (audit log Vercel 22/11/2026: 32/91 lượt
 * `/api/app-version` đến ngay sau lượt trước, ≤2 s). Lần kiểm cách lần trước
 * dưới khoảng này thì bỏ.
 */
export const MIN_VERSION_CHECK_GAP_MS = 10_000;

export function versionCheckDue(lastCheckedAt: number | null, now: number): boolean {
  return lastCheckedAt === null || now - lastCheckedAt >= MIN_VERSION_CHECK_GAP_MS;
}
```

- [x] **Bước 4: Chạy để thấy pass**

Run: `npx vitest run src/lib/app-version.test.ts`
Expected: PASS, 5 test (2 cũ, 3 mới).

- [x] **Bước 5: Dùng trong banner**

`src/app/(authed)/_components/NewVersionBanner.tsx`, dòng 5. Trước:
```ts
import { APP_VERSION, isNewerDeployment } from "@/lib/app-version";
```
Sau:
```ts
import { APP_VERSION, isNewerDeployment, versionCheckDue } from "@/lib/app-version";
```
Dòng `:21-27`. Trước:
```tsx
  useEffect(() => {
    if (!APP_VERSION || outdated) return;
    let cancelled = false;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
```
Sau:
```tsx
  useEffect(() => {
    if (!APP_VERSION || outdated) return;
    let cancelled = false;
    let lastCheckedAt: number | null = null;

    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!versionCheckDue(lastCheckedAt, now)) return;
      lastCheckedAt = now;
      try {
```
Nhịp 5 phút (`CHECK_EVERY_MS`) luôn cách ≥10 s nên không bị chặn. Chỉ lượt thứ hai của một lần quay lại tab bị bỏ.

- [x] **Bước 6: Loại route khỏi proxy**

`src/proxy.ts:18-24`. Trước:
```ts
// api/enrollment/import/dry-run, api/slack-bot/actions: Slack bot gọi từ server
// khác, không có phiên đăng nhập; route tự kiểm BOT_PORTAL_SECRET (2026-11-14/15).
export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/enrollment/import/dry-run|api/slack-bot/actions|signin|_next/static|_next/image|favicon.ico|image|images|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
```
Sau:
```ts
// api/enrollment/import/dry-run, api/slack-bot/actions: Slack bot gọi từ server
// khác, không có phiên đăng nhập; route tự kiểm BOT_PORTAL_SECRET (2026-11-14/15).
// api/app-version: chỉ trả NEXT_PUBLIC_APP_VERSION — giá trị đã nằm trong bundle JS
// gửi cho mọi người — nên không cần đăng nhập; bỏ proxy là bớt một function mỗi
// lượt banner kiểm phiên bản (2026-11-22).
export const config = {
  matcher: [
    "/((?!api/auth|api/cron|api/app-version|api/enrollment/import/dry-run|api/slack-bot/actions|signin|_next/static|_next/image|favicon.ico|image|images|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)",
  ],
};
```
Route `src/app/api/app-version/route.ts` không đọc session và không đọc DB. Không cần sửa route.

- [x] **Bước 7: Thử trên localhost (route này không đụng DB)**

Run (terminal 1): `npm run dev`
Run (terminal 2): `curl -s -i http://localhost:3000/api/app-version | head -12`
Expected: `HTTP/1.1 200` với body JSON `{"version":…}` (thường là `null` ở local vì không có `VERCEL_DEPLOYMENT_ID`), không bị chuyển hướng. Trước khi sửa, gọi không có cookie sẽ bị proxy chuyển sang `/signin`, vì `src/auth.config.ts:32` có `authorized: ({ auth }) => !!auth?.user?.email` và `:28` có `signIn: "/signin"`.

- [x] **Bước 8: Kiểm toàn bộ**

Run: `npx vitest run src/lib/app-version.test.ts && npm run typecheck && npm run lint && npx vitest run`
Expected: tất cả pass.

- [x] **Bước 9: Ghi changelog**
```markdown
## 2026-11-22 — Banner phiên bản: không kiểm đôi, không qua proxy

- Quay lại tab bắn cả `visibilitychange` và `focus`, nên mỗi lần thành 2 request `/api/app-version` (audit 22/11: 32/91 lượt đến ngay sau lượt trước). `NewVersionBanner` bỏ lần kiểm cách lần trước dưới 10 s (`versionCheckDue`, `lib/app-version.ts`); nhịp 5 phút không đổi.
- `proxy.ts` không chạy cho `/api/app-version`: route chỉ trả `NEXT_PUBLIC_APP_VERSION`, giá trị đã công khai trong bundle JS.
```

- [ ] **Bước 10: Commit (chỉ khi user đồng ý)**
```bash
git add src/lib/app-version.ts src/lib/app-version.test.ts \
  "src/app/(authed)/_components/NewVersionBanner.tsx" src/proxy.ts changelog.md
git commit -m "perf(app-version): skip twin focus/visibility checks and the auth proxy"
```

---

### Task 4: Kiểm toàn bộ, deploy, đo lại

- [x] **Bước 1:** `npm run typecheck && npm run lint && npx vitest run && npm run build`. Đã pass 22/11; lint có 2 cảnh báo cũ, 0 lỗi.
- [ ] **Bước 2: Hỏi user cho push.** Trước khi push, `git fetch origin vercel` rồi `git log --oneline origin/main -5` và `git log --oneline vercel/main -5`, vì Codex cũng push. Push cả hai remote theo cách làm thường lệ. Kiểm deploy: `vercel ls --environment production`. Nếu push lên `vercel` mà vài phút không thấy deployment mới, dùng cách deploy từ worktree sạch đã ghi ở các lần trước.
- [ ] **Bước 3: Đo lại vào một ngày cùng thứ với Task 0**, bằng đúng các lệnh của Task 0 bước 3–4. Task 0 đo thứ Hai 23/11, nên chọn một thứ Hai không lễ (30/11 hoặc 07/12): `nohup zsh ~/Project/Web/vercel-audit/tools/run_measure.sh ~/Project/Web/vercel-audit/<ngày> <ngày>T13:00:00Z 24 > ~/Project/Web/vercel-audit/<ngày>/job.log 2>&1 & disown` (tạo thư mục `<ngày>` trước). Điền bảng mục 9.

  **Chuẩn hoá theo traffic trước khi so.** Số người dùng và số tab mở mỗi ngày khác nhau, nên đừng so số tuyệt đối. Chia mỗi chỉ số cho **mẫu số traffic N** cùng ngày, tức tổng invocation của 3 route mà Task 1–3 không đụng tới: `GET /api/enrollment` + `GET /api/tasks` + `GET /api/tasks/notifications`.
  - Lấy N ở script B, mục 3 (24h).
  - Với số metrics, lấy N ở bảng "Invocation theo route và status" của `summarize_metrics.py`, cùng các lượt đo.
  - N lệch quá ±30% so với Task 0 thì ghi chú, vì ngày đó không đại diện.

  | Chỉ số | Lấy ở đâu | Kỳ vọng |
  |---|---|---|
  | GET `/api/enrollment/[id]/detail` ÷ N | script B, mục 3 | giảm rõ so với Task 0 (Task 1) |
  | Số hồ sơ chỉ bị gọi detail 1 lần ÷ N | script B, mục 5 | giảm mạnh |
  | **Tổng MB FOT ra** của các route trang (`/enrollment`, `/tasks`, `/tasks/leads`, `/tasks/providers`, `/config`, `/health/licensing`; `pathType` = `streaming_func`) ÷ N | `summarize_metrics.py`, bảng "FOT ra gộp theo route" | giảm (Task 2). **Không** kỳ vọng KB/lượt "xuống vài KB": lượt bấm mở trang vẫn tải RSC đầy đủ, chỉ lượt prefetch nhỏ đi. Log và metrics không tách được hai loại (xem mục 2.6), nên so tổng |
  | Tổng MB FOT ra của các trang ít khi được mở (`/tasks/providers`, `/config`, `/health/licensing`) ÷ N | như trên | giảm mạnh nhất: phần lớn traffic của chúng là prefetch |
  | Số `.rsc` ÷ N | script B, mục 3 | có thể không giảm: "auto" vẫn prefetch (nhưng chỉ tới `loading.tsx`) |
  | `/api/app-version` đến theo cặp ≤2 s | script B, mục 6 | ≈ 0 (Task 3) |
  | FOT mỗi ngày làm việc ÷ N | `vercel usage --breakdown daily --json` | so với Task 0 (thứ Hai 23/11) |

- [ ] **Bước 4:** Hỏi user có giữ `ROUTE_PERF_LOGS=1` không. Nếu không giữ: `vercel env rm ROUTE_PERF_LOGS production --yes`, rồi redeploy như Task 0 bước 1.

---

## 6. Hướng fix lớn: chờ số đo Task 0 và user chốt (chưa phải task)

Khi user chốt hướng nào, viết plan riêng cho hướng đó, kèm code và test đầy đủ như Task 1–3.

### 6.1 Làm mới đúng hồ sơ bị đổi, thay vì tải lại cả list (P4)

**Làm khi:** Task 0 cho thấy `/api/enrollment` vẫn là route FOT lớn nhất, VÀ phần lớn lượt 200 của nó có `reason` là `broadcast` hoặc `parent`.

**Thiết kế:**
1. **Broadcast kèm id hồ sơ.**
   - Đổi `broadcastEnrollmentChanged(program?, sourceId?)` (`src/lib/enrollment/realtime.ts:98`) thành `broadcastEnrollmentChanged(program?, sourceId?, recordId?)`; payload thành `{ sourceId, recordId }`.
   - Truyền `recordId` ở 4 chỗ chỉ chạm một hồ sơ: `[id]/route.ts:681` và `:779`, `[id]/comments/route.ts:186`, `[id]/attachments/route.ts:480`. Thêm `src/lib/tasks/upload-recovery.ts:182` nếu có sẵn id.
   - Giữ KHÔNG có `recordId` (client tải cả list như cũ) ở: import (`src/lib/enrollment/import-rows.ts:263`), option-sets (`option-sets/route.ts:147`, `option-sets/[id]/route.ts:112`, `:173`), table-config (`src/lib/table-config/realtime.ts:39`), `aca-overview/queue-members/route.ts:23`, tạo mới (`src/app/api/enrollment/route.ts:450`).
2. **Server: `GET /api/enrollment?program=<p>&ids=<uuid,…>`** (tối đa 20 id, kiểm định dạng uuid), trả `{ records: EnrollmentRecordWithStats[], missingIds: string[] }`.
   - Hàm mới `fetchEnrollmentRecordsByIds(program, scope, ids)` trong `src/lib/enrollment/queries.ts`, đặt cạnh `fetchEnrollmentRecords` (`:200-279`).
   - Dùng cùng bộ lọc: `ENROLLMENT_RECORD_COLUMNS`, `.eq("program", program)`, `.is("archived_at", null)`, `applyEnrollmentScope(query, scope)`, thêm `.in("id", ids)`, rồi `fetchEnrollmentListChildStats(supabase, ids)`.
   - `missingIds` là id không còn trong phạm vi người xem hoặc đã archive. Client gỡ các id này khỏi list.
3. **Client.**
   - Trong handler broadcast (`EnrollmentClient.tsx:1585-1600`), nếu `payload.recordId` là chuỗi thì gom id vào một `Set` trong cửa sổ debounce 300 ms (`ENROLLMENT_LIVE_EVENT_DEBOUNCE_MS`), rồi gọi `refreshRecordRows(ids)`. Quá 20 id thì quay về `refetch("broadcast")`.
   - `onParentRefresh` (`:2278`) gọi `refreshRecordRows([openId])`.
   - `refreshRecordRows` theo đúng luật "đang có lượt ghi" của `refetch` (`:1414-1478`): còn `pendingRef.current.size > 0` thì đánh dấu `refetchDirtyRef` như cũ.
   - Vá list bằng hàm thuần mới `applyEnrollmentRowRefresh(list, rows, missingIds)` trong `src/lib/enrollment/list-patch.ts` (test được trong node): thay hoặc chèn theo id, gỡ `missingIds`, sắp lại theo `updated_at` giảm dần rồi `id` (giống `queries.ts:262-266`).
   - Lỗi bất kỳ → `refetch("broadcast")`.
4. **ETag:** sau khi vá, bản ETag đang giữ (`recordsEtagRef`) vẫn là list cũ, nên lần poll kế trả 200 một lần. Chấp nhận được: tối đa một list mỗi chu kỳ poll 60 s, thay vì một list mỗi lượt ghi. Không tính ETag ở client.

**Rủi ro:** hồ sơ đổi người phụ trách hay ra khỏi phạm vi (đã xử lý bằng `missingIds`); thứ tự list; bộ lọc đang mở; `comment_count`/`attachment_count` (lấy lại qua stats).

**Độ khó:** trung bình–khó, khoảng 1–2 ngày, vì `EnrollmentClient.tsx` dài 6.524 dòng.

### 6.2 Bỏ chữ comment khỏi payload list (P5)

**Làm khi:** SQL Task 0 bước 5 cho thấy `comment_text_bytes` chiếm ≥ ~30% payload ACA, hoặc `comment-growth` tăng nhanh.

**Các lựa chọn:**
- (a) **Đề xuất.** Endpoint `GET /api/enrollment/comment-search?program=` (dùng `jsonWithEtag`) trả map `recordId → text`. Client chỉ tải endpoint này khi ô tìm kiếm có chữ, và giữ trong bộ nhớ trang.
  - List bỏ trường `comment_search_text`: RPC thêm tham số `p_include_text boolean default true`, hoặc tạo RPC mới không `string_agg`. Đổi RPC thì cần rollout SQL, phải hỏi user.
  - `filtering.ts:6-13` đọc chữ từ map khi map đã có.
- (b) Tìm ở server: route trả id hồ sơ có comment khớp (`ilike` trên `enrollment_comments.body`, trong phạm vi người xem). Mỗi lần gõ (debounce 300 ms) là một request, nhưng không phải tải chữ về.
- (c) Giữ như cũ, nếu phần chữ nhỏ.

Chỉ `filtering.ts` dùng `comment_search_text` (`grep` ngày 22/11). Export không dùng.

### 6.3 Task Board

`/api/tasks` ~200 KB/lượt (`changelog.md:27`) và có cùng kiểu tải lại cả list. Nếu Task 0 cho thấy `/api/tasks` lớn, áp cách của 6.1 cho `TaskBoardClient`, viết thành plan riêng.

## 7. Để sau (có dẫn chứng, ưu tiên thấp)

| Việc | Dẫn chứng | Vì sao chưa làm |
|---|---|---|
| ETag cho `GET /api/enrollment/option-sets` | 53 lượt/24h cuối tuần, 100% 200. Gọi mỗi 5 phút (`ENROLLMENT_OPTIONS_POLL_EVERY_TICKS = 5`, `live-sync.ts:16`), mỗi lần quay lại tab (`EnrollmentClient.tsx:1652`) và mỗi broadcast "full" | Payload nhỏ. Chỉ làm nếu Task 0 thấy route này đáng kể |
| Chuông và Task Board cùng gọi `/api/tasks/notifications?mode=summary` | `NotificationBell.tsx:460` (poll 120 s / 30 s, `:66-67`) và `TaskBoardClient.tsx:513`. 109 lượt/24h cuối tuần, 100% 200. Đo 14–17/10: 36.526 lượt (plan 17/10, mục 5.3) | Cần dùng chung state giữa 2 component. Đo lại ngày thường trước |
| SLA rules tải trùng | `/api/admin/task-sla-rules` 9 lượt/24h cuối tuần. Plan 17/10, mục 5.2: 9.090 lượt / 4.729 lần mở `/tasks` | Ít |
| Proxy chạy cho mọi `/api/*` (mục 2.8) | invocation/CDN = 2,00 | Bỏ proxy cho `/api` phải kiểm từng route có tự xác thực không, nên rủi ro bảo mật. Lợi tối đa: ~một nửa invocation (~$0,22/tuần) + CPU proxy |
| Speed Insights | Chưa có Core Web Vitals | Có phí, xem bảng giá trước khi bật |
| Skew Protection, `apple-touch-icon` | plan 17/10, mục 5.6–5.7 | Đổi cấu hình production / cần ảnh từ user |
| Giữ log > 1 ngày | mục 1 | Hoặc bật lại Plus tạm thời (Billing → Observability Plus, $1,20/triệu event; tuần 09–13/11 tốn $4,28), hoặc chạy script A mỗi sáng (launchd trên Mac / GitHub Actions có `VERCEL_TOKEN`) và lưu jsonl |

## 8. Phụ lục: script tái lập dẫn chứng (chỉ đọc)

Bản dùng thật nằm ở `~/Project/Web/vercel-audit/tools/` (ngoài repo). Bản trước review Codex lưu ở `tools/_v1/`. Chạy trong `agent-portal/` (thư mục đã `vercel link`); job F tự `cd` vào đó.

Đã chạy thử ngày 22/11 (bản sau review):

| Test | Cách chạy | Kết quả |
|---|---|---|
| B ra đúng số | log cuối tuần 24h | đúng mọi số ở mục 2 |
| C + D đúng dạng | traffic thật của project bot (`SCOPE_FLAGS=--all`, bản v1) | bảng đúng dạng; dạng `summary` của API ghi ở mục E |
| F trọn vòng | `run_measure.sh <thư-mục> 2026-11-22T00:00:00Z 1` | `DONE`, 11/11 file `ok` trong manifest |
| CLI lỗi toàn bộ | `VERCEL_BIN=<giả: metrics exit 1 + JSON lỗi ra stdout, logs exit 2 + lỗi ra stderr> RETRY_SLEEP=0` | `FAILED` đủ 5 lý do, 11/11 `fail`, không có `DONE`; B in "LỖI: runtime 0 dòng, request 0 dòng" |
| Lỗi khi lật trang | `VERCEL_BIN=<giả: lỗi khi có --next, còn lại gọi CLI thật> PAGE_SIZE=300 RETRY_SLEEP=0` | A thoát 1: "không tải được trang 2 của requests sau 3 lần" |
| Lật trang thật | `PAGE_SIZE=100` so với tải một lượt | request 12 trang 1.161/1.161, runtime 2 trang 164/164, không trùng, không thiếu |

Bài test cuối bắt được lỗi của bản v1: CLI 64.5 từ chối `--project can't be combined with --next`. Bản v1 nuốt lỗi đó, nên chỉ lấy được trang đầu (10.000 dòng).

Hành vi CLI đã kiểm 22/11:
- `vercel metrics` khi lỗi: exit 1, JSON `{"error":…}` ra **stdout**.
- `vercel logs` khi lỗi: exit 2, stdout rỗng, lỗi ra **stderr**.
- `--limit 500` được nhận, `--limit 1000` bị từ chối (`invalid_request`).
- `-g 1h` với `--since 30m` bị từ chối (`payment_required`, vì bucket lùi về đầu giờ).
- `caffeinate` trả đúng exit code của lệnh con.

### A. `fetch_vercel_logs.sh`: tải toàn bộ log 24h, lật trang, kiểm từng trang
```zsh
#!/bin/zsh
# Tải toàn bộ log 24h gần nhất của production (Vercel Pro không Observability Plus
# chỉ giữ ~1 ngày; `--since 1d` bị từ chối nên dùng mốc ISO 23h55m trước).
# Mỗi trang phải exit 0 VÀ có dòng summary hợp lệ ở cuối; hỏng thì thử lại tới 3 lần,
# vẫn hỏng thì thoát 1 (không coi lỗi là "hết trang"). Chỉ nối trang đã kiểm vào file ra.
# Dùng: fetch_vercel_logs.sh <runtime|requests> <file-ra.jsonl> [project]
# Biến môi trường (để test): VERCEL_BIN, RETRY_SLEEP (giây, mặc định 15), PAGE_SIZE (mặc định 10000).
set -u
export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.12.0/bin:$PATH
src=$1; out=$2; project=${3:-agent-portal-vercel}
vercel_bin=${VERCEL_BIN:-vercel}; retry_sleep=${RETRY_SLEEP:-15}; page_size=${PAGE_SIZE:-10000}
since=$(python3 -c 'import datetime as d;print((d.datetime.now(d.timezone.utc)-d.timedelta(hours=23,minutes=55)).strftime("%Y-%m-%dT%H:%M:%SZ"))')
sub=(); [ "$src" = "requests" ] && sub=(requests)
: > "$out"; : > "$out.err"
cur=""; records=0

# In "<số bản ghi> <còn trang: 1|0> <cursor|->" từ dòng summary cuối trang; exit 1 nếu không có.
page_summary() {
  tail -1 "$1" | python3 -I -c 'import json, sys
try:
    d = json.loads(sys.stdin.read())
except Exception:
    sys.exit(1)
if d.get("type") != "summary":
    sys.exit(1)
p = d.get("pagination") or {}
print(d.get("recordsReturned", 0), 1 if p.get("hasMore") else 0, p.get("next") or "-")'
}

for i in $(seq 1 100); do
  info=""
  for attempt in 1 2 3; do
    if [ -z "$cur" ]; then
      "$vercel_bin" logs $sub -p "$project" --environment production --since "$since" -n "$page_size" --json > "$out.page" 2>> "$out.err"
    else
      # Không kèm -p: CLI 64.5 từ chối "--project can't be combined with --next";
      # cursor đã giữ project, bộ lọc và khung giờ của trang đầu.
      "$vercel_bin" logs $sub --next "$cur" -n "$page_size" --json > "$out.page" 2>> "$out.err"
    fi
    rc=$?
    if [ $rc -eq 0 ] && info=$(page_summary "$out.page"); then break; fi
    info=""
    echo "trang $i, lần $attempt: lỗi (exit $rc), xem $out.err" >&2
    if [ $attempt -lt 3 ]; then sleep "$retry_sleep"; fi
  done
  if [ -z "$info" ]; then
    rm -f "$out.page"
    echo "LỖI: không tải được trang $i của $src sau 3 lần" >&2
    exit 1
  fi
  read -r n more next <<< "$info"
  cat "$out.page" >> "$out"
  records=$((records + n))
  echo "trang $i: $n bản ghi" >&2
  if [ "$more" = "0" ]; then
    rm -f "$out.page"
    echo "xong $src: $records bản ghi, $i trang (từ $since)" >&2
    exit 0
  fi
  cur=$next
done
rm -f "$out.page"
echo "LỖI: quá 100 trang mà vẫn còn dữ liệu ($src)" >&2
exit 1
```

### B. `analyze_vercel_logs.py`: lỗi, request mix, ETag theo lý do, prefetch, gọi đôi, perf
```python
"""Phân tích log 24h của agent-portal (đầu ra của fetch_vercel_logs.sh).

Dùng: python3 -I analyze_vercel_logs.py runtime.jsonl requests.jsonl
Chỉ đọc file, không gọi mạng.
"""
import collections as C
import datetime as D
import json
import re
import sys


def load(path, kind):
    rows = []
    with open(path) as f:
        for line in f:
            if f'"type":"{kind}"' in line:
                rows.append(json.loads(line)["data"])
    return rows


def ts(row):
    return D.datetime.fromisoformat(row["timestamp"].replace("Z", "+00:00"))


def pct(values, p):
    if not values:
        return None
    values = sorted(values)
    k = max(0, min(len(values) - 1, round(p / 100 * len(values) + 0.5) - 1))
    return values[k]


rt = load(sys.argv[1], "log")
rq = load(sys.argv[2], "request")
if not rt or not rq:
    # File rỗng nghĩa là bước tải log hỏng (hoặc không có traffic): đừng in bảng toàn số 0.
    print(f"LỖI: runtime {len(rt)} dòng, request {len(rq)} dòng; kiểm *.jsonl.err trước khi dùng.")
    sys.exit(1)

print("== 1. Runtime log")
if rt:
    print("cửa sổ:", min(r["timestamp"] for r in rt), "→", max(r["timestamp"] for r in rt))
print("số dòng:", len(rt), dict(C.Counter(r["level"] for r in rt)))
noisy = C.Counter()
for r in rt:
    if r["level"] == "info":
        continue
    msg = r["message"]
    key = "DEP0169 url.parse (web-push)" if "DEP0169" in msg else msg[:160].replace("\n", " ")
    noisy[(r["level"], r["requestPath"], key)] += 1
for (level, path, key), n in noisy.most_common():
    times = sorted(r["timestamp"] for r in rt if r["level"] == level and r["requestPath"] == path)
    print(f"  {n:>5} {level} {path} | {key} | {times[0]} → {times[-1]}")

print("\n== 2. CDN request log")
print("số request:", len(rq))
print("status:", C.Counter(r["httpStatus"] for r in rq).most_common())
print("pathType:", C.Counter(r.get("pathType") for r in rq).most_common())
print("cache:", C.Counter(r.get("cacheResult") for r in rq).most_common())
print("quốc gia:", C.Counter(r.get("clientIpCountry") for r in rq).most_common(5))
hours = C.Counter(r["timestamp"][:13] for r in rq)
print("theo giờ UTC (chọn giờ cao điểm cho metrics 30 phút):")
for hour in sorted(hours):
    print(f"  {hour}h {hours[hour]:>6} {'#' * max(1, hours[hour] * 40 // max(hours.values()))}")
bad = C.Counter((r["httpStatus"], r["requestMethod"], r.get("route") or r["requestPath"]) for r in rq if r["httpStatus"] >= 400)
print("4xx/5xx:", sum(bad.values()))
for k, n in bad.most_common(40):
    print("  ", n, k)
bots = [r for r in rq if re.search(r"bot|crawl|spider|curl|python|scan", r.get("clientUserAgent", ""), re.I)]
print("UA bot/curl/scan:", len(bots), C.Counter((r["requestPath"], r["clientUserAgent"][:40]) for r in bots).most_common(5))

print("\n== 3. Route gọi nhiều nhất")
top = C.Counter((r["requestMethod"], r.get("route") or r["requestPath"]) for r in rq)
for (method, route), n in top.most_common(20):
    print(f"  {n:>6} {n / len(rq):6.1%} {method} {route}")
rsc = C.Counter(r.get("route") for r in rq if (r.get("route") or "").endswith(".rsc"))
print("tổng .rsc:", sum(rsc.values()), f"({sum(rsc.values()) / max(1, len(rq)):.1%})", rsc.most_common())

print("\n== 4. ETag list Enrollment: lý do refetch × status (ghép theo requestId)")
by_id = {r["requestId"]: r for r in rq}
joined = C.Counter()
for r in rt:
    m = re.match(r"\[enrollment-list\] reason=(\S+) program=(\S+)", r["message"])
    if m and r["requestId"] in by_id:
        joined[(m.group(1), by_id[r["requestId"]]["httpStatus"])] += 1
for reason in sorted({k[0] for k in joined}):
    ok = joined[(reason, 200)]
    nm = joined[(reason, 304)]
    print(f"  {reason:<12} 200={ok:<6} 304={nm:<6} tỉ lệ 304={nm / max(1, ok + nm):.0%}")

print("\n== 5. GET /api/enrollment/[id]/detail")
det = [r for r in rq if r.get("route") == "/api/enrollment/[id]/detail" and r["requestMethod"] == "GET"]
per_id = C.defaultdict(list)
for r in det:
    per_id[r["requestPath"].split("/")[3]].append(ts(r))
print("số request:", len(det), "| số hồ sơ khác nhau:", len(per_id))
print("phân bố số lượt/hồ sơ:", sorted(C.Counter(len(v) for v in per_id.values()).items()))
print("phút đông nhất:", C.Counter(r["timestamp"][:16] for r in det).most_common(5))

print("\n== 6. Request đi theo cặp ≤2 s (cùng UA + edge)")
for route in ["/api/app-version", "/enrollment.rsc", "/api/tasks/notifications", "/api/enrollment"]:
    rows = sorted((r for r in rq if r.get("route") == route), key=ts)
    pairs = sum(
        1
        for a, b in zip(rows, rows[1:])
        if (ts(b) - ts(a)).total_seconds() <= 2
        and a.get("clientUserAgent") == b.get("clientUserAgent")
        and a.get("edgeNetworkRegion") == b.get("edgeNetworkRegion")
    )
    print(f"  {route}: {len(rows)} lượt, {pairs} lượt đến ngay sau lượt trước")

print("\n== 7. Dòng [perf:*] (chỉ có khi bật ROUTE_PERF_LOGS=1)")
perf = C.defaultdict(lambda: C.defaultdict(list))
for r in rt:
    m = re.match(r"\[perf:([^\]]+)\] status=(\d+) (.*)", r["message"])
    if not m:
        continue
    for name, value in re.findall(r"(\w+)=([\d.]+)ms", m.group(3)):
        perf[m.group(1)][name].append(float(value))
if not perf:
    print("  (không có)")
for label, stages in sorted(perf.items(), key=lambda kv: -len(kv[1].get("route_total", []))):
    total = stages.get("route_total", [])
    print(f"  {label}: n={len(total)} p50={pct(total, 50)} p75={pct(total, 75)} p95={pct(total, 95)} max={max(total) if total else None}")
    for name, values in stages.items():
        if name != "route_total":
            print(f"      {name}: p50={pct(values, 50)} p95={pct(values, 95)}")
```

### C. `metrics_loop.sh`: chụp metrics 30 phút theo route, kiểm từng file, ghi manifest
```zsh
#!/bin/zsh
# Chụp metrics 30 phút gần nhất (giới hạn khi không có Observability Plus), lặp N lượt.
# Lượt i bắt đầu đúng t0 + 30 phút × (i-1) theo giờ thật, để các cửa sổ nối nhau.
# Mỗi file phải qua check_metrics_json.py (exit 0, không "error", có "summary");
# hỏng thì thử lại 1 lần. Từng file ghi một dòng vào manifest.tsv; stderr giữ ở
# <file>.err. Thoát ≠ 0 nếu còn file hỏng.
# Chạy trong agent-portal/ (thư mục đã `vercel link`). Máy phải thức suốt thời gian chạy:
#   caffeinate -i zsh metrics_loop.sh ~/Project/Web/vercel-audit/2026-11-24 16 &
# Dùng: metrics_loop.sh <thư-mục-ra> [số-lượt=16]
# Biến môi trường (để test): SCOPE_FLAGS (mặc định --prod), VERCEL_BIN, RETRY_SLEEP (giây, mặc định 20).
set -u
export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.12.0/bin:$PATH
out=$1; rounds=${2:-16}; scope=${SCOPE_FLAGS:---prod}
vercel_bin=${VERCEL_BIN:-vercel}; retry_sleep=${RETRY_SLEEP:-20}
tools=${0:A:h}
mkdir -p "$out"
manifest="$out/manifest.tsv"
[ -f "$manifest" ] || printf 'stamp\tname\texit\tstatus\trows\n' > "$manifest"
failures=0

m() {
  local metric=$1 name=$2; shift 2
  local file="$out/${stamp}_${name}.json" rc=1 rows="-" attempt
  for attempt in 1 2; do
    "$vercel_bin" metrics "vercel.function_invocation.$metric" ${=scope} --since 30m "$@" --json > "$file" 2> "$file.err"
    rc=$?
    if [ $rc -eq 0 ] && rows=$(python3 -I "$tools/check_metrics_json.py" "$file" 2>> "$file.err"); then
      printf '%s\t%s\t%s\tok\t%s\n' "$stamp" "$name" "$rc" "$rows" >> "$manifest"
      return 0
    fi
    if [ $attempt -eq 1 ]; then sleep "$retry_sleep"; fi
  done
  printf '%s\t%s\t%s\tfail\t-\n' "$stamp" "$name" "$rc" >> "$manifest"
  failures=$((failures + 1))
  return 1
}

t0=$(date +%s)
for i in $(seq 1 $rounds); do
  stamp=$(date -u +%Y%m%dT%H%M)
  # Tổng cả project, không group-by: mẫu số để biết các nhóm bên dưới phủ được bao nhiêu.
  m fot_out_bytes fot_out_total -a sum
  m count count_total
  # Theo route + pathType. --limit 500 là mức CLI 64.5 nhận (1000 bị từ chối).
  # count_rp group cùng chiều với fot_out_bytes để chia KB/lượt cho đúng.
  m fot_out_bytes fot_out_bytes --group-by route --group-by pathType -a sum --limit 500
  m count count_rp --group-by route --group-by pathType --limit 500
  m fot_in_bytes fot_in_bytes --group-by route -a sum --limit 500
  m count count --group-by route --group-by httpStatus --limit 500
  m ttfb_ms ttfb_p75 --group-by route -a p75 --limit 500
  m ttfb_ms ttfb_p95 --group-by route -a p95 --limit 500
  m function_duration_ms dur_p95 --group-by route -a p95 --limit 500
  m count start --group-by functionStartType
  m peak_memory_mb mem --group-by route -a max --limit 500
  echo "$(date -u +%H:%M) lượt $i/$rounds xong, file hỏng tích luỹ: $failures" >&2
  if [ "$i" -lt "$rounds" ]; then
    next=$(( t0 + 1800 * i ))
    while [ "$(date +%s)" -lt "$next" ]; do sleep 20; done
  fi
done
[ "$failures" -eq 0 ]
```

### D. `summarize_metrics.py`: tổng hợp file của C, kèm độ phủ so với tổng project
```python
"""Tổng hợp các file JSON do metrics_loop.sh ghi (mỗi lượt = 30 phút).

Dùng: python3 -I summarize_metrics.py <thư-mục> [số-lượt-mong-đợi]
In:
- độ phủ dữ liệu theo manifest.tsv (số lượt, file ok/hỏng),
- FOT ra theo route + pathType, % trên TỔNG FOT của project (truy vấn không group-by)
  và độ phủ của các nhóm so với tổng đó,
- KB/lượt chia cho số invocation CÙNG chiều route + pathType, rồi gộp theo route,
- FOT vào, invocation theo status, p75/p95 TTFB, p95 duration, RAM đỉnh, cold start.
Exit 1 nếu thiếu lượt, có file hỏng, hoặc các nhóm phủ dưới 99% tổng FOT.
"""
import collections as C
import csv
import functools
import glob
import json
import os
import statistics
import sys

folder = sys.argv[1]
expected_rounds = int(sys.argv[2]) if len(sys.argv) > 2 else None
problems = []


@functools.lru_cache(maxsize=None)
def rows(path):
    """Các dòng summary dạng (dims, value); None nếu file hỏng (đã ghi vào problems)."""
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception as exc:
        problems.append(f"{os.path.basename(path)}: không đọc được ({exc})")
        return None
    if not isinstance(data, dict) or "error" in data or not isinstance(data.get("summary"), list):
        problems.append(f"{os.path.basename(path)}: {data.get('error') if isinstance(data, dict) else data}")
        return None
    out = []
    for item in data["summary"]:
        value_key = next(k for k in item if k.startswith("vercel_"))
        dims = tuple((k, v) for k, v in item.items() if k != value_key)
        out.append((dims, item[value_key] or 0))
    return tuple(out)


def by_stamp(name):
    suffix = f"_{name}.json"
    found = {}
    for path in glob.glob(os.path.join(folder, f"*{suffix}")):
        base = os.path.basename(path)
        stamp = base[: -len(suffix)]
        if "_" not in stamp:  # loại "<stamp>_count_rp.json" khi tìm "count"
            found[stamp] = path
    return found


def label(dims):
    return " ".join(str(v) for _, v in dims)


# --- 1. Độ phủ theo manifest
manifest_path = os.path.join(folder, "manifest.tsv")
status = C.Counter()
round_stamps = set()
if os.path.exists(manifest_path):
    with open(manifest_path) as f:
        for rec in csv.DictReader(f, delimiter="\t"):
            status[rec["status"]] += 1
            round_stamps.add(rec["stamp"])
            if rec["status"] != "ok":
                problems.append(f"manifest: {rec['stamp']} {rec['name']} hỏng (exit {rec['exit']})")
else:
    problems.append("không có manifest.tsv")
expect = f" / mong đợi {expected_rounds}" if expected_rounds else ""
print(f"== Độ phủ: {len(round_stamps)} lượt{expect}; file ok {status['ok']}, hỏng {status['fail']}")
if expected_rounds and len(round_stamps) < expected_rounds:
    problems.append(f"chỉ có {len(round_stamps)}/{expected_rounds} lượt")

# --- 2. FOT ra: nhóm route + pathType so với tổng project, chỉ tính lượt có đủ 3 file
grp, tot, cnt = by_stamp("fot_out_bytes"), by_stamp("fot_out_total"), by_stamp("count_rp")
fot_pair = C.Counter()
count_pair = C.Counter()
covered = total = 0
for stamp in sorted(set(grp) & set(tot) & set(cnt)):
    g, t, c = rows(grp[stamp]), rows(tot[stamp]), rows(cnt[stamp])
    if g is None or t is None or c is None:
        continue
    for dims, value in g:
        fot_pair[label(dims)] += value
    for dims, value in c:
        count_pair[label(dims)] += value
    covered += sum(v for _, v in g)
    total += sum(v for _, v in t)

print("\n== FOT ra (function → CDN) theo route + pathType, cộng mọi lượt")
if total:
    for key, value in fot_pair.most_common(30):
        n = count_pair.get(key, 0)
        per = f"{value / n / 1024:8.1f} KB/lượt" if n else "      ? KB/lượt"
        print(f"  {value / 1e6:10.1f} MB {value / total:6.1%} {per} {n:>8} lượt  {key}")
    coverage = covered / total
    print(f"  tổng các nhóm {covered / 1e6:.1f} MB / tổng project {total / 1e6:.1f} MB → phủ {coverage:.1%}")
    if coverage < 0.99:
        problems.append(f"các nhóm FOT chỉ phủ {coverage:.1%} tổng project (tăng --limit hoặc gộp chiều)")
    by_route = C.Counter()
    count_route = C.Counter()
    for key, value in fot_pair.items():
        by_route[key.rsplit(" ", 1)[0]] += value
    for key, value in count_pair.items():
        count_route[key.rsplit(" ", 1)[0]] += value
    print("\n== FOT ra gộp theo route")
    for route, value in by_route.most_common(20):
        n = count_route.get(route, 0)
        per = f"{value / n / 1024:8.1f} KB/lượt" if n else "      ? KB/lượt"
        print(f"  {value / 1e6:10.1f} MB {value / total:6.1%} {per} {n:>8} lượt  {route}")
else:
    print("  (tổng FOT = 0: không có traffic trong các lượt đo, hoặc thiếu file)")

# --- 3. FOT vào, invocation theo status
fot_in = C.Counter()
for path in by_stamp("fot_in_bytes").values():
    for dims, value in rows(path) or ():
        fot_in[label(dims)] += value
print("\n== FOT vào (request body → function)")
for key, value in fot_in.most_common(10):
    print(f"  {value / 1e6:10.1f} MB  {key}")

count_route_status = C.defaultdict(C.Counter)
for path in by_stamp("count").values():
    for dims, value in rows(path) or ():
        d = dict(dims)
        count_route_status[d.get("route")][d.get("httpStatus")] += value
total_count = sum(sum(v for _, v in rows(p) or ()) for p in by_stamp("count_total").values())
print(f"\n== Invocation theo route và status (tổng project: {total_count})")
for route, statuses in sorted(count_route_status.items(), key=lambda kv: -sum(kv[1].values()))[:25]:
    print(f"  {sum(statuses.values()):>8} {route} {dict(statuses)}")

# --- 4. Latency, RAM: mỗi lượt là p-giá trị của 30 phút; in trung vị và lớn nhất qua các lượt
for name, title in [("ttfb_p95", "TTFB p95 (ms)"), ("ttfb_p75", "TTFB p75 (ms)"), ("dur_p95", "Duration p95 (ms)"), ("mem", "Peak memory (MB)")]:
    per_key = C.defaultdict(list)
    for path in by_stamp(name).values():
        for dims, value in rows(path) or ():
            per_key[label(dims)].append(value)
    print(f"\n== {title}: trung vị / lớn nhất qua các lượt 30 phút")
    for key, values in sorted(per_key.items(), key=lambda kv: -max(kv[1]))[:15]:
        print(f"  {statistics.median(values):10.1f} / {max(values):10.1f}  {key}")

starts = C.Counter()
for path in by_stamp("start").values():
    for dims, value in rows(path) or ():
        starts[label(dims)] += value
print("\n== functionStartType:", dict(starts))

if problems:
    print("\n== VẤN ĐỀ (dữ liệu chưa đủ để kết luận):")
    for item in problems:
        print("  -", item)
    sys.exit(1)
print("\n== Dữ liệu đủ: không có file hỏng, đủ lượt, độ phủ FOT ≥ 99%.")
```

### F. `run_measure.sh`: job đo không cần người (chờ giờ → C → A → B + D), DONE/FAILED
```zsh
#!/bin/zsh
# Job đo Task 0 (plan 2026-11-22-vercel-prod-audit-fixes.md), chạy một mình không cần người:
# 1) chờ tới START_UTC (so giờ thật mỗi phút, nên máy ngủ rồi thức vẫn đúng giờ),
# 2) chụp metrics 30 phút × ROUNDS lượt trong giờ làm việc của user US,
# 3) tải log 24h (runtime + CDN request), 4) chạy 2 script phân tích, ghi ra file.
# Bước nào thoát ≠ 0 thì ghi lý do vào FAILED. DONE chỉ có khi MỌI bước đạt (đủ lượt,
# không file hỏng, log tải trọn, độ phủ FOT ≥ 99%). Xong thì hiện thông báo macOS.
# Dùng: run_measure.sh <thư-mục-ra> <START_UTC ISO, vd 2026-11-23T13:00:00Z> [ROUNDS=24]
# Dừng job: kill $(cat <thư-mục-ra>/job.pid)
set -u
export PATH=/opt/homebrew/bin:$HOME/.nvm/versions/node/v22.12.0/bin:$PATH
out=$1; start_iso=$2; rounds=${3:-24}
tools=${0:A:h}
mkdir -p "$out"
rm -f "$out/DONE" "$out/FAILED"
echo $$ > "$out/job.pid"
log() { echo "$(date -u +%FT%TZ) $*" >&2; }
fail_now() { echo "$1" > "$out/FAILED"; log "DỪNG: $1"; exit 1; }
cd /Users/vothuongbao/Project/Web/agent-portal || fail_now "không cd được vào agent-portal"
start=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$start_iso" +%s) || fail_now "START_UTC sai định dạng: $start_iso"
problems=()

log "chờ tới $start_iso"
while [ "$(date +%s)" -lt "$start" ]; do sleep 60; done
log "bắt đầu metrics ($rounds lượt × 30 phút)"
caffeinate -i -s zsh "$tools/metrics_loop.sh" "$out" "$rounds" \
  || problems+=("metrics: có file hỏng, xem manifest.tsv và *.json.err")
log "tải log 24h"
zsh "$tools/fetch_vercel_logs.sh" runtime "$out/runtime.jsonl" \
  || problems+=("runtime log: tải không trọn, xem runtime.jsonl.err")
zsh "$tools/fetch_vercel_logs.sh" requests "$out/requests.jsonl" \
  || problems+=("request log: tải không trọn, xem requests.jsonl.err")
python3 -I "$tools/analyze_vercel_logs.py" "$out/runtime.jsonl" "$out/requests.jsonl" > "$out/analyze.txt" 2>&1 \
  || problems+=("analyze_vercel_logs.py lỗi, xem analyze.txt")
python3 -I "$tools/summarize_metrics.py" "$out" "$rounds" > "$out/metrics_summary.txt" 2>&1 \
  || problems+=("summarize_metrics.py: dữ liệu chưa đủ, xem mục VẤN ĐỀ cuối metrics_summary.txt")

if [ ${#problems} -eq 0 ]; then
  date -u +%FT%TZ > "$out/DONE"
  log "xong, dữ liệu đủ: $out/analyze.txt, $out/metrics_summary.txt"
  osascript -e 'display notification "Đo xong, dữ liệu đủ" with title "Vercel audit"' 2>/dev/null || true
else
  printf '%s\n' "${problems[@]}" > "$out/FAILED"
  log "XONG NHƯNG THIẾU DỮ LIỆU: ${problems[*]}"
  osascript -e 'display notification "Đo xong nhưng thiếu dữ liệu, xem FAILED" with title "Vercel audit"' 2>/dev/null || true
  exit 1
fi
```

### G. `check_metrics_json.py`: kiểm một file JSON của `vercel metrics` (C dùng)
```python
"""Kiểm một file JSON của `vercel metrics --json`.

Hợp lệ khi: parse được, không có khoá "error", có mảng "summary".
Hợp lệ: in số dòng summary ra stdout, exit 0. Không hợp lệ: in lý do ra stderr, exit 1.
Dùng: python3 -I check_metrics_json.py <file.json>
"""
import json
import sys

try:
    with open(sys.argv[1]) as f:
        data = json.load(f)
except Exception as exc:  # file rỗng hoặc JSON hỏng
    print(f"không đọc được JSON: {exc}", file=sys.stderr)
    sys.exit(1)
if not isinstance(data, dict) or "error" in data:
    error = data.get("error") if isinstance(data, dict) else data
    print(f"phản hồi lỗi: {error}", file=sys.stderr)
    sys.exit(1)
summary = data.get("summary")
if not isinstance(summary, list):
    print("thiếu mảng summary", file=sys.stderr)
    sys.exit(1)
print(len(summary))
```

### E. Lệnh lẻ đã dùng
```bash
vercel ls --environment production                       # deployment production
vercel usage --since 2026-11-01 --until 2026-11-22 --breakdown daily --json
vercel usage --since 2026-11-09 --until 2026-11-13 --group-by project --json
vercel usage --since 2026-11-16 --until 2026-11-20 --group-by project --json
vercel metrics schema vercel.function_invocation          # danh sách metric + chiều group-by
git blame -L 414,418 -L 443,447 "src/app/(authed)/_components/Sidebar.tsx"
```
Ghi chú:
- Phần `summary` của `vercel metrics --json` là mảng `{<chiều>…, "vercel_function_invocation_<metric>_<agg>": số}`.
- Trong `zsh`, tách chuỗi thành tham số phải viết `${=var}`.
- KQL `a or b` giữa hai giá trị của cùng một trường trả rỗng.

## Review @codex — 22/11/2026

Đã đối chiếu plan với code hiện tại, tài liệu Next.js 16 trong `node_modules`, và các script thật ở `../vercel-audit/tools/`. Chưa chạy các lệnh đụng production; Task 1–3 vẫn chưa triển khai.

- **[P1] Task 0 có thể báo hoàn tất dù dữ liệu đo lỗi hoặc thiếu.** `run_measure.sh` và các script con chỉ dùng `set -u`, không kiểm exit code của `vercel metrics`/`vercel logs`/Python. `metrics_loop.sh` còn chuyển stderr sang `/dev/null`; `fetch_vercel_logs.sh` bắt lỗi parse cursor rồi coi như hết trang. Cuối cùng job vẫn tạo `DONE`. Trước lượt đo 23/11, cần xác minh job đã hẹn còn chạy; nếu còn thì dừng, sửa script thật để kiểm từng lệnh, giữ stderr và chỉ ghi `DONE` khi đủ số lượt/file hợp lệ; sau đó khởi động lại job và xác nhận PID mới. Nếu không kịp sửa, ít nhất phải kiểm thủ công `job.log`, file `*.err`, số file và JSON lỗi trước khi dùng mục 9.
  - **[claude · 22/11 11:41 UTC] Đã sửa.** Kiểm lại thì đúng: `vercel metrics` lỗi là exit 1 + JSON lỗi ra stdout, `vercel logs` lỗi là exit 2 + lỗi ra stderr, và bản cũ bỏ qua cả hai.
    - Job cũ (PID 15532) đã dừng.
    - `metrics_loop.sh`: kiểm từng file bằng `check_metrics_json.py` mới (mục 8 G), thử lại 1 lần, ghi `manifest.tsv`, giữ stderr ở `<file>.err`, thoát ≠ 0 nếu còn file hỏng.
    - `fetch_vercel_logs.sh`: mỗi trang phải exit 0 và có summary, thử lại 3 lần rồi thoát 1.
    - `analyze_vercel_logs.py`: thoát 1 khi input rỗng.
    - `run_measure.sh`: chỉ ghi `DONE` khi mọi bước đạt; ngược lại ghi `FAILED` kèm lý do, và hiện thông báo macOS.
    - Test cả đường đạt lẫn đường hỏng (bảng ở mục 8). Bài test lật trang bắt thêm một lỗi thật: `--project can't be combined with --next`. Không sửa thì thứ Hai mất mọi thứ sau 10.000 dòng log đầu.
    - Job mới: **PID 40652**, cùng lịch.
- **[P1] Tổng FOT theo route chưa phải tổng đầy đủ của project.** `metrics_loop.sh` gọi `fot_out_bytes --group-by route --group-by pathType --limit 40`; `summarize_metrics.py` lấy tổng chỉ từ những nhóm được trả về, rồi tính phần trăm trên tổng đó. Khi có hơn 40 nhóm, các route còn lại biến mất khỏi mẫu số. Cần lấy thêm một metric FOT tổng không `group-by` để đối soát, hoặc phân trang/tăng giới hạn nếu CLI hỗ trợ, và ghi rõ phần chưa bao phủ. Cột `KB/lượt` hiện chia FOT của cặp `route + pathType` cho count của toàn route; nếu một route có nhiều `pathType`, phải group count cùng chiều hoặc gộp FOT về route trước khi chia.
  - **[claude · 22/11] Đã sửa, làm cả hai cách.**
    - Mỗi lượt thêm 2 truy vấn tổng không group-by (`fot_out_total`, `count_total`).
    - `--limit` nâng 40 → 500 (mức tối đa CLI 64.5 nhận; 1000 bị `invalid_request`).
    - `summarize_metrics.py` in "% trên tổng project", in độ phủ (tổng các nhóm / tổng project), và báo VẤN ĐỀ + exit 1 nếu phủ < 99%.
    - `KB/lượt` giờ chia cho `count_rp`: invocation group cùng chiều `route + pathType`. Có thêm bảng gộp theo route, cộng cả FOT lẫn count trước khi chia.
- **[P2] Kỳ vọng Task 4 về RSC cần đổi thành phép đo traffic.** Với `Link` mặc định, tài liệu Next 16 xác nhận route động chỉ prefetch tới `loading.tsx`, nhưng lần *bấm vào trang* vẫn tải RSC đầy đủ. Vì vậy câu “KB/lượt của `/enrollment`, `/tasks` giảm từ cỡ cả list xuống vài KB” không đúng cho mọi lượt. Nên tách request prefetch và navigation trong log (nếu có header/metadata) hoặc so tổng FOT của các trang không được mở; giữ điều kiện traffic tương đương khi so trước/sau.
  - **[claude · 22/11] Đã sửa.**
    - Không tách được prefetch với navigation: CDN request log không có header, dimension của `vercel metrics` cũng không. Ghi rõ ở mục 2.6.
    - Task 4 bước 3 bỏ kỳ vọng "xuống vài KB". Thay bằng tổng MB FOT của các route trang, cộng riêng nhóm trang ít khi được mở (`/tasks/providers`, `/config`, `/health/licensing`), đều chia cho mẫu số traffic N. N = invocation của `/api/enrollment` + `/api/tasks` + `/api/tasks/notifications`, ba route Task 1–3 không đụng. N lệch quá ±30% thì ghi chú ngày không đại diện.
    - Ghi chú thêm: số `.rsc` có thể không giảm, vì "auto" vẫn prefetch tới `loading.tsx`.
    - Dòng tương ứng ở bảng quyết định Task 0 bước 6 cũng đã đổi.

## 9. Kết quả đo (điền khi chạy Task 0 và Task 4)

Cột "Cuối tuần" là số đã có (mục 2), chỉ để tham khảo: traffic thấp, không ngoại suy ra tổng.

| Chỉ số | Cuối tuần 21–22/11 (đã có) | Task 0, thứ Hai 23/11 | Task 4 (thứ Hai …) |
|---|---|---|---|
| Request 24h / 4xx / 5xx | 1.129 / 0 / 0 | | |
| Mẫu số traffic N = GET `/api/enrollment` + `/api/tasks` + `/api/tasks/notifications` (Task 4 bước 3) | 106 + 11 + 109 = 226 | | |
| Độ phủ metrics: số lượt / file hỏng / FOT các nhóm ÷ tổng project | — (chưa chạy metrics) | | |
| Lỗi runtime (ngoài DEP0169) | 0 | | |
| Tỉ lệ 304 của `/api/enrollment` theo `poll` / `focus` / `broadcast` / `parent` | 91% / 94% / 13% / 8% | | |
| GET detail Enrollment / số hồ sơ chỉ bị gọi 1 lần | 264 / 100 (trên 158 hồ sơ) | | |
| `.rsc` / tổng request | 268 / 1.129 (23,7%) | | |
| `/api/app-version` đến theo cặp ≤2 s | 32 / 91 | | |
| Top 5 route theo FOT ra (MB, KB/lượt) | không đo được (metrics chỉ giữ 30 phút, Chủ nhật không có traffic) | | |
| p95 TTFB của `enrollment-list`, `enrollment-detail`, `tasks-list` | chưa có (`ROUTE_PERF_LOGS` bật từ 22/11 11:17 UTC) | | |
| Cold start (`functionStartType`) | chưa có | | |
| `record_json_bytes` / `comment_text_bytes` ACA | chờ user chạy SQL | | |
| FOT/ngày (`vercel usage`) | 0,05 GB (21/11, cả team) | | |
| Hướng đã chọn ở mục 6 và lý do | — | | |
